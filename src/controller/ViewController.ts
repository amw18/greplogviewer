// ViewController — 协调 View 和 Controller，管理编辑器生命周期
import * as vscode from 'vscode';
import * as fs from 'fs';
import { RegexGroup, TimePatternConfig, KeywordConfig, ConfigScope, FoldRange } from '../types';
import { ConfigController } from './ConfigController';
import { FilterController } from './FilterController';
import { EditorStateModel } from '../model/EditorStateModel';
import { FilterResultModel } from '../model/FilterResultModel';
import { RegexGroupModel } from '../model/RegexGroupModel';
import { TimeMatchModel } from '../model/TimeMatchModel';
import { ConfigStorageModel } from '../model/ConfigStorageModel';
import { uuid } from '../model/uuid';
import { ConfigPanel } from '../view/ConfigPanel';
import { EditorDecorations } from '../view/EditorDecorations';
import { KeywordTimeline } from '../view/KeywordTimeline';

export class ViewController {
  /** 用于标记范围内被 keyword 匹配但未被 group 匹配的行。这些行不参与折叠也不 dim。 */
  private static readonly KW_VISIBLE_ID = '__kw_visible__';

  /** 安全构建 keyword 正则：null-safe flags + 移除 g 标志避免 test() 状态残留 */
  private static buildKwRegex(kw: KeywordConfig): RegExp | null {
    if (!kw.pattern) { return null; }
    const flags = (kw.flags || '').replace(/g/g, '');
    try { return new RegExp(kw.pattern, flags); } catch { return null; }
  }
  private configPanel: ConfigPanel;
  private decorations: EditorDecorations;
  private currentEditor: vscode.TextEditor | undefined;
  private currentStartPattern?: string;
  private currentEndPattern?: string;
  private currentRangeDescription?: string;
  private currentNamedRanges?: import('../types').NamedRange[];
  private currentActiveRangeId?: string;
  private currentKeywords?: KeywordConfig[];
  private isApplyingGo = false;  // 防止 Go 期间的 attach 重入

  constructor(
    configController: ConfigController,
    private filterController: FilterController,
    private editorStateModel: EditorStateModel,
    private filterResultModel: FilterResultModel,
    private regexGroupModel: RegexGroupModel,
    private timeMatchModel: TimeMatchModel,
    private configStorageModel: ConfigStorageModel,
    private timeline: KeywordTimeline
  ) {
    this.configPanel = new ConfigPanel();
    this.decorations = new EditorDecorations();

    this.configPanel.onGo((g, sp, ep, rd, nr, ar, tp, kw) => this.handleGo(g, sp, ep, rd, nr, ar, tp, kw));
    this.configPanel.onReset(() => this.handleReset());
    this.configPanel.onClear(() => this.handleClear());

    // Config management callbacks
    this.configPanel.onExport((g, sp, ep, rd, nr, ar, tp, kw) => this.handleExport(g, sp, ep, rd, nr, ar, tp, kw));
    this.configPanel.onImport(() => this.handleImport());
    this.configPanel.onSave((n, sc, g, sp, ep, rd, nr, ar, tp, kw) => this.handleSave(n, sc, g, sp, ep, rd, nr, ar, tp, kw));
    this.configPanel.onListSaved(() => this.handleListSaved());
    this.configPanel.onApply((n, sc) => this.handleApply(n, sc));
    this.configPanel.onDelete((n, sc) => this.handleDelete(n, sc));
    this.configPanel.onSyncConfig((g, sp, ep, rd, nr, ar, tp, kw) => this.handleSyncConfig(g, sp, ep, rd, nr, ar, tp, kw));
  }

  getPanelProvider(): ConfigPanel {
    return this.configPanel;
  }

  /** 获取当前编辑器（供 GrepController 使用） */
  getCurrentEditor(): vscode.TextEditor | undefined {
    return this.currentEditor;
  }

  /** 切换编辑器，激活状态则恢复效果，否则只加载配置 */
  async attach(editor: vscode.TextEditor): Promise<void> {
    this.decorations.clear();
    this.currentEditor = editor;

    const editorId = editor.document.uri.toString();
    const savedConfig = this.editorStateModel.loadConfig(editorId);

    if (savedConfig) {
      this.regexGroupModel.setGroups(savedConfig.groups);
      this.currentStartPattern = savedConfig.startPattern;
      this.currentEndPattern = savedConfig.endPattern;
      this.currentRangeDescription = savedConfig.rangeDescription;
      this.currentNamedRanges = savedConfig.namedRanges;
      this.currentActiveRangeId = savedConfig.activeRangeId;

      // 恢复时间匹配配置
      if (savedConfig.timePattern) {
        this.timeMatchModel.setConfig(savedConfig.timePattern);
      }

      // 恢复关键字配置
      this.currentKeywords = savedConfig.keywords;

      if (this.editorStateModel.isActive(editorId)) {
        // 已激活：恢复颜色装饰 + 关键字高亮 + 时间标注（折叠由 VS Code 自动保持）
        const lines = this.readLines(editor);
        const results = this.filterController.filter(
          lines, savedConfig.groups,
          savedConfig.startPattern, savedConfig.endPattern
        );
        this.filterResultModel.setResults(editorId, results);

        // 计算扫描范围（与 filter 内部一致）
        const scanStart = savedConfig.startPattern !== undefined
          ? this.filterController.findFirstMatchLine(lines, savedConfig.startPattern) : 0;
        const scanEnd = savedConfig.endPattern !== undefined
          ? this.filterController.findFirstMatchLine(lines, savedConfig.endPattern, lines.length) : lines.length;

        // 范围内被 keyword 匹配但未被 group 匹配的行 → 标记为可见
        this.markKeywordVisibleLines(results, lines, this.currentKeywords, scanStart, scanEnd);

        this.decorations.apply(results, editor, this.currentKeywords, scanStart, scanEnd);

        // 恢复时间标注
        this.applyFoldAnnotations(editor, editorId, lines, this.currentKeywords);

        // Go 期间 attach 被 showTextDocument 触发时不重发 timeline/matchCounts
        if (!this.isApplyingGo) {
          this.sendTimelineData(editorId, lines, this.currentKeywords, scanStart, scanEnd);
          this.sendMatchCounts(editorId, lines, this.currentKeywords, scanStart, scanEnd);
        }
      } else {
        // 未激活但有旧配置：清除持久化的手动折叠残留
        await this.removeAllManualFolds(editor);
      }
    } else {
      this.regexGroupModel.setGroups([]);
      this.currentStartPattern = undefined;
      this.currentEndPattern = undefined;
      this.currentRangeDescription = undefined;
      this.currentNamedRanges = undefined;
      this.currentActiveRangeId = undefined;
    }

    // 自动检测时间格式（仅在未配置时）
    if (!this.timeMatchModel.isConfigured() && !savedConfig?.timePattern) {
      const sampleLines = this.readLines(editor);
      const autoTp = this.timeMatchModel.autoDetect(sampleLines);
      if (autoTp) {
        this.timeMatchModel.setConfig(autoTp);
      }
    }

    const tp = this.timeMatchModel.getConfig();
    this.configPanel.render(
      this.regexGroupModel.getGroups(),
      this.currentStartPattern, this.currentEndPattern,
      this.currentRangeDescription,
      this.currentNamedRanges,
      this.currentActiveRangeId,
      tp.format ? tp : undefined,
      this.currentKeywords
    );
  }

  /** 实时同步配置（不触发过滤），供 grep 等无需 Go 的功能使用 */
  private handleSyncConfig(groups: RegexGroup[], startPattern?: string, endPattern?: string, rangeDescription?: string, namedRanges?: import('../types').NamedRange[], activeRangeId?: string, timePattern?: TimePatternConfig, keywords?: KeywordConfig[]): void {
    if (!this.currentEditor) { return; }
    const editorId = this.currentEditor.document.uri.toString();

    this.regexGroupModel.setGroups(groups);
    this.currentStartPattern = startPattern;
    this.currentEndPattern = endPattern;
    this.currentRangeDescription = rangeDescription;
    this.currentNamedRanges = namedRanges;
    this.currentActiveRangeId = activeRangeId;
    this.currentKeywords = keywords;

    if (timePattern && timePattern.format) {
      this.timeMatchModel.setConfig(timePattern);
    }

    // 持久化到 workspaceState（grepKeyword/grepFunction 从此读取）
    this.editorStateModel.saveConfig(editorId, {
      groups, startPattern, endPattern, rangeDescription,
      namedRanges, activeRangeId,
      timePattern: this.timeMatchModel.isConfigured() ? this.timeMatchModel.getConfig() : undefined,
      keywords,
    });
  }

  /** Go: 应用过滤 + 颜色高亮 + 创建折叠 + 时间标注 */
  private async handleGo(groups: RegexGroup[], startPattern?: string, endPattern?: string, rangeDescription?: string, namedRanges?: import('../types').NamedRange[], activeRangeId?: string, timePattern?: TimePatternConfig, keywords?: KeywordConfig[]): Promise<void> {
    if (!this.currentEditor) { return; }
    const editor = this.currentEditor;
    const editorId = editor.document.uri.toString();

    this.regexGroupModel.setGroups(groups);
    this.currentStartPattern = startPattern;
    this.currentEndPattern = endPattern;
    this.currentRangeDescription = rangeDescription;
    this.currentNamedRanges = namedRanges;
    this.currentActiveRangeId = activeRangeId;

    // 时间匹配配置
    if (timePattern && timePattern.format) {
      this.timeMatchModel.setConfig(timePattern);
    }

    // 关键字配置
    this.currentKeywords = keywords;

    this.editorStateModel.saveConfig(editorId, {
      groups, startPattern, endPattern, rangeDescription,
      namedRanges, activeRangeId,
      timePattern: this.timeMatchModel.isConfigured() ? this.timeMatchModel.getConfig() : undefined,
      keywords,
    });
    this.editorStateModel.setActive(editorId, true);

    const lines = this.readLines(editor);
    const results = this.filterController.filter(lines, groups, startPattern, endPattern);

    // 计算扫描范围（与 filter 内部一致）
    const scanStart = startPattern !== undefined ? this.filterController.findFirstMatchLine(lines, startPattern) : 0;
    const scanEnd = endPattern !== undefined ? this.filterController.findFirstMatchLine(lines, endPattern, lines.length) : lines.length;

    // 范围内被 keyword 匹配但未被 group 匹配的行 → 标记为可见，不参与折叠
    this.markKeywordVisibleLines(results, lines, keywords, scanStart, scanEnd);

    this.filterResultModel.setResults(editorId, results);
    this.decorations.apply(results, editor, keywords, scanStart, scanEnd);

    // 折叠标注（含时间 + keyword 命中统计）
    this.applyFoldAnnotations(editor, editorId, lines, keywords);

    this.isApplyingGo = true;
    await this.applyFolding(editor);
    this.isApplyingGo = false;

    // 发送范围时间信息到 webview
    this.sendRangeTimeInfo(editorId, lines);

    // 发送时间线图表数据
    this.sendTimelineData(editorId, lines, keywords, scanStart, scanEnd);

    // 发送匹配行数统计
    this.sendMatchCounts(editorId, lines, keywords, scanStart, scanEnd);
  }

  /** 计算范围时间信息并发送到 webview */
  private sendRangeTimeInfo(editorId: string, lines: string[]): void {
    if (!this.timeMatchModel.isConfigured()) { return; }
    const matchedLines = this.filterResultModel.getMatchedLines(editorId);
    if (matchedLines.length === 0) { return; }

    const info = this.timeMatchModel.computeRangeTimeInfo(matchedLines, lines);
    this.configPanel.sendRangeTimeInfo(info);
  }

  /** 计算时间线数据并发送到 KeywordTimeline webview */
  private sendTimelineData(
    editorId: string,
    lines: string[],
    keywords?: import('../types').KeywordConfig[],
    scanStart?: number,
    scanEnd?: number
  ): void {
    if (!keywords || keywords.length === 0) {
      this.timeline.sendTimelineData({
        type: 'timelineData',
        timeMin: 0,
        timeMax: 1,
        keywords: [],
      });
      this.configPanel.sendTimelineData({
        type: 'timelineData',
        timeMin: 0,
        timeMax: 1,
        keywords: [],
      });
      return;
    }

    const kwData: import('../types').TimelineKeyword[] = [];
    let globalMin = Infinity;
    let globalMax = -Infinity;

    for (const kw of keywords) {
      if (kw.enabled === false) { continue; }
      if (!kw.pattern) { continue; }
      const regex = ViewController.buildKwRegex(kw);
      if (!regex) { continue; }

      const points: import('../types').TimelinePoint[] = [];
      const start = scanStart ?? 0;
      const end = scanEnd ?? lines.length;

      for (let i = start; i < end; i++) {
        if (!regex.test(lines[i])) { continue; }
        const ts = this.timeMatchModel.parseLineTimestamp(lines[i]);
        if (!ts) { continue; }
        const ms = ts.getTime();
        if (ms < globalMin) { globalMin = ms; }
        if (ms > globalMax) { globalMax = ms; }
        points.push({ lineNumber: i, time: ms });
      }

      if (points.length > 0) {
        kwData.push({
          name: kw.hint || kw.pattern,
          color: kw.color,
          points,
        });
      }
    }

    if (globalMin === Infinity || globalMax === -Infinity) {
      globalMin = 0;
      globalMax = 1;
    } else if (globalMin === globalMax) {
      // 单点情况：扩展范围使点可见
      globalMin -= 1000;
      globalMax += 1000;
    }

    const tlMsg = {
      type: 'timelineData' as const,
      timeMin: globalMin,
      timeMax: globalMax,
      keywords: kwData,
    };
    this.timeline.sendTimelineData(tlMsg);
    this.configPanel.sendTimelineData(tlMsg);
  }

  /** 计算匹配行数并发送到 webview */
  private sendMatchCounts(
    editorId: string,
    lines: string[],
    keywords?: import('../types').KeywordConfig[],
    scanStart?: number,
    scanEnd?: number
  ): void {
    const results = this.filterResultModel.getResults(editorId);
    if (!results) { return; }

    const totalLines = lines.length;
    const matchedSet = new Set<number>();
    const groupCounts: Record<string, number> = {};

    for (const r of results) {
      if (r.groupId && r.groupId !== '__kw_visible__') {
        matchedSet.add(r.lineNumber);
        groupCounts[r.groupId] = (groupCounts[r.groupId] || 0) + 1;
      } else if (r.groupId === '__kw_visible__') {
        matchedSet.add(r.lineNumber);
      }
    }

    const keywordCounts: Record<string, number> = {};
    if (keywords && keywords.length > 0) {
      const start = scanStart ?? 0;
      const end = scanEnd ?? lines.length;
      for (const kw of keywords) {
        if (kw.enabled === false || !kw.pattern) { continue; }
        const regex = ViewController.buildKwRegex(kw);
        if (!regex) { continue; }
        let count = 0;
        for (let i = start; i < end; i++) {
          if (regex.test(lines[i])) { count++; matchedSet.add(i); }
        }
        if (count > 0) { keywordCounts[kw.id] = count; }
      }
    }

    this.configPanel.sendMatchCounts({
      type: 'matchCounts',
      totalLines,
      totalMatched: matchedSet.size,
      groupCounts,
      keywordCounts,
    });
  }

  /** Timeline 点击：跳转到指定行 */
  private handleTimelineClick(lineNumber: number): void {
    const editor = this.currentEditor;
    if (!editor) { return; }
    const pos = new vscode.Position(lineNumber, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  }

  /**
   * 计算并应用折叠行标注（始终显示行数 + 可选 keyword 命中 + 可选时间信息）。
   * 无 Time Pattern 时也显示 ▼ N lines 和 keyword 命中统计。
   */
  private applyFoldAnnotations(
    editor: vscode.TextEditor,
    editorId: string,
    lines: string[],
    keywords?: KeywordConfig[]
  ): void {
    const rawRanges = this.filterResultModel.getUnmatchedRanges(editorId);
    if (rawRanges.length === 0) {
      this.decorations.clearTimeAnnotations();
      return;
    }

    // 构建 FoldRange（含可选的时间元数据）
    let foldRanges: FoldRange[];
    if (this.timeMatchModel.isConfigured()) {
      foldRanges = this.timeMatchModel.computeFoldRanges(
        rawRanges, lines, editor.document.lineCount
      );
    } else {
      foldRanges = rawRanges.map(r => ({
        start: r.start,
        end: r.end,
        lineCount: r.end - r.start + 1,
      }));
    }

    // 丰富 keyword 命中统计
    if (keywords && keywords.length > 0) {
      foldRanges = this.enrichWithKeywordHits(foldRanges, lines, keywords);
    }

    this.decorations.applyTimeAnnotations(foldRanges, editor);
  }

  /** 为每个折叠区间计算 keyword 匹配行数 */
  private enrichWithKeywordHits(
    foldRanges: FoldRange[],
    lines: string[],
    keywords: KeywordConfig[]
  ): FoldRange[] {
    return foldRanges.map(fr => {
      const hitMap = new Map<string, { hint: string; count: number }>();
      for (const kw of keywords) {
        if (kw.enabled === false) { continue; }
        const regex = ViewController.buildKwRegex(kw);
        if (!regex) { continue; }
        let count = 0;
        for (let i = fr.start; i <= fr.end; i++) {
          if (regex.test(lines[i])) { count++; }
        }
        if (count > 0) {
          const hint = kw.hint || kw.pattern;
          hitMap.set(kw.id, { hint, count });
        }
      }
      return {
        ...fr,
        keywordHits: hitMap.size > 0 ? Array.from(hitMap.values()) : undefined,
      };
    });
  }

  /**
   * 将 [scanStart, scanEnd) 范围内被 keyword 匹配到但未被 group 匹配的行
   * 标记为可见（groupId = KW_VISIBLE_ID），使其不被折叠也不被 dim。
   */
  private markKeywordVisibleLines(
    results: import('../types').FilterResult[],
    lines: string[],
    keywords?: KeywordConfig[],
    scanStart?: number,
    scanEnd?: number
  ): void {
    if (!keywords || keywords.length === 0 || scanStart === undefined || scanEnd === undefined) {
      return;
    }
    // 预编译启用的 keyword 正则
    const kwRegexes: RegExp[] = [];
    // 分离 full 和 matched scope 的 keyword
    const fullKwRegexes: RegExp[] = [];
    const matchedKwRegexes: RegExp[] = [];
    for (const kw of keywords) {
      if (kw.enabled === false) { continue; }
      const re = ViewController.buildKwRegex(kw);
      if (!re) { continue; }
      if (kw.matchScope === 'matched') {
        matchedKwRegexes.push(re);
      } else {
        // 未设置 matchScope 时默认 'full'（向后兼容）
        fullKwRegexes.push(re);
      }
    }

    // 'full' scope: 标记未匹配的 keyword 命中行为可见（现有行为）
    if (fullKwRegexes.length > 0) {
      for (const r of results) {
        if (r.groupId !== null) { continue; }
        if (r.lineNumber >= scanStart && r.lineNumber < scanEnd
            && fullKwRegexes.some(re => re.test(lines[r.lineNumber]))) {
          r.groupId = ViewController.KW_VISIBLE_ID;
        }
      }
    }
  }

  /**
   * 折叠所有未匹配行区间。
   *
   * 关键：先聚焦编辑器再执行 fold 命令（侧边栏点击 Go 后编辑器可能失焦），
   * 然后移除所有旧手动折叠并从底向上创建新区间，避免上层折叠导致视口偏移
   * 干扰后续 createFoldingRangeFromSelection 调用。
   */
  private async applyFolding(editor: vscode.TextEditor): Promise<void> {
    const editorId = editor.document.uri.toString();
    const ranges = this.filterResultModel.getUnmatchedRanges(editorId);

    const savedSelection = editor.selection;

    // 确保编辑器有焦点（侧边栏点击可能使编辑器失焦，导致 fold 命令失效）
    await vscode.window.showTextDocument(editor.document, {
      viewColumn: editor.viewColumn,
      preserveFocus: false,
    });

    // 移除所有旧的手动折叠（unfoldAll 仅展开而不移除，残留会影响新折叠）
    await vscode.commands.executeCommand('editor.unfoldAll');
    const lastLine = editor.document.lineCount - 1;
    editor.selection = new vscode.Selection(0, 0, lastLine, editor.document.lineAt(lastLine).text.length);
    await vscode.commands.executeCommand('editor.removeManualFoldingRanges');

    if (ranges.length === 0) {
      editor.selection = savedSelection;
      return;
    }

    // 从底向上创建折叠区间：底部的折叠不会影响上方行号，避免视口偏移干扰
    for (let i = ranges.length - 1; i >= 0; i--) {
      const range = ranges[i];
      if (range.start >= range.end) { continue; }
      const endLen = editor.document.lineAt(range.end).text.length;
      editor.selection = new vscode.Selection(range.start, 0, range.end, endLen);
      await vscode.commands.executeCommand('editor.createFoldingRangeFromSelection');
    }

    // 如果光标落在折叠区域内，将其移到折叠区前最后一个匹配行
    editor.selection = this.adjustCursorOutOfFolds(savedSelection, ranges, editorId);
  }

  /**
   * 若光标落在折叠区间内，则将其移到该区间前最后一个匹配行；
   * 若前面无匹配行则移到区间后第一个匹配行；若仍无匹配行则保持原位。
   */
  private adjustCursorOutOfFolds(
    savedSelection: vscode.Selection,
    ranges: Array<{ start: number; end: number }>,
    editorId: string
  ): vscode.Selection {
    const cursorLine = savedSelection.active.line;
    const matchedLines = this.filterResultModel.getMatchedLines(editorId);
    if (matchedLines.length === 0) { return savedSelection; }
    matchedLines.sort((a, b) => a - b);

    // 找到包含光标的折叠区间
    for (const range of ranges) {
      if (cursorLine >= range.start && cursorLine <= range.end) {
        // 向前查找该区间前最后一个匹配行
        let targetLine: number | undefined;
        for (let i = matchedLines.length - 1; i >= 0; i--) {
          if (matchedLines[i] < range.start) {
            targetLine = matchedLines[i];
            break;
          }
        }
        // 向前没找到，向后找第一个匹配行
        if (targetLine === undefined) {
          for (const ml of matchedLines) {
            if (ml > range.end) {
              targetLine = ml;
              break;
            }
          }
        }
        if (targetLine !== undefined) {
          const pos = new vscode.Position(targetLine, 0);
          return new vscode.Selection(pos, pos);
        }
        break;
      }
    }
    return savedSelection;
  }

  /** Clear: 清除所有显示效果（高亮+折叠+时间标注），保留配置 */
  private async handleClear(): Promise<void> {
    if (!this.currentEditor) { return; }
    const editor = this.currentEditor;
    const editorId = editor.document.uri.toString();

    this.editorStateModel.setActive(editorId, false);
    this.filterResultModel.clearResults(editorId);
    this.decorations.clear();
    this.decorations.clearTimeAnnotations();
    await this.removeAllManualFolds(editor);
  }

  /** Reset: 清除配置 + 显示效果 */
  private async handleReset(): Promise<void> {
    if (!this.currentEditor) { return; }
    const editor = this.currentEditor;
    const editorId = editor.document.uri.toString();

    this.regexGroupModel.setGroups([]);
    this.currentStartPattern = undefined;
    this.currentEndPattern = undefined;
    this.currentRangeDescription = undefined;
    this.currentNamedRanges = undefined;
    this.currentActiveRangeId = undefined;
    this.currentKeywords = undefined;
    this.timeMatchModel.setConfig({ format: '' });
    this.editorStateModel.clearEditor(editorId);
    this.filterResultModel.clearResults(editorId);
    this.decorations.clear();
    this.decorations.clearTimeAnnotations();
    await this.removeAllManualFolds(editor);
  }

  /** 使用 VS Code 原生 API 清除指定编辑器的所有手动折叠 */
  private async removeAllManualFolds(editor: vscode.TextEditor): Promise<void> {
    const savedSelection = editor.selection;
    await vscode.commands.executeCommand('editor.unfoldAll');
    const lastLine = editor.document.lineCount - 1;
    editor.selection = new vscode.Selection(0, 0, lastLine, editor.document.lineAt(lastLine).text.length);
    await vscode.commands.executeCommand('editor.removeManualFoldingRanges');
    editor.selection = savedSelection;
  }

  /** 文档变更时重新过滤（仅已激活编辑器） */
  onDocumentChange(document: vscode.TextDocument): void {
    if (!this.currentEditor) { return; }
    if (document !== this.currentEditor.document) { return; }

    const editor = this.currentEditor;
    const editorId = editor.document.uri.toString();
    if (!this.editorStateModel.isActive(editorId)) { return; }

    const groups = this.regexGroupModel.getGroups();
    if (groups.length === 0) { return; }

    const lines = this.readLines(editor);
    const results = this.filterController.filter(lines, groups, this.currentStartPattern, this.currentEndPattern);
    this.filterResultModel.setResults(editorId, results);
    this.decorations.apply(results, editor, this.currentKeywords);

    // 重新计算折叠标注
    this.applyFoldAnnotations(editor, editorId, lines, this.currentKeywords);
  }

  private readLines(editor: vscode.TextEditor): string[] {
    const lines: string[] = [];
    for (let i = 0; i < editor.document.lineCount; i++) {
      lines.push(editor.document.lineAt(i).text);
    }
    return lines;
  }

  // ── Config Management Handlers ──

  /** Export: 将当前配置写入用户指定的本地 JSON 文件 */
  private async handleExport(groups: RegexGroup[], startPattern?: string, endPattern?: string, rangeDescription?: string, namedRanges?: import('../types').NamedRange[], activeRangeId?: string, timePattern?: TimePatternConfig, keywords?: KeywordConfig[]): Promise<void> {
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file('greplogviewer-config.json'),
      filters: { 'JSON Files': ['json'] },
    });
    if (!uri) { return; }

    const content = JSON.stringify({ groups, startPattern, endPattern, rangeDescription, namedRanges, activeRangeId, timePattern, keywords }, null, 2);
    try {
      fs.writeFileSync(uri.fsPath, content, 'utf-8');
      vscode.window.showInformationMessage(`Config exported to ${uri.fsPath}`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Export failed: ${err.message}`);
    }
  }

  /** Import: 从用户指定的本地 JSON 文件加载配置到面板 */
  private async handleImport(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { 'JSON Files': ['json'] },
    });
    if (!uris || uris.length === 0) { return; }

    try {
      const raw = fs.readFileSync(uris[0].fsPath, 'utf-8');
      const data = JSON.parse(raw);
      // 兼容：允许仅有 groups，也允许包含完整 EditorConfig
      const groups = Array.isArray(data.groups) ? data.groups : (Array.isArray(data) ? data : []);
      if (!Array.isArray(groups) || groups.length === 0) {
        vscode.window.showErrorMessage('Import failed: Invalid config format — expected an object with a "groups" array.');
        return;
      }
      this.configPanel.sendConfigImported({
        groups,
        startPattern: data.startPattern,
        endPattern: data.endPattern,
        rangeDescription: data.rangeDescription,
        namedRanges: data.namedRanges,
        activeRangeId: data.activeRangeId,
        timePattern: data.timePattern,
        keywords: data.keywords,
      });
      vscode.window.showInformationMessage(`Config imported from ${uris[0].fsPath}`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Import failed: ${err.message}`);
      this.configPanel.sendConfigImported(undefined, err.message);
    }
  }

  /** Save: 将当前配置保存到 workspaceState 或 globalState（命名） */
  private async handleSave(name: string, scope: ConfigScope, groups: RegexGroup[], startPattern?: string, endPattern?: string, rangeDescription?: string, namedRanges?: import('../types').NamedRange[], activeRangeId?: string, timePattern?: TimePatternConfig, keywords?: KeywordConfig[]): Promise<void> {
    if (this.configStorageModel.exists(name, scope)) {
      const answer = await vscode.window.showWarningMessage(
        `Config "${name}" already exists in ${scope}. Overwrite?`,
        { modal: true },
        'Overwrite'
      );
      if (answer !== 'Overwrite') { return; }
    }

    await this.configStorageModel.save(name, {
      groups, startPattern, endPattern, rangeDescription, namedRanges, activeRangeId, timePattern, keywords,
    }, scope);

    vscode.window.showInformationMessage(`Config "${name}" saved to ${scope}.`);
    // Refresh the webview dropdown
    this.handleListSaved();
  }

  /** 列出所有已保存配置并发送到 webview */
  private handleListSaved(): void {
    const configs = this.configStorageModel.listAll();
    this.configPanel.sendSavedConfigsList(configs);
  }

  /** Apply: 加载指定命名配置到面板（不自动生效，用户仍需点 Go） */
  private handleApply(name: string, scope: ConfigScope): void {
    const entry = this.configStorageModel.get(name, scope);
    if (!entry) {
      vscode.window.showErrorMessage(`Config "${name}" not found in ${scope}.`);
      return;
    }

    this.configPanel.sendConfigApplied(
      entry.config.groups,
      entry.config.startPattern,
      entry.config.endPattern,
      entry.config.rangeDescription,
      entry.config.namedRanges,
      entry.config.activeRangeId,
      entry.config.timePattern,
      entry.config.keywords,
    );
  }

  /** Delete: 删除指定命名配置 */
  private async handleDelete(name: string, scope: ConfigScope): Promise<void> {
    const answer = await vscode.window.showWarningMessage(
      `Delete saved config "${name}" (${scope})?`,
      { modal: true },
      'Delete'
    );
    if (answer !== 'Delete') { return; }

    try {
      const deleted = await this.configStorageModel.delete(name, scope);
      if (!deleted) {
        vscode.window.showErrorMessage(`Config "${name}" not found in ${scope}.`);
        return;
      }
      vscode.window.showInformationMessage(`Config "${name}" deleted from ${scope}.`);
      this.handleListSaved();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Delete failed: ${err?.message || err}`);
    }
  }

  /** 跳转到当前光标位置的上一个/下一个 group 匹配行 */
  private handleGotoGroupMatch(direction: 'prev' | 'next'): void {
    const editor = this.currentEditor;
    if (!editor) { return; }
    const editorId = editor.document.uri.toString();
    if (!this.editorStateModel.isActive(editorId)) { return; }

    const matchedLines = this.filterResultModel.getMatchedLines(editorId);
    if (matchedLines.length === 0) { return; }

    matchedLines.sort((a, b) => a - b);
    const currentLine = editor.selection.active.line;

    let targetLine: number | undefined;
    if (direction === 'next') {
      for (const l of matchedLines) {
        if (l > currentLine) { targetLine = l; break; }
      }
      if (targetLine === undefined) { targetLine = matchedLines[0]; }
    } else {
      for (let i = matchedLines.length - 1; i >= 0; i--) {
        if (matchedLines[i] < currentLine) { targetLine = matchedLines[i]; break; }
      }
      if (targetLine === undefined) { targetLine = matchedLines[matchedLines.length - 1]; }
    }

    if (targetLine !== undefined) {
      const pos = new vscode.Position(targetLine, 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }
  }

  /** 跳转到当前光标位置的下一个/上一个关键字匹配行 */
  private handleGotoKeywordMatch(direction: 'next' | 'prev'): void {
    const editor = this.currentEditor;
    if (!editor) { return; }
    const editorId = editor.document.uri.toString();
    if (!this.editorStateModel.isActive(editorId)) { return; }

    const keywords = this.currentKeywords;
    if (!keywords || keywords.length === 0) { return; }

    const allLines = this.readLines(editor);
    const matchedLineSet = this.computeKeywordMatchedLines(allLines, keywords);
    if (matchedLineSet.size === 0) { return; }

    const currentLine = editor.selection.active.line;
    const sortedLines = Array.from(matchedLineSet).sort((a, b) => a - b);

    let targetLine: number | undefined;
    if (direction === 'next') {
      // 找 > currentLine 的最小行号
      for (const l of sortedLines) {
        if (l > currentLine) { targetLine = l; break; }
      }
      // 没找到则循环到开头
      if (targetLine === undefined && sortedLines.length > 0) {
        targetLine = sortedLines[0];
      }
    } else {
      // 找 < currentLine 的最大行号
      for (let i = sortedLines.length - 1; i >= 0; i--) {
        if (sortedLines[i] < currentLine) { targetLine = sortedLines[i]; break; }
      }
      // 没找到则循环到末尾
      if (targetLine === undefined && sortedLines.length > 0) {
        targetLine = sortedLines[sortedLines.length - 1];
      }
    }

    if (targetLine !== undefined) {
      const pos = new vscode.Position(targetLine, 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }
  }

  /** 计算所有包含关键字匹配的行号集合 */
  private computeKeywordMatchedLines(lines: string[], keywords: import('../types').KeywordConfig[]): Set<number> {
    const matchedLines = new Set<number>();
    for (const kw of keywords) {
      if (kw.enabled === false) { continue; }
      const regex = ViewController.buildKwRegex(kw);
      if (!regex) { continue; }
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          matchedLines.add(i);
        }
      }
    }
    return matchedLines;
  }

  /** 右键菜单：将选中的文本添加为 keyword 并立即应用 */
  async addKeyword(pattern: string): Promise<void> {
    if (!pattern || !this.currentEditor) { return; }

    const hue = (this.currentKeywords?.length ?? 0) * 137.5 % 360;
    const color = `hsl(${hue}, 70%, 55%)`;

    const newKw: KeywordConfig = {
      id: uuid(),
      pattern,
      flags: '',
      color,
      enabled: true,
      matchScope: 'matched',
    };

    if (!this.currentKeywords) { this.currentKeywords = []; }
    this.currentKeywords.push(newKw);

    const tp = this.timeMatchModel.getConfig();
    this.configPanel.render(
      this.regexGroupModel.getGroups(),
      this.currentStartPattern, this.currentEndPattern,
      this.currentRangeDescription, this.currentNamedRanges, this.currentActiveRangeId,
      tp.format ? tp : undefined,
      this.currentKeywords
    );

    const editor = this.currentEditor;
    const editorId = editor.document.uri.toString();
    if (this.editorStateModel.isActive(editorId)) {
      const lines = this.readLines(editor);
      const groups = this.regexGroupModel.getGroups();
      const results = this.filterController.filter(lines, groups, this.currentStartPattern, this.currentEndPattern);

      const scanStart = this.currentStartPattern !== undefined
        ? this.filterController.findFirstMatchLine(lines, this.currentStartPattern) : 0;
      const scanEnd = this.currentEndPattern !== undefined
        ? this.filterController.findFirstMatchLine(lines, this.currentEndPattern, lines.length) : lines.length;

      this.markKeywordVisibleLines(results, lines, this.currentKeywords, scanStart, scanEnd);
      this.filterResultModel.setResults(editorId, results);
      this.decorations.apply(results, editor, this.currentKeywords, scanStart, scanEnd);
      this.applyFoldAnnotations(editor, editorId, lines, this.currentKeywords);

      const savedLine = editor.selection.active.line;
      await this.applyFolding(editor);

      // 更新时间线图表和匹配统计
      this.sendTimelineData(editorId, lines, this.currentKeywords, scanStart, scanEnd);
      this.sendMatchCounts(editorId, lines, this.currentKeywords, scanStart, scanEnd);

      editor.selection = this.findNearestVisibleLine(savedLine, editorId);
      editor.revealRange(
        new vscode.Range(editor.selection.active, editor.selection.active),
        vscode.TextEditorRevealType.InCenter
      );
    }
  }



  /** 在折叠后找到距 cursorLine 最近的可见行 */
  private findNearestVisibleLine(cursorLine: number, editorId: string): vscode.Selection {
    const matchedLines = this.filterResultModel.getMatchedLines(editorId);
    if (matchedLines.length === 0) {
      return new vscode.Selection(cursorLine, 0, cursorLine, 0);
    }
    matchedLines.sort((a, b) => a - b);
    let bestLine: number | undefined;
    for (let i = matchedLines.length - 1; i >= 0; i--) {
      if (matchedLines[i] <= cursorLine) { bestLine = matchedLines[i]; break; }
    }
    if (bestLine === undefined) { bestLine = matchedLines[0]; }
    const pos = new vscode.Position(bestLine, 0);
    return new vscode.Selection(pos, pos);
  }

  // ── Test-only commands for autotest automation ──

  /**
   * Test: trigger Go with config (mimics webview Go button).
   * Prefix _test marks this as internal/automation-only.
   */
  async testGo(config: {
    groups?: RegexGroup[];
    startPattern?: string;
    endPattern?: string;
    timePattern?: TimePatternConfig;
    keywords?: KeywordConfig[];
  }): Promise<void> {
    const g = config.groups || [];
    await this.handleGo(
      g,
      config.startPattern,
      config.endPattern,
      undefined,          // rangeDescription
      undefined,          // namedRanges
      undefined,          // activeRangeId
      config.timePattern,
      config.keywords
    );
  }

  /** Test: trigger Clear (mimics webview Clear button) */
  async testClear(): Promise<void> {
    await this.handleClear();
  }

  /** Test: trigger Reset (mimics webview Reset button) */
  async testReset(): Promise<void> {
    await this.handleReset();
  }

  /** Test: get fold annotation summaries for assertion verification */
  testGetFoldSummaries(): string[] {
    if (!this.currentEditor) { return []; }
    const editor = this.currentEditor;
    const editorId = editor.document.uri.toString();
    const lines = this.readLines(editor);

    const rawRanges = this.filterResultModel.getUnmatchedRanges(editorId);
    if (rawRanges.length === 0) { return []; }

    // Build FoldRange same way as applyFoldAnnotations
    let foldRanges: FoldRange[];
    if (this.timeMatchModel.isConfigured()) {
      foldRanges = this.timeMatchModel.computeFoldRanges(
        rawRanges, lines, editor.document.lineCount
      );
    } else {
      foldRanges = rawRanges.map(r => ({
        start: r.start,
        end: r.end,
        lineCount: r.end - r.start + 1,
      }));
    }

    // Enrich with keyword hits
    if (this.currentKeywords && this.currentKeywords.length > 0) {
      foldRanges = this.enrichWithKeywordHits(foldRanges, lines, this.currentKeywords);
    }

    // Format summaries
    return foldRanges.map(fr => this.decorations.formatFoldSummary(fr).trim());
  }

  /** Test: get time info for the matched range */
  testGetTimeInfo(): Record<string, any> {
    if (!this.currentEditor) { return {}; }
    const editorId = this.currentEditor.document.uri.toString();
    const lines = this.readLines(this.currentEditor);
    const matchedLines = this.filterResultModel.getMatchedLines(editorId);

    if (!this.timeMatchModel.isConfigured() || matchedLines.length === 0) {
      return { configured: false };
    }

    const info = this.timeMatchModel.computeRangeTimeInfo(matchedLines, lines);
    if (!info) {
      return { configured: true, noResult: true };
    }
    return {
      configured: true,
      startTime: info.startTime ? info.startTime.toISOString() : null,
      endTime: info.endTime ? info.endTime.toISOString() : null,
      durationMs: info.durationMs || 0,
      matchedLineCount: matchedLines.length,
    };
  }

  /**
   * Test: get raw fold range data with numeric time values for precise assertion.
   * Returns an array of { lineCount, durationMs, elapsedMs, keywordHits[] }
   * where elapsedMs = timeFrom - firstMatchTime.
   */
  testGetFoldRanges(): Record<string, any>[] {
    if (!this.currentEditor) { return []; }
    const editor = this.currentEditor;
    const editorId = editor.document.uri.toString();
    const lines = this.readLines(editor);

    const rawRanges = this.filterResultModel.getUnmatchedRanges(editorId);
    if (rawRanges.length === 0) { return []; }

    let foldRanges: FoldRange[];
    if (this.timeMatchModel.isConfigured()) {
      foldRanges = this.timeMatchModel.computeFoldRanges(
        rawRanges, lines, editor.document.lineCount
      );
    } else {
      foldRanges = rawRanges.map(r => ({
        start: r.start,
        end: r.end,
        lineCount: r.end - r.start + 1,
      }));
    }

    if (this.currentKeywords && this.currentKeywords.length > 0) {
      foldRanges = this.enrichWithKeywordHits(foldRanges, lines, this.currentKeywords);
    }

    return foldRanges.map(fr => {
      const entry: Record<string, any> = {
        lineCount: fr.lineCount,
        startLine: fr.start,
        endLine: fr.end,
        durationMs: fr.durationMs ?? null,
      };
      if (fr.firstMatchTime && fr.timeFrom) {
        entry.elapsedMs = fr.timeFrom.getTime() - fr.firstMatchTime.getTime();
      }
      if (fr.keywordHits && fr.keywordHits.length > 0) {
        entry.keywordHits = fr.keywordHits;
      }
      return entry;
    });
  }

  dispose(): void {
    this.decorations.dispose();
  }
}
