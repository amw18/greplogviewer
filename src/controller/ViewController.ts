// ViewController — 协调 View 和 Controller，管理编辑器生命周期
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { RegexGroup, TimePatternConfig, KeywordConfig, ConfigScope, FoldRange, FilterResult } from '../types';
import { ConfigController } from './ConfigController';
import { FilterController } from './FilterController';
import { EditorStateModel } from '../model/EditorStateModel';
import { FilterResultModel } from '../model/FilterResultModel';
import { RegexGroupModel } from '../model/RegexGroupModel';
import { TimeMatchModel } from '../model/TimeMatchModel';
import { ConfigStorageModel } from '../model/ConfigStorageModel';
import { RingBufferModel } from '../model/RingBufferModel';
import { StartLineFoldModel } from '../model/StartLineFoldModel';
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
  private currentKeywords?: KeywordConfig[];
  private isApplyingFilter = false;  // 防止 Go / keyword 更新期间的 attach 重入
  private lastFilterFingerprint = '';  // 跳过重复过滤
  private context: vscode.ExtensionContext;

  /** 缓存：预编译的关键词正则 */
  private compiledKwRegexes: Map<string, RegExp | null> = new Map();

  /** 获取预编译的 keyword 正则列表（带缓存） */
  private getCompiledKeywordRegexes(keywords?: KeywordConfig[]): { kw: KeywordConfig; regex: RegExp }[] {
    if (!keywords) { return []; }
    const result: { kw: KeywordConfig; regex: RegExp }[] = [];
    for (const kw of keywords) {
      if (kw.enabled === false || !kw.pattern) { continue; }
      let regex = this.compiledKwRegexes.get(kw.id);
      if (regex === undefined) {
        regex = ViewController.buildKwRegex(kw);
        this.compiledKwRegexes.set(kw.id, regex);
      }
      if (regex) { result.push({ kw, regex }); }
    }
    return result;
  }

  /** 计算会影响 filter 结果的配置指纹 */
  private computeFilterFingerprint(groups: RegexGroup[]): string {
    const parts: string[] = [];
    for (const g of groups) {
      if (g.enabled === false) { continue; }
      parts.push(g.id);
      for (const e of g.expressions) {
        if (e.enabled !== false) {
          parts.push(e.pattern, e.flags, e.operator);
        }
      }
    }
    return parts.join('|');
  }

  constructor(
    configController: ConfigController,
    private filterController: FilterController,
    private editorStateModel: EditorStateModel,
    private filterResultModel: FilterResultModel,
    private regexGroupModel: RegexGroupModel,
    private timeMatchModel: TimeMatchModel,
    private configStorageModel: ConfigStorageModel,
    private timeline: KeywordTimeline,
    context: vscode.ExtensionContext,
    private ringBufferModel: RingBufferModel,
    private startLineFoldModel: StartLineFoldModel,
    private reRegisterFoldProvider?: () => void
  ) {
    this.context = context;
    this.configPanel = new ConfigPanel();
    const flagIconUri = vscode.Uri.file(path.join(context.extensionPath, 'assets', 'flag-red.svg'));
    this.decorations = new EditorDecorations(
      (groupId) => this.regexGroupModel.getGroups().find(g => g.id === groupId)?.color,
      flagIconUri
    );

    this.configPanel.onGo((g, tp, kw) => this.handleGo(g, tp, kw));
    this.configPanel.onReset(() => this.handleReset());
    this.configPanel.onClear(() => this.handleClear());

    // Config management callbacks
    this.configPanel.onExport((g, tp, kw) => this.handleExport(g, tp, kw));
    this.configPanel.onImport(() => this.handleImport());
    this.configPanel.onSave((n, sc, g, tp, kw) => this.handleSave(n, sc, g, tp, kw));
    this.configPanel.onListSaved(() => this.handleListSaved());
    this.configPanel.onApply((n, sc) => this.handleApply(n, sc));
    this.configPanel.onDelete((n, sc) => this.handleDelete(n, sc));
    this.configPanel.onSyncConfig((g, tp, kw) => this.handleSyncConfig(g, tp, kw));
    this.configPanel.onTimelineClick((line) => this.handleTimelineClick(line));

    // 监听选择变更，用于检测红旗行点击
    vscode.window.onDidChangeTextEditorSelection(e => {
      if (e.textEditor === this.currentEditor) {
        this.onSelectionChange(e.textEditor);
      }
    });
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

    // 切换编辑器后过滤指纹失效，必须重置，否则新编辑器上 Go 可能复用旧编辑器缓存
    this.lastFilterFingerprint = '';

    const editorId = editor.document.uri.toString();
    const savedConfig = this.editorStateModel.loadConfig(editorId);

    if (savedConfig) {
      this.regexGroupModel.setGroups(savedConfig.groups);

      // 恢复时间匹配配置
      if (savedConfig.timePattern) {
        this.timeMatchModel.setConfig(savedConfig.timePattern);
      }

      // 恢复关键字配置
      this.currentKeywords = savedConfig.keywords;

      if (this.editorStateModel.isActive(editorId) && !this.isApplyingFilter) {
        // 已激活：先清除可能从上一会话恢复的折叠状态，再重新应用过滤
        // （FoldingRangeProvider 的折叠状态会被 VS Code 持久化，重启后可能残留）
        await this.clearFoldingState(editor);

        const lines = this.readLines(editor);

        // 强制 FoldingRangeProvider 先返回空区间并重新注册 provider，
        // 彻底移除旧的 provider 折叠和 gutter 折叠图标
        this.filterResultModel.setEmptyResults(editorId);
        this.reRegisterFoldProvider?.();
        await new Promise(r => setTimeout(r, 100));

        const results = this.filterController.filter(lines, savedConfig.groups);
        this.filterResultModel.setResults(editorId, results);

        const scanStart = 0;
        const scanEnd = lines.length;

        // 范围内被 keyword 匹配但未被 group 匹配的行 → 标记为可见
        this.markKeywordVisibleLines(results, lines, this.currentKeywords, scanStart, scanEnd);

        this.decorations.apply(results, editor, this.currentKeywords, scanStart, scanEnd);

        // 恢复时间标注
        this.applyFoldAnnotations(editor, editorId, lines, this.currentKeywords);

        // 检测并应用 ring buffer 起点行红旗
        this.applyRingBufferStart(editor, lines);

        // 恢复折叠（FoldingRangeProvider 已定义区域，但切换编辑器时需重新 foldAll）
        await new Promise(r => setTimeout(r, 80));
        await vscode.commands.executeCommand('editor.foldAll');

        // Go / keyword 更新期间 attach 被 showTextDocument 触发时不重发 timeline/matchCounts
        if (!this.isApplyingFilter) {
          this.sendTimelineData(editorId, lines, this.currentKeywords, scanStart, scanEnd);
          this.sendMatchCounts(editorId, lines, this.currentKeywords, scanStart, scanEnd);
        }
      } else {
        // 未激活但有旧配置：清除折叠
        this.filterResultModel.clearResults(editorId);
      }
    } else {
      this.regexGroupModel.setGroups([]);
      this.currentKeywords = undefined;
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
      tp.format ? tp : undefined,
      this.currentKeywords
    );
  }

  /** 实时同步配置（不触发过滤），供 grep 等无需 Go 的功能使用 */
  private handleSyncConfig(groups: RegexGroup[], timePattern?: TimePatternConfig, keywords?: KeywordConfig[]): void {
    if (!this.currentEditor) { return; }
    const editor = this.currentEditor;
    const editorId = editor.document.uri.toString();

    // 检测是否只有颜色等纯视觉属性变化（无需重新过滤）
    const oldGroupColors = new Map(this.regexGroupModel.getGroups().map(g => [g.id, g.color]));
    const oldKeywordColors = new Map((this.currentKeywords || []).map(k => [k.id, k.color]));

    this.regexGroupModel.setGroups(groups);
    this.currentKeywords = keywords;

    if (timePattern && timePattern.format) {
      this.timeMatchModel.setConfig(timePattern);
    }

    // 持久化到 workspaceState（grepKeyword/grepFunction 从此读取）
    this.editorStateModel.saveConfig(editorId, {
      groups,
      timePattern: this.timeMatchModel.isConfigured() ? this.timeMatchModel.getConfig() : undefined,
      keywords,
    });

    // 若当前有激活的过滤结果，且颜色发生变化，则刷新装饰（无需重新过滤）
    if (this.editorStateModel.isActive(editorId)) {
      const colorChanged =
        groups.some(g => oldGroupColors.get(g.id) !== g.color) ||
        (keywords || []).some(k => oldKeywordColors.get(k.id) !== k.color);

      if (colorChanged) {
        this.refreshDecorationsForCurrentResults(editor);
      }
    }
  }

  /** 使用当前 group/keyword 颜色重新应用装饰，不改变过滤结果 */
  private refreshDecorationsForCurrentResults(editor: vscode.TextEditor): void {
    const editorId = editor.document.uri.toString();
    const results = this.filterResultModel.getResults(editorId);
    if (!results || results.length === 0) { return; }

    const lines = this.readLines(editor);
    const scanStart = 0;
    const scanEnd = lines.length;

    this.decorations.apply(results, editor, this.currentKeywords, scanStart, scanEnd, undefined, lines);
    this.applyFoldAnnotations(editor, editorId, lines, this.currentKeywords);

    // 颜色变化时 timeline 也要重新上色
    this.sendTimelineData(editorId, lines, this.currentKeywords, scanStart, scanEnd);
  }

  /** Go: 应用过滤 + 颜色高亮 + 创建折叠 + 时间标注 */
  private async handleGo(groups: RegexGroup[], timePattern?: TimePatternConfig, keywords?: KeywordConfig[]): Promise<void> {
    if (!this.currentEditor) { return; }
    const editor = this.currentEditor;
    const editorId = editor.document.uri.toString();

    this.regexGroupModel.setGroups(groups);

    // 时间匹配配置
    if (timePattern && timePattern.format) {
      this.timeMatchModel.setConfig(timePattern);
    }

    // 关键字配置
    this.currentKeywords = keywords;

    // 每次 Go 重置 ring buffer 起点折叠状态
    this.startLineFoldModel.setState(editorId, 'none');

    this.editorStateModel.saveConfig(editorId, {
      groups,
      timePattern: this.timeMatchModel.isConfigured() ? this.timeMatchModel.getConfig() : undefined,
      keywords,
    });
    this.editorStateModel.setActive(editorId, true);

    const lines = this.readLines(editor);

    // 当前已存在的折叠区间（用于判断是否需要先清除旧折叠）
    const oldRanges = this.filterResultModel.getUnmatchedRanges(editorId);

    // 计算是否只需更新 keyword/时间层（filter config 未变）
    const filterFp = this.computeFilterFingerprint(groups);
    const filterChanged = filterFp !== this.lastFilterFingerprint;
    this.lastFilterFingerprint = filterFp;

    let results: FilterResult[];

    if (filterChanged) {
      results = this.filterController.filter(lines, groups);
    } else {
      // 重用已有过滤结果
      const existing = this.filterResultModel.getResults(editorId);
      results = existing ?? [];
    }

    const scanStart = 0;
    const scanEnd = lines.length;

    // 范围内被 keyword 匹配但未被 group 匹配的行 → 标记为可见，不参与折叠
    this.markKeywordVisibleLines(results, lines, keywords, scanStart, scanEnd);

    // 先清除旧折叠：避免 VS Code 保留上一次 filter 的折叠状态
    this.isApplyingFilter = true;
    try {
      if (oldRanges.length > 0) {
        await this.clearFoldingState(editor);
      }

      // 强制 FoldingRangeProvider 先返回空区间并重新注册 provider，
      // 彻底移除旧的 provider 折叠和 gutter 折叠图标
      this.filterResultModel.setEmptyResults(editorId);
      this.reRegisterFoldProvider?.();
      await new Promise(r => setTimeout(r, 100));

      this.filterResultModel.setResults(editorId, results);
      this.decorations.apply(results, editor, keywords, scanStart, scanEnd, undefined, lines);

      // 折叠标注（含时间 + keyword 命中统计）
      this.applyFoldAnnotations(editor, editorId, lines, keywords);

      // 检测并应用 ring buffer 起点行红旗
      this.applyRingBufferStart(editor, lines);

      await this.applyFolding(editor);
    } finally {
      this.isApplyingFilter = false;
    }

    // 发送时间线图表数据
    this.sendTimelineData(editorId, lines, keywords, scanStart, scanEnd);

    // 发送匹配行数统计
    this.sendMatchCounts(editorId, lines, keywords, scanStart, scanEnd);
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

    const compiledKws = this.getCompiledKeywordRegexes(keywords);
    for (const { kw, regex } of compiledKws) {

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
      const compiledKws = this.getCompiledKeywordRegexes(keywords);
      for (const { kw, regex } of compiledKws) {
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
      const compiledKws = this.getCompiledKeywordRegexes(keywords);
      for (const { kw, regex } of compiledKws) {
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
    // 使用缓存的预编译 keyword 正则，分离 full 和 matched scope
    const compiledKws = this.getCompiledKeywordRegexes(keywords);
    if (compiledKws.length === 0) { return; }
    const fullKwRegexes: RegExp[] = [];
    const matchedKwRegexes: RegExp[] = [];
    for (const c of compiledKws) {
      if (c.kw.matchScope === 'matched') {
        matchedKwRegexes.push(c.regex);
      } else {
        fullKwRegexes.push(c.regex);
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
   * 清除当前编辑器的折叠状态，避免旧折叠在规则变更后残留。
   * 保持 FoldingRangeProvider 方案，不回到逐个 createFoldingRangeFromSelection 的旧路径。
   */
  private async clearFoldingState(editor: vscode.TextEditor): Promise<void> {
    // 确保编辑器有焦点（侧边栏点击 Go 后编辑器可能失焦，fold 命令会静默失败）
    if (vscode.window.activeTextEditor !== editor) {
      await vscode.window.showTextDocument(editor.document, {
        viewColumn: editor.viewColumn,
        preserveFocus: false,
      });
    }
    await vscode.commands.executeCommand('editor.unfoldAll');
  }

  /** FoldingRangeProvider 定义折叠区域，foldAll 执行实际折叠 */
  private async applyFolding(editor: vscode.TextEditor): Promise<void> {
    const editorId = editor.document.uri.toString();
    const ranges = this.filterResultModel.getUnmatchedRanges(editorId);
    if (ranges.length === 0) { return; }

    // 确保编辑器有焦点（侧边栏点击 Go 后编辑器可能失焦）
    if (vscode.window.activeTextEditor !== editor) {
      await vscode.window.showTextDocument(editor.document, {
        viewColumn: editor.viewColumn,
        preserveFocus: false,
      });
    }

    // 等待 VS Code 处理 FoldingRangeProvider 的 onDidChangeFoldingRanges 事件
    await new Promise(r => setTimeout(r, 80));
    await vscode.commands.executeCommand('editor.foldAll');

    const savedSelection = editor.selection;
    editor.selection = this.adjustCursorOutOfFolds(savedSelection, ranges, editorId);
  }

  /** 检测 ring buffer 时间起点行并绘制红旗图标 */
  private applyRingBufferStart(editor: vscode.TextEditor, lines: string[]): void {
    const editorId = editor.document.uri.toString();
    this.ringBufferModel.clear(editorId);
    this.decorations.clearRingBufferFlag();

    if (!this.timeMatchModel.isConfigured()) { return; }

    const startLine = this.timeMatchModel.detectRingBufferStartLine(lines);
    if (startLine === undefined) { return; }

    this.ringBufferModel.setStartLine(editorId, startLine);
    this.decorations.showRingBufferFlag(startLine, editor);
  }

  /** 处理编辑器选择变更：若点击了红旗行则循环切换折叠状态 */
  private onSelectionChange(editor: vscode.TextEditor): void {
    const editorId = editor.document.uri.toString();
    const startLine = this.ringBufferModel.getStartLine(editorId);
    if (startLine === undefined) { return; }

    const activeLine = editor.selection.active.line;
    if (activeLine !== startLine) { return; }

    this.toggleStartLineFold(editor);
  }

  /** 切换起点行折叠状态并刷新折叠（public：供命令/测试调用） */
  async toggleStartLineFold(editor: vscode.TextEditor): Promise<void> {
    const editorId = editor.document.uri.toString();
    const startLine = this.ringBufferModel.getStartLine(editorId);
    if (startLine === undefined) { return; }

    this.startLineFoldModel.cycleState(editorId);

    // 触发 FoldingRangeProvider 刷新
    this.filterResultModel.notifyChange();
    await new Promise(r => setTimeout(r, 80));
    await vscode.commands.executeCommand('editor.foldAll');
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
    this.ringBufferModel.clear(editorId);
    this.startLineFoldModel.clear(editorId);
    this.lastFilterFingerprint = '';  // 清除后必须重置指纹，否则再次 Go 会误判为未变更
    this.decorations.clear();
    this.decorations.clearTimeAnnotations();

    // 展开所有折叠区域
    await vscode.commands.executeCommand('editor.unfoldAll');
  }

  /** Reset: 清除配置 + 显示效果 */
  private async handleReset(): Promise<void> {
    if (!this.currentEditor) { return; }
    const editor = this.currentEditor;
    const editorId = editor.document.uri.toString();

    this.regexGroupModel.setGroups([]);
    this.currentKeywords = undefined;
    this.timeMatchModel.setConfig({ format: '' });
    this.editorStateModel.clearEditor(editorId);
    this.filterResultModel.clearResults(editorId);
    this.ringBufferModel.clear(editorId);
    this.startLineFoldModel.clear(editorId);
    this.lastFilterFingerprint = '';  // 重置后必须清空指纹缓存
    this.decorations.clear();
    this.decorations.clearTimeAnnotations();

    // 展开所有折叠区域
    await vscode.commands.executeCommand('editor.unfoldAll');
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
    const results = this.filterController.filter(lines, groups);
    this.filterResultModel.setResults(editorId, results);
    this.decorations.apply(results, editor, this.currentKeywords);

    // 重新计算折叠标注
    this.applyFoldAnnotations(editor, editorId, lines, this.currentKeywords);

    // 文档编辑后重新检测 ring buffer 起点
    this.applyRingBufferStart(editor, lines);
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
  private async handleExport(groups: RegexGroup[], timePattern?: TimePatternConfig, keywords?: KeywordConfig[]): Promise<void> {
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file('greplogviewer-config.json'),
      filters: { 'JSON Files': ['json'] },
    });
    if (!uri) { return; }

    const content = JSON.stringify({ groups, timePattern, keywords }, null, 2);
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
  private async handleSave(name: string, scope: ConfigScope, groups: RegexGroup[], timePattern?: TimePatternConfig, keywords?: KeywordConfig[]): Promise<void> {
    if (this.configStorageModel.exists(name, scope)) {
      const answer = await vscode.window.showWarningMessage(
        `Config "${name}" already exists in ${scope}. Overwrite?`,
        { modal: true },
        'Overwrite'
      );
      if (answer !== 'Overwrite') { return; }
    }

    await this.configStorageModel.save(name, { groups, timePattern, keywords }, scope);

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
    const compiledKws = this.getCompiledKeywordRegexes(keywords);
    for (const { regex } of compiledKws) {
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
      tp.format ? tp : undefined,
      this.currentKeywords
    );

    const editor = this.currentEditor;
    const editorId = editor.document.uri.toString();
    if (this.editorStateModel.isActive(editorId)) {
      const lines = this.readLines(editor);
      const groups = this.regexGroupModel.getGroups();
      const results = this.filterController.filter(lines, groups);

      const scanStart = 0;
      const scanEnd = lines.length;

      this.markKeywordVisibleLines(results, lines, this.currentKeywords, scanStart, scanEnd);

      // keyword 变更可能改变折叠区间，先清除旧折叠避免残留
      const savedLine = editor.selection.active.line;
      this.isApplyingFilter = true;
      try {
        const oldRanges = this.filterResultModel.getUnmatchedRanges(editorId);
        if (oldRanges.length > 0) {
          await this.clearFoldingState(editor);
        }

        // 强制 FoldingRangeProvider 先返回空区间并重新注册 provider，
        // 彻底移除旧的 provider 折叠和 gutter 折叠图标
        this.filterResultModel.setEmptyResults(editorId);
        this.reRegisterFoldProvider?.();
        await new Promise(r => setTimeout(r, 100));

        this.filterResultModel.setResults(editorId, results);
        this.decorations.apply(results, editor, this.currentKeywords, scanStart, scanEnd);
        this.applyFoldAnnotations(editor, editorId, lines, this.currentKeywords);

        await this.applyFolding(editor);
      } finally {
        this.isApplyingFilter = false;
      }

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
    timePattern?: TimePatternConfig;
    keywords?: KeywordConfig[];
  }): Promise<void> {
    const g = config.groups || [];
    await this.handleGo(
      g,
      config.timePattern,
      config.keywords
    );
  }

  /** Test: trigger syncConfig with color-only changes (mimics webview color picker). */
  testSyncConfig(config: { groups?: RegexGroup[]; keywords?: KeywordConfig[] }): void {
    this.handleSyncConfig(
      config.groups || this.regexGroupModel.getGroups(),
      this.timeMatchModel.isConfigured() ? this.timeMatchModel.getConfig() : undefined,
      config.keywords || this.currentKeywords
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

  /** Test: get last timeline data sent to the timeline webview */
  testGetTimelineData(): import('../types').TimelineDataMessage | undefined {
    return this.timeline.getLastTimelineData();
  }

  /** Test: get ring buffer detection/fold state for assertion */
  testGetRingBufferState(): Record<string, any> {
    if (!this.currentEditor) { return {}; }
    const editorId = this.currentEditor.document.uri.toString();
    return {
      startLine: this.ringBufferModel.getStartLine(editorId),
      foldState: this.startLineFoldModel.getState(editorId),
    };
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

    // 追加 ring buffer 起点折叠区间（如有）
    const rbStart = this.ringBufferModel.getStartLine(editorId);
    const foldState = this.startLineFoldModel.getState(editorId);
    const lineCount = editor.document.lineCount;
    if (rbStart !== undefined && foldState && foldState !== 'none') {
      if (foldState === 'foldBelow' && rbStart < lineCount - 1) {
        foldRanges.push({ start: rbStart, end: lineCount - 1, lineCount: lineCount - rbStart });
      } else if (foldState === 'foldAbove' && rbStart > 0) {
        foldRanges.push({ start: 0, end: rbStart - 1, lineCount: rbStart });
      }
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
