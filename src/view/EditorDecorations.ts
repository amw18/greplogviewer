// EditorDecorations — 行颜色高亮装饰管理
import * as vscode from 'vscode';
import { FilterResult, FoldRange } from '../types';

export class EditorDecorations {
  private decorationTypes = new Map<string, vscode.TextEditorDecorationType>();
  /** 未匹配行装饰类型（降低透明度） */
  private dimDecoration: vscode.TextEditorDecorationType;
  private editor: vscode.TextEditor | undefined;

  constructor() {
    this.dimDecoration = vscode.window.createTextEditorDecorationType({
      opacity: '0.3',
    });
  }

  /**
   * 应用过滤结果到编辑器
   * - 匹配行：按组颜色高亮
   * - 未匹配行：降低透明度
   */
  apply(results: FilterResult[], editor: vscode.TextEditor): void {
    this.clear();
    this.editor = editor;

    // 按 groupId 分组匹配行
    const groupLines = new Map<string, vscode.Range[]>();
    const unmatchedLines: vscode.Range[] = [];

    for (const r of results) {
      if (r.groupId && r.color) {
        if (!groupLines.has(r.groupId)) {
          groupLines.set(r.groupId, []);
        }
        const range = editor.document.lineAt(r.lineNumber).range;
        groupLines.get(r.groupId)!.push(range);
      } else {
        const range = editor.document.lineAt(r.lineNumber).range;
        unmatchedLines.push(range);
      }
    }

    // 为每组创建对应颜色的装饰类型并应用
    for (const [groupId, ranges] of groupLines) {
      const result = results.find(r => r.groupId === groupId);
      const color = result?.color ?? '#ffffff';

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

    // 未匹配行应用暗淡效果
    if (unmatchedLines.length > 0) {
      editor.setDecorations(this.dimDecoration, unmatchedLines);
    }
  }

  /** 清除所有装饰 */
  clear(): void {
    if (this.editor) {
      for (const dt of this.decorationTypes.values()) {
        this.editor.setDecorations(dt, []);
      }
      this.editor.setDecorations(this.dimDecoration, []);
    }
  }

  private timeAnnotationTypes: vscode.TextEditorDecorationType[] = [];

  /**
   * 在折叠区域上方的可见行末尾显示时间标注
   * 格式：▼ N lines | timeFrom → timeTo | duration
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
  private formatFoldSummary(range: FoldRange): string {
    const parts: string[] = [];
    parts.push(`▼ ${range.lineCount} ${range.lineCount === 1 ? 'line' : 'lines'}`);

    if (range.timeFrom || range.timeTo) {
      const from = range.timeFrom ? this.formatTimestamp(range.timeFrom) : '?';
      const to = range.timeTo ? this.formatTimestamp(range.timeTo) : '?';
      parts.push(`${from} → ${to}`);
    }

    if (range.durationMs !== undefined) {
      parts.push(this.formatDuration(range.durationMs));
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
