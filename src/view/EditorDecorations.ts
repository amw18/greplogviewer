// EditorDecorations — 行颜色高亮装饰管理
import * as vscode from 'vscode';
import { FilterResult, FoldRange, KeywordConfig } from '../types';

/** 单行内的关键字匹配结果 */
interface KeywordMatch {
  range: vscode.Range;
  color: string;
  keywordId: string;
  groups?: Record<string, string>;
}

/** 超过此行数时跳过未匹配行 dim 装饰，避免 setDecorations 阻塞 UI */
const LARGE_FILE_DIM_THRESHOLD = 100000;

export class EditorDecorations {
  private decorationTypes = new Map<string, vscode.TextEditorDecorationType>();
  /** 未匹配行装饰类型（降低透明度） */
  private dimDecoration: vscode.TextEditorDecorationType;
  /** 关键字高亮装饰类型 */
  private keywordDecoTypes: vscode.TextEditorDecorationType[] = [];
  private editor: vscode.TextEditor | undefined;
  private getGroupColor?: (groupId: string) => string | undefined;
  private ringBufferFlagDecoration?: vscode.TextEditorDecorationType;

  constructor(getGroupColor?: (groupId: string) => string | undefined, flagIconUri?: vscode.Uri) {
    this.dimDecoration = vscode.window.createTextEditorDecorationType({
      opacity: '0.3',
    });
    this.getGroupColor = getGroupColor;
    if (flagIconUri) {
      this.ringBufferFlagDecoration = vscode.window.createTextEditorDecorationType({
        gutterIconPath: flagIconUri,
        gutterIconSize: 'contain',
        overviewRulerColor: 'red',
        overviewRulerLane: vscode.OverviewRulerLane.Left,
      });
    }
  }

  /**
   * 应用过滤结果和关键字高亮到编辑器。
   * 关键字范围从行级颜色范围内“挖掉”，两者不重叠，因此 color 属性不会冲突。
   *
   * @param results 行级过滤结果
   * @param editor 目标编辑器
   * @param keywords 可选关键字配置，每个提供 pattern + color
   * @param scanStart 行范围起始（0-based），仅在此范围内扫描关键字
   * @param scanEnd 行范围结束（0-based, exclusive）
   */
  apply(results: FilterResult[], editor: vscode.TextEditor, keywords?: KeywordConfig[], scanStart?: number, scanEnd?: number, matchedLinesOverride?: Set<number>, lines?: string[]): void {
    this.clear();
    this.editor = editor;

    // 使用传入的 lines（避免重复 getText）或自行获取
    const allLines = lines ?? editor.document.getText().split('\n');

    // ── 1. 收集匹配行号，预计算关键字匹配 ──
    const matchedLineNums = matchedLinesOverride ?? (() => {
      const m = new Set<number>();
      for (const r of results) {
        if (r.groupId && r.groupId !== '__kw_visible__') { m.add(r.lineNumber); }
      }
      return m;
    })();
    const kwByLine = this.computeKeywordMatches(keywords, allLines, scanStart, scanEnd, matchedLineNums);

    // ── 2. 按 groupId 分组匹配行，同时从行范围内挖掉关键字子串 ──
    const groupLines = new Map<string, vscode.Range[]>();
    const skipDim = allLines.length > LARGE_FILE_DIM_THRESHOLD;
    const unmatchedLines: vscode.Range[] = skipDim ? [] : [];

    for (const r of results) {
      if (r.groupId && r.color) {
        const lineLen = r.lineNumber < allLines.length ? allLines[r.lineNumber].length : 0;
        const fullRange = new vscode.Range(r.lineNumber, 0, r.lineNumber, lineLen);
        if (!groupLines.has(r.groupId)) {
          groupLines.set(r.groupId, []);
        }
        // 从行范围中减去关键字范围
        const kwMatches = kwByLine.get(r.lineNumber);
        if (kwMatches && kwMatches.length > 0) {
          const subtracted = this.subtractRanges(fullRange, kwMatches.map(m => m.range));
          for (const seg of subtracted) {
            groupLines.get(r.groupId)!.push(seg);
          }
        } else {
          groupLines.get(r.groupId)!.push(fullRange);
        }
      } else if (r.groupId === '__kw_visible__') {
        // 范围内被 keyword 匹配到的行：不 dim，关键字高亮由下方统一处理
        // （kwByLine 中已有该行的匹配信息）
      } else if (!skipDim) {
        const lineLen = r.lineNumber < allLines.length ? allLines[r.lineNumber].length : 0;
        unmatchedLines.push(new vscode.Range(r.lineNumber, 0, r.lineNumber, lineLen));
      }
    }

    // ── 3. 应用行级颜色装饰 ──
    for (const [groupId, ranges] of groupLines) {
      if (ranges.length === 0) { continue; }
      const result = results.find(r => r.groupId === groupId);
      const color = this.getGroupColor?.(groupId) ?? result?.color ?? '#ffffff';

      const key = `${groupId}_${color}`;
      if (!this.decorationTypes.has(key)) {
        this.decorationTypes.set(
          key,
          vscode.window.createTextEditorDecorationType({
            color,
            fontWeight: 'bold',
          })
        );
      }
      editor.setDecorations(this.decorationTypes.get(key)!, ranges);
    }

    // 未匹配行应用暗淡效果（仅对非关键字部分）。大文件跳过全量 dim，避免阻塞 UI。
    if (unmatchedLines.length > 0 && allLines.length <= LARGE_FILE_DIM_THRESHOLD) {
      editor.setDecorations(this.dimDecoration, unmatchedLines);
    }

    // ── 4. 应用关键字提示装饰（after text，按行聚合）──
    this.applyKeywordHints(kwByLine, keywords || [], editor);

    // ── 5. 应用关键字颜色装饰 ──
    // 按颜色分组合并关键字范围
    const kwByColor = new Map<string, vscode.Range[]>();
    for (const matches of kwByLine.values()) {
      for (const m of matches) {
        if (!kwByColor.has(m.color)) {
          kwByColor.set(m.color, []);
        }
        kwByColor.get(m.color)!.push(m.range);
      }
    }

    for (const [color, ranges] of kwByColor) {
      if (ranges.length === 0) { continue; }
      const decoType = vscode.window.createTextEditorDecorationType({
        color,
        fontWeight: 'bold',
      });
      this.keywordDecoTypes.push(decoType);
      editor.setDecorations(decoType, ranges);
    }
  }

  /** 在指定行 gutter 显示红旗图标（纯视觉指示，无点击交互） */
  showRingBufferFlag(startLine: number, editor: vscode.TextEditor): void {
    if (!this.ringBufferFlagDecoration) { return; }
    const range = new vscode.Range(startLine, 0, startLine, 0);
    editor.setDecorations(this.ringBufferFlagDecoration, [range]);
  }

  /** 清除红旗图标 */
  clearRingBufferFlag(): void {
    if (!this.ringBufferFlagDecoration || !this.editor) { return; }
    this.editor.setDecorations(this.ringBufferFlagDecoration, []);
  }

  /** 清除所有装饰（含关键字） */
  clear(): void {
    if (this.editor) {
      for (const dt of this.decorationTypes.values()) {
        this.editor.setDecorations(dt, []);
      }
      this.editor.setDecorations(this.dimDecoration, []);
      this.clearKeywordHighlights();
      this.clearRingBufferFlag();
    }
  }

  /** 清除关键字高亮装饰 */
  clearKeywordHighlights(): void {
    if (this.editor) {
      for (const dt of this.keywordDecoTypes) {
        this.editor.setDecorations(dt, []);
        dt.dispose();
      }
    }
    this.keywordDecoTypes = [];
    this.clearKeywordHints();
  }

  /** 清除关键字提示装饰 */
  clearKeywordHints(): void {
    if (this.editor) {
      for (const dt of this.keywordHintTypes) {
        this.editor.setDecorations(dt, []);
        dt.dispose();
      }
    }
    this.keywordHintTypes = [];
  }

  /** 应用关键字提示 after 装饰 */
  private applyKeywordHints(
    kwByLine: Map<number, KeywordMatch[]>,
    keywords: KeywordConfig[],
    editor: vscode.TextEditor
  ): void {
    this.clearKeywordHints();

    // 构建 keyword id → hint 的映射
    const hintMap = new Map<string, string>();
    for (const kw of keywords) {
      if (kw.hint) {
        hintMap.set(kw.id, kw.hint);
      }
    }
    if (hintMap.size === 0) { return; }

    // 按行聚合：每行的匹配关键字 id 去重后拼接 hints
    const lineHints = new Map<number, string>();
    for (const [lineNum, matches] of kwByLine) {
      const seenHints = new Set<string>();
      const hints: string[] = [];
      for (const m of matches) {
        const hint = hintMap.get(m.keywordId);
        if (hint && !seenHints.has(hint)) {
          seenHints.add(hint);
          // 用命名捕获组替换 {{name}} 占位符
          const resolved = m.groups
            ? hint.replace(/\{\{(\w+)\}\}/g, (_, name) => m.groups![name] || '')
            : hint;
          hints.push(resolved);
        }
      }
      if (hints.length > 0) {
        lineHints.set(lineNum, hints.join(' | '));
      }
    }

    if (lineHints.size === 0) { return; }

    // 为每行创建 after 装饰
    for (const [lineNum, hintText] of lineHints) {
      const decoType = vscode.window.createTextEditorDecorationType({
        after: {
          contentText: `keyword hint: ${hintText}`,
          color: new vscode.ThemeColor('descriptionForeground'),
          fontStyle: 'italic',
          margin: '0 0 0 12px',
        },
        isWholeLine: false,
      });
      this.keywordHintTypes.push(decoType);
      editor.setDecorations(decoType, [editor.document.lineAt(lineNum).range]);
    }
  }

  // ── 内部辅助 ──

  /**
   * 计算关键字的匹配位置。
   * matchScope='matched' 时仅扫描 matchedLineNums 中的行，
   * matchScope='full'（或未设置）时扫描 [scanStart, scanEnd) 内所有行。
   */
  private computeKeywordMatches(
    keywords: KeywordConfig[] | undefined,
    lines: string[],
    scanStart?: number,
    scanEnd?: number,
    matchedLineNums?: Set<number>
  ): Map<number, KeywordMatch[]> {
    const map = new Map<number, KeywordMatch[]>();
    if (!keywords || keywords.length === 0) { return map; }
    if (scanStart === undefined || scanEnd === undefined || scanStart >= scanEnd) { return map; }

    // 预编译 + 缓存 keyword 正则
    const compiled: { id: string; regex: RegExp; color: string; isMatchedScope: boolean }[] = [];
    for (const kw of keywords) {
      if (kw.enabled === false || !kw.pattern) { continue; }
      try {
        const flags = (kw.flags || '').includes('g') ? kw.flags : (kw.flags || '') + 'g';
        compiled.push({
          id: kw.id,
          regex: new RegExp(kw.pattern, flags),
          color: kw.color,
          isMatchedScope: !!(kw.matchScope === 'matched' && matchedLineNums && matchedLineNums.size > 0),
        });
      } catch { /* skip */ }
    }

    for (const c of compiled) {
      for (let i = scanStart; i < scanEnd; i++) {
        if (c.isMatchedScope && !matchedLineNums!.has(i)) { continue; }

        const line = lines[i];
        c.regex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = c.regex.exec(line)) !== null) {
          if (match[0].length === 0) { c.regex.lastIndex++; continue; }
          const startPos = new vscode.Position(i, match.index);
          const endPos = new vscode.Position(i, match.index + match[0].length);
          const range = new vscode.Range(startPos, endPos);
          if (!map.has(i)) { map.set(i, []); }
          map.get(i)!.push({ range, color: c.color, keywordId: c.id, groups: match.groups || undefined });
        }
      }
    }

    return map;
  }

  /**
   * 从一个主范围中减去一组子范围，返回不重叠的剩余分段。
   * 子范围必须已排序且不重叠（来自同一行的正则匹配自然满足）。
   */
  private subtractRanges(main: vscode.Range, subs: vscode.Range[]): vscode.Range[] {
    const result: vscode.Range[] = [];
    let cursor = main.start;

    for (const sub of subs) {
      if (sub.start.isAfter(cursor)) {
        // 前段：cursor 到 sub.start 之前
        result.push(new vscode.Range(
          cursor.line, cursor.character,
          sub.start.line, sub.start.character
        ));
      }
      // 光标跳到 sub.end
      if (sub.end.isAfter(cursor)) {
        cursor = sub.end;
      }
    }

    // 尾段：cursor 到 main.end
    if (main.end.isAfter(cursor)) {
      result.push(new vscode.Range(
        cursor.line, cursor.character,
        main.end.line, main.end.character
      ));
    }

    return result;
  }

  // ── 时间标注 ──

  private keywordHintTypes: vscode.TextEditorDecorationType[] = [];
  private timeAnnotationTypes: vscode.TextEditorDecorationType[] = [];

  /**
   * 在折叠区域上方的可见行末尾显示时间标注
   * 格式：▼ N lines | +elapsed from first match
   */
  applyTimeAnnotations(foldRanges: FoldRange[], editor: vscode.TextEditor): void {
    this.clearTimeAnnotations();

    for (const range of foldRanges) {
      const summary = this.formatFoldSummary(range);
      if (!summary) { continue; }

      // 标注在折叠区域前最后一行可见（匹配）行的末尾
      const lineBefore = range.start - 1;
      if (lineBefore < 0) { continue; }

      const decoType = vscode.window.createTextEditorDecorationType({
        after: {
          contentText: summary,
          color: new vscode.ThemeColor('descriptionForeground'),
          fontStyle: 'italic',
          margin: '0 0 0 12px',
        },
        isWholeLine: false,
      });
      this.timeAnnotationTypes.push(decoType);

      const lineRange = editor.document.lineAt(lineBefore).range;
      editor.setDecorations(decoType, [lineRange]);
    }
  }

  /** 清除时间标注装饰 */
  clearTimeAnnotations(): void {
    if (this.editor) {
      for (const dt of this.timeAnnotationTypes) {
        this.editor.setDecorations(dt, []);
        dt.dispose();
      }
    }
    this.timeAnnotationTypes = [];
  }

  /** 格式化折叠区间的时间摘要文本 */
  formatFoldSummary(range: FoldRange): string {
    const parts: string[] = [];
    parts.push(`▼ ${range.lineCount} ${range.lineCount === 1 ? 'line' : 'lines'}`);

    // 折叠区间内 keyword 命中统计
    if (range.keywordHits && range.keywordHits.length > 0) {
      const hitText = range.keywordHits
        .map(h => `${h.hint}(${h.count})`)
        .join(', ');
      parts.push(hitText);
    }

    // 折叠文本自身的时间跨度
    if (range.durationMs !== undefined) {
      parts.push(`~${this.formatDuration(range.durationMs)}`);
    }

    if (range.firstMatchTime && range.timeFrom) {
      const elapsedMs = range.timeFrom.getTime() - range.firstMatchTime.getTime();
      parts.push(`+${this.formatDuration(elapsedMs)}`);
    }

    return '  ' + parts.join('  │  ');
  }

  /** 格式化时间戳为显示字符串 */
  private formatTimestamp(date: Date): string {
    const pad = (n: number, len: number) => String(n).padStart(len, '0');
    return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)} `
      + `${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(), 2)}`
      + (date.getMilliseconds() > 0 ? `.${pad(date.getMilliseconds(), 3)}` : '');
  }

  /** 格式化时长 */
  private formatDuration(ms: number): string {
    if (ms < 0) { ms = -ms; }
    if (ms < 1000) { return `${ms}ms`; }
    if (ms < 60000) { return `${(ms / 1000).toFixed(1)}s`; }

    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const millis = ms % 1000;

    const parts: string[] = [];
    if (h > 0) { parts.push(`${h}h`); }
    if (m > 0) { parts.push(`${m}m`); }
    if (s > 0 || parts.length === 0) { parts.push(`${s}s`); }
    if (millis > 0 && h === 0) { parts[parts.length - 1] = `${s}.${String(millis).padStart(3, '0')}s`; }
    return parts.join(' ');
  }

  /** 刷新装饰（文档变更后重新绘制） */
  refresh(): void {
    // 装饰在重新 apply 时自动刷新
  }

  dispose(): void {
    this.clear();
    this.clearTimeAnnotations();
    for (const dt of this.decorationTypes.values()) {
      dt.dispose();
    }
    this.decorationTypes.clear();
    this.dimDecoration.dispose();
  }
}
