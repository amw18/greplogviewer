// ViewController — 协调 View 和 Controller，管理编辑器生命周期
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { RegexGroup, TimePatternConfig, KeywordConfig, ConfigScope, FoldRange, FilterResult } from '../types';
import { ConfigController } from './ConfigController';
import { FilterController } from './FilterController';
import { EditorStateModel } from '../model/EditorStateModel';
import { FilterResultModel } from '../model/FilterResultModel';
import { RegexGroupModel } from '../model/RegexGroupModel';
import { TimeMatchModel } from '../model/TimeMatchModel';
import { ConfigStorageModel } from '../model/ConfigStorageModel';
import { RingBufferModel } from '../model/RingBufferModel';
import { uuid } from '../model/uuid';
import { ConfigPanel } from '../view/ConfigPanel';
import { EditorDecorations } from '../view/EditorDecorations';
import { KeywordTimeline } from '../view/KeywordTimeline';

export class ViewController {
  /** 用于标记范围内被 keyword 匹配但未被 group 匹配的行。这些行不参与折叠也不 dim。 */
  private static readonly KW_VISIBLE_ID = '__kw_visible__';

  /** 超过此行数视为大文件，跳过部分重型功能（dim、keyword 折叠标注、时间线） */
  private static readonly LARGE_FILE_THRESHOLD = 100000;

  /** 超过此行数启用异步分块过滤，避免同步正则阻塞 UI */
  private static readonly ASYNC_FILTER_THRESHOLD = 1000000;

  /** 超过此行数 VS Code 通常会禁用折叠，插件只做高亮和导航 */
  private static readonly FOLDING_DISABLED_THRESHOLD = 300000;

  /** 超过此文件大小（字节）也视为超大文件，避免行长短导致 VS Code 折叠失效 */
  private static readonly FOLDING_DISABLED_SIZE_THRESHOLD = 20 * 1024 * 1024; // 20 MB

  /** 超过此行数禁用时间线，避免扫描百万行阻塞 UI */
  private static readonly TIMELINE_DISABLE_THRESHOLD = 200000;

  /** 判断当前文件是否超出 VS Code 折叠能力（按行数或文件大小） */
  private static isFoldingDisabled(editor: vscode.TextEditor, lineCount: number): boolean {
    if (lineCount > ViewController.FOLDING_DISABLED_THRESHOLD) { return true; }
    try {
      const size = fs.statSync(editor.document.uri.fsPath).size;
      return size > ViewController.FOLDING_DISABLED_SIZE_THRESHOLD;
    } catch {
      return false;
    }
  }

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
  private lastMatchCounts: import('../types').MatchCountsMessage | undefined;
  /** 本次会话已完整恢复过过滤+折叠的编辑器，切回时不再重新 foldAll，保留用户手动展开状态 */
  private attachedEditors: Set<string> = new Set();
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
    this.configPanel.onSave((n, g, tp, kw) => this.handleSave(n, g, tp, kw));
    this.configPanel.onRequestSave((g, tp, kw) => this.handleRequestSave(g, tp, kw));
    this.configPanel.onListSaved(() => this.handleListSaved());
    this.configPanel.onApply((n, sc) => this.handleApply(n, sc));
    this.configPanel.onDelete((n, sc) => this.handleDelete(n, sc));
    this.configPanel.onSyncConfig((g, tp, kw) => this.handleSyncConfig(g, tp, kw));
    this.configPanel.onTimelineClick((line) => this.handleTimelineClick(line));
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
        const alreadyAttached = this.attachedEditors.has(editorId);
        const lines = this.readLines(editor);

        if (alreadyAttached) {
          // 会话内切回：只恢复颜色装饰，保留用户手动展开的折叠状态
          const results = this.filterResultModel.getResults(editorId);
          if (results) {
            const scanStart = 0;
            const scanEnd = lines.length;
            this.markKeywordVisibleLines(results, lines, this.currentKeywords, scanStart, scanEnd);
            this.decorations.apply(results, editor, this.currentKeywords, scanStart, scanEnd, undefined, lines);
            this.applyFoldAnnotations(editor, editorId, lines, this.currentKeywords);
            this.applyRingBufferStart(editor, lines);
          }
        } else {
          // 首次恢复（如重启后）：清除残留折叠 + 重新应用过滤 + foldAll
          await this.clearFoldingState(editor);

          this.filterResultModel.setEmptyResults(editorId);
          this.reRegisterFoldProvider?.();
          await new Promise(r => setTimeout(r, 100));

          const results = await this.runFilterWithProgress(lines, savedConfig.groups);
          this.filterResultModel.setResults(editorId, results);

          const scanStart = 0;
          const scanEnd = lines.length;

          this.markKeywordVisibleLines(results, lines, this.currentKeywords, scanStart, scanEnd);
          this.decorations.apply(results, editor, this.currentKeywords, scanStart, scanEnd, undefined, lines);
          this.applyFoldAnnotations(editor, editorId, lines, this.currentKeywords);
          this.applyRingBufferStart(editor, lines);

          await new Promise(r => setTimeout(r, 80));
          if (!ViewController.isFoldingDisabled(editor, editor.document.lineCount)) {
            await vscode.commands.executeCommand('editor.foldAll');
          }

          this.attachedEditors.add(editorId);
        }

        if (!this.isApplyingFilter) {
          const scanStart = 0;
          const scanEnd = lines.length;
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

    this.timeMatchModel.setConfig(timePattern || { format: '' });
    if (!this.timeMatchModel.isConfigured()) {
      const lines = this.readLines(editor);
      const autoTp = this.timeMatchModel.autoDetect(lines);
      if (autoTp) { this.timeMatchModel.setConfig(autoTp); }
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
  private async handleGo(groups: RegexGroup[], timePattern?: TimePatternConfig, keywords?: KeywordConfig[], skipLargeFilePrompt = false): Promise<void> {
    if (!this.currentEditor) { return; }
    const editor = this.currentEditor;
    const editorId = editor.document.uri.toString();

    this.regexGroupModel.setGroups(groups);

    // 时间匹配配置：用户留空时自动检测常见格式
    this.timeMatchModel.setConfig(timePattern || { format: '' });
    const lines = this.readLines(editor);
    if (!this.timeMatchModel.isConfigured()) {
      const autoTp = this.timeMatchModel.autoDetect(lines);
      if (autoTp) { this.timeMatchModel.setConfig(autoTp); }
    }

    // 关键字配置
    this.currentKeywords = keywords;

    this.editorStateModel.saveConfig(editorId, {
      groups,
      timePattern: this.timeMatchModel.isConfigured() ? this.timeMatchModel.getConfig() : undefined,
      keywords,
    });
    this.editorStateModel.setActive(editorId, true);


    // 当前已存在的折叠区间（用于判断是否需要先清除旧折叠）
    const oldRanges = this.filterResultModel.getUnmatchedRanges(editorId);

    // 计算是否只需更新 keyword/时间层（filter config 未变）
    const filterFp = this.computeFilterFingerprint(groups);
    const filterChanged = filterFp !== this.lastFilterFingerprint;
    this.lastFilterFingerprint = filterFp;

    let results: FilterResult[];

    if (filterChanged) {
      results = await this.runFilterWithProgress(lines, groups);
    } else {
      // 重用已有过滤结果，但重置 keyword 可见标记（旧标记可能已过期）。
      const existing = this.filterResultModel.getResults(editorId);
      if (existing && existing.length > 0) {
        // 仅保留 group 匹配，清除 __kw_visible__ 标记，后续会用新 keywords 重新标记
        results = existing.map(r => ({
          lineNumber: r.lineNumber,
          groupId: r.groupId && r.groupId !== '__kw_visible__' ? r.groupId : null,
          color: r.groupId && r.groupId !== '__kw_visible__' ? r.color : undefined,
        }));
      } else {
        results = [];
      }
    }

    const scanStart = 0;
    const scanEnd = lines.length;

    // 范围内被 keyword 匹配但未被 group 匹配的行 → 标记为可见，不参与折叠
    this.markKeywordVisibleLines(results, lines, keywords, scanStart, scanEnd);

    this.isApplyingFilter = true;
    try {
      if (filterChanged) {
        // 过滤规则变化时才需要清除旧折叠并重新应用
        if (oldRanges.length > 0) {
          await this.clearFoldingState(editor);
        }
        if (lines.length <= ViewController.LARGE_FILE_THRESHOLD) {
          this.filterResultModel.setEmptyResults(editorId);
          this.reRegisterFoldProvider?.();
          await new Promise(r => setTimeout(r, 100));
        }
        this.filterResultModel.setResults(editorId, results);
        this.applyFoldAnnotations(editor, editorId, lines, keywords);
        this.applyRingBufferStart(editor, lines);
        await this.applyFolding(editor);
      } else {
        // 过滤规则未变：只更新 decorations（keywords/colors 可能变了），跳过昂贵的 fold/unfold
        this.filterResultModel.setResults(editorId, results);
      }

      this.decorations.apply(results, editor, keywords, scanStart, scanEnd, undefined, lines);
    } finally {
      this.isApplyingFilter = false;
    }

    // 标记本次会话已完整过滤，切回时不再重新 foldAll
    this.attachedEditors.add(editorId);

    // 发送时间线图表数据
    this.sendTimelineData(editorId, lines, keywords, scanStart, scanEnd);

    // 发送匹配行数统计
    this.sendMatchCounts(editorId, lines, keywords, scanStart, scanEnd);

    // 超大文件提示：仅当过滤规则变化且文件超出 VS Code 折叠能力时才提示。
    // 相同规则重复 Go 不弹，避免每次操作都打断用户。
    if (filterChanged && !skipLargeFilePrompt && ViewController.isFoldingDisabled(editor, lines.length)) {
      const action = await vscode.window.showInformationMessage(
        `GrepLogViewer: ${lines.length.toLocaleString()} lines is too large for VS Code folding; highlighting is still applied.`,
        'Open filtered results in new tab'
      );
      if (action === 'Open filtered results in new tab') {
        await this.openFilteredResultsInTempFile(editor, lines, results, groups, keywords);
      }
    }
  }

  /** 将过滤后的匹配行写入临时文件并打开，以便在较小的文件上使用完整功能（折叠等） */
  private async openFilteredResultsInTempFile(
    editor: vscode.TextEditor,
    lines: string[],
    results: FilterResult[],
    groups: RegexGroup[],
    keywords?: KeywordConfig[]
  ): Promise<void> {
    const matchedLineNumbers = new Set<number>();
    for (const r of results) {
      if (r.groupId !== null) {
        matchedLineNumbers.add(r.lineNumber);
      }
    }
    if (matchedLineNumbers.size === 0) {
      vscode.window.showWarningMessage('GrepLogViewer: No matched lines to export.');
      return;
    }

    const sortedLines = Array.from(matchedLineNumbers).sort((a, b) => a - b);
    const filteredContent = sortedLines.map(i => lines[i]).join('\n');

    const tmpDir = path.join(os.tmpdir(), 'greplogviewer-filtered');
    if (!fs.existsSync(tmpDir)) { fs.mkdirSync(tmpDir, { recursive: true }); }
    const baseName = path.basename(editor.document.fileName || 'filtered.log');
    const tmpFile = path.join(tmpDir, `${baseName}.filtered-${Date.now()}.log`);
    fs.writeFileSync(tmpFile, filteredContent, 'utf-8');

    const doc = await vscode.workspace.openTextDocument(tmpFile);
    const newEditor = await vscode.window.showTextDocument(doc);

    // 在新文件上自动应用相同配置，使用户能继续用折叠等功能
    await this.handleGo(groups, this.timeMatchModel.getConfig(), keywords, true);

    // 把焦点切回新打开的临时文件（handleGo 会改变 currentEditor）
    await vscode.window.showTextDocument(newEditor.document, { viewColumn: newEditor.viewColumn });
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
    const MAX_TIMELINE_POINTS = 5000;

    // 超大文件跳过时间线，避免扫描百万行阻塞 UI
    if ((scanEnd ?? lines.length) - (scanStart ?? 0) > ViewController.TIMELINE_DISABLE_THRESHOLD) {
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

      // 大文件时间线采样，避免渲染和消息传输阻塞
      const displayPoints = (end - start > ViewController.LARGE_FILE_THRESHOLD && points.length > MAX_TIMELINE_POINTS)
        ? this.sampleTimelinePoints(points, MAX_TIMELINE_POINTS)
        : points;

      if (displayPoints.length > 0) {
        kwData.push({
          name: kw.hint || kw.pattern,
          color: kw.color,
          points: displayPoints,
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

  /** 对时间线点做均匀采样，控制最大点数 */
  private sampleTimelinePoints(points: import('../types').TimelinePoint[], maxPoints: number): import('../types').TimelinePoint[] {
    if (points.length <= maxPoints) { return points; }
    const sampled: import('../types').TimelinePoint[] = [];
    const step = points.length / maxPoints;
    for (let i = 0; i < maxPoints; i++) {
      const idx = Math.floor(i * step);
      sampled.push(points[idx]);
    }
    return sampled;
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

    const msg: import('../types').MatchCountsMessage = {
      type: 'matchCounts',
      totalLines,
      totalMatched: matchedSet.size,
      groupCounts,
      keywordCounts,
    };
    this.sendMatchCountsMessage(msg);
  }

  /** 发送匹配计数消息并缓存（Clear/Reset 复用） */
  private sendMatchCountsMessage(msg: import('../types').MatchCountsMessage): void {
    this.lastMatchCounts = msg;
    this.configPanel.sendMatchCounts(msg);
  }

  /** 测试用：获取最近一次发送的匹配计数 */
  testGetMatchCounts(): import('../types').MatchCountsMessage | undefined {
    return this.lastMatchCounts;
  }

  /** 测试用：直接触发大文件过滤结果导出到临时文件 */
  async testOpenFilteredTempFile(): Promise<void> {
    if (!this.currentEditor) { return; }
    const editor = this.currentEditor;
    const editorId = editor.document.uri.toString();
    const lines = this.readLines(editor);
    const results = this.filterResultModel.getResults(editorId) || [];
    const groups = this.regexGroupModel.getGroups();
    await this.openFilteredResultsInTempFile(editor, lines, results, groups, this.currentKeywords);
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

    // 丰富 keyword 命中统计（大文件跳过，避免扫描全量折叠区间）
    if (keywords && keywords.length > 0 && lines.length <= ViewController.LARGE_FILE_THRESHOLD) {
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
    // 超大文件 unfoldAll 会超时，直接跳过
    if (ViewController.isFoldingDisabled(editor, editor.document.lineCount)) {
      return;
    }
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

    // 超过阈值后 VS Code 通常会禁用折叠，不再尝试 foldAll，避免长时间无响应
    if (ViewController.isFoldingDisabled(editor, editor.document.lineCount)) {
      return;
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
    this.filterResultModel.clearProtectedLines(editorId);
    this.decorations.clearRingBufferFlag();

    if (!this.timeMatchModel.isConfigured()) { return; }

    const startLine = this.timeMatchModel.detectRingBufferStartLine(lines);
    if (startLine === undefined) { return; }

    this.ringBufferModel.setStartLine(editorId, startLine);
    this.filterResultModel.setProtectedLines(editorId, new Set([startLine]));
    this.decorations.showRingBufferFlag(startLine, editor);
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
    this.filterResultModel.clearProtectedLines(editorId);
    this.lastFilterFingerprint = '';  // 清除后必须重置指纹，否则再次 Go 会误判为未变更
    this.decorations.clear();
    this.decorations.clearTimeAnnotations();

    // 清空匹配计数
    this.sendMatchCountsMessage({
      type: 'matchCounts',
      totalLines: editor.document.lineCount,
      totalMatched: 0,
      groupCounts: {},
      keywordCounts: {},
    });

    // 小文件才展开折叠；超大文件 VS Code 的 unfoldAll 会超时
    if (!ViewController.isFoldingDisabled(editor, editor.document.lineCount)) {
      await vscode.commands.executeCommand('editor.unfoldAll');
    }
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
    this.filterResultModel.clearProtectedLines(editorId);
    this.ringBufferModel.clear(editorId);
    this.lastFilterFingerprint = '';  // 重置后必须清空指纹缓存
    this.decorations.clear();
    this.decorations.clearTimeAnnotations();

    // 清空匹配计数
    this.sendMatchCountsMessage({
      type: 'matchCounts',
      totalLines: editor.document.lineCount,
      totalMatched: 0,
      groupCounts: {},
      keywordCounts: {},
    });

    // 小文件才展开折叠；超大文件 VS Code 的 unfoldAll 会超时
    if (!ViewController.isFoldingDisabled(editor, editor.document.lineCount)) {
      await vscode.commands.executeCommand('editor.unfoldAll');
    }
  }

  /** 文档变更时重新过滤（仅已激活编辑器） */
  async onDocumentChange(document: vscode.TextDocument): Promise<void> {
    if (!this.currentEditor) { return; }
    if (document !== this.currentEditor.document) { return; }

    const editor = this.currentEditor;
    const editorId = editor.document.uri.toString();
    if (!this.editorStateModel.isActive(editorId)) { return; }

    const groups = this.regexGroupModel.getGroups();
    if (groups.length === 0) { return; }

    const lines = this.readLines(editor);
    const results = await this.runFilterWithProgress(lines, groups);
    this.filterResultModel.setResults(editorId, results);
    this.decorations.apply(results, editor, this.currentKeywords);

    // 重新计算折叠标注
    this.applyFoldAnnotations(editor, editorId, lines, this.currentKeywords);

    // 文档编辑后重新检测 ring buffer 起点
    this.applyRingBufferStart(editor, lines);
  }

  private linesCache: { editorId: string; version: number; lines: string[] } | undefined;

  private readLines(editor: vscode.TextEditor): string[] {
    const editorId = editor.document.uri.toString();
    const version = editor.document.version;
    if (this.linesCache && this.linesCache.editorId === editorId && this.linesCache.version === version) {
      return this.linesCache.lines;
    }
    const lines = editor.document.getText().split('\n');
    this.linesCache = { editorId, version, lines };
    return lines;
  }

  /** 根据文件大小选择同步或异步过滤，超大文件在状态栏显示进度（不抢焦点） */
  private async runFilterWithProgress(lines: string[], groups: RegexGroup[]): Promise<FilterResult[]> {
    if (lines.length > ViewController.ASYNC_FILTER_THRESHOLD) {
      const chunkSize = 250000;
      let lastReported = -1;
      return vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'Filtering large log...', cancellable: false },
        async progress => this.filterController.filterAsync(lines, groups, (processed, total) => {
          // 每 10% 报告一次，降低进度刷新频率
          const reportInterval = Math.max(100000, Math.floor(total / 10));
          if (processed - lastReported >= reportInterval || processed === total) {
            lastReported = processed;
            progress.report({ message: `${processed.toLocaleString()} / ${total.toLocaleString()} lines` });
          }
        }, chunkSize)
      );
    }
    return this.filterController.filter(lines, groups);
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

  /** Save: 将当前配置保存到 globalState（固定 user scope） */
  private async handleSave(name: string, groups: RegexGroup[], timePattern?: TimePatternConfig, keywords?: KeywordConfig[]): Promise<void> {
    const scope: ConfigScope = 'user';
    if (this.configStorageModel.exists(name, scope)) {
      const answer = await vscode.window.showWarningMessage(
        `Config "${name}" already exists. Overwrite?`,
        { modal: true },
        'Overwrite'
      );
      if (answer !== 'Overwrite') { return; }
    }

    await this.configStorageModel.save(name, { groups, timePattern, keywords }, scope);

    vscode.window.showInformationMessage(`Config "${name}" saved.`);
    // Refresh the webview dropdown
    this.handleListSaved();
  }

  /** Save 按钮：弹出输入框让用户输入配置名，然后保存到 user scope */
  private async handleRequestSave(groups: RegexGroup[], timePattern?: TimePatternConfig, keywords?: KeywordConfig[]): Promise<void> {
    const name = await vscode.window.showInputBox({
      prompt: 'Save configuration as',
      validateInput: (value) => {
        if (!value || !value.trim()) { return 'Please enter a config name.'; }
        return undefined;
      },
    });
    if (!name) { return; }
    await this.handleSave(name.trim(), groups, timePattern, keywords);
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

  /**
   * Ctrl+Up/Down 跳转：在当前命中的 group/keyword 行之间循环跳转。
   * 若当前行同时命中 group 和 keyword，keyword 优先。
   * 若当前行未命中任何 group/keyword，则在上/下一个任意命中行之间跳转。
   * @returns 跳转后的位置信息，未跳转返回 undefined
   */
  gotoPrevNextHit(direction: 'prev' | 'next'): { cursorLine: number } | undefined {
    const editor = this.currentEditor;
    if (!editor) { return; }

    const groups = this.regexGroupModel.getGroups();
    const keywords = this.currentKeywords;
    if (groups.length === 0 && (!keywords || keywords.length === 0)) { return; }

    const editorId = editor.document.uri.toString();
    const currentLine = editor.selection.active.line;
    const lines = this.readLines(editor);

    // 按 groupId 收集命中行
    const groupHits = new Map<string, number[]>();
    const results = this.filterResultModel.getResults(editorId);
    if (results) {
      for (const r of results) {
        if (r.groupId && r.groupId !== ViewController.KW_VISIBLE_ID) {
          const list = groupHits.get(r.groupId) || [];
          list.push(r.lineNumber);
          groupHits.set(r.groupId, list);
        }
      }
    }
    for (const list of groupHits.values()) { list.sort((a, b) => a - b); }

    // 按 keywordId 收集命中行（尊重 matchScope）
    const kwHits = new Map<string, number[]>();
    if (keywords && keywords.length > 0) {
      const groupMatchedLines = new Set<number>();
      if (results) {
        for (const r of results) {
          if (r.groupId && r.groupId !== ViewController.KW_VISIBLE_ID) {
            groupMatchedLines.add(r.lineNumber);
          }
        }
      }
      const compiledKws = this.getCompiledKeywordRegexes(keywords);
      for (const { kw, regex } of compiledKws) {
        const hits: number[] = [];
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            if (kw.matchScope === 'matched' && !groupMatchedLines.has(i)) { continue; }
            hits.push(i);
          }
        }
        kwHits.set(kw.id, hits);
      }
    }

    // 确定当前行优先属于哪个 keyword / group
    let activeHits: number[] | undefined;
    if (keywords) {
      for (const kw of keywords) {
        if (kw.enabled === false) { continue; }
        const hits = kwHits.get(kw.id);
        if (hits && hits.includes(currentLine)) {
          activeHits = hits;
          break;
        }
      }
    }
    if (!activeHits) {
      for (const hits of groupHits.values()) {
        if (hits.includes(currentLine)) {
          activeHits = hits;
          break;
        }
      }
    }

    // 当前行未命中任何 group/keyword：在所有命中行并集中跳转
    if (!activeHits) {
      const union = new Set<number>();
      for (const hits of kwHits.values()) { hits.forEach(l => union.add(l)); }
      for (const hits of groupHits.values()) { hits.forEach(l => union.add(l)); }
      activeHits = Array.from(union).sort((a, b) => a - b);
    }

    if (activeHits.length === 0) { return undefined; }

    let targetLine: number | undefined;
    if (direction === 'next') {
      for (const l of activeHits) {
        if (l > currentLine) { targetLine = l; break; }
      }
      if (targetLine === undefined) { targetLine = activeHits[0]; }
    } else {
      for (let i = activeHits.length - 1; i >= 0; i--) {
        if (activeHits[i] < currentLine) { targetLine = activeHits[i]; break; }
      }
      if (targetLine === undefined) { targetLine = activeHits[activeHits.length - 1]; }
    }

    if (targetLine !== undefined) {
      const pos = new vscode.Position(targetLine, 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      return { cursorLine: targetLine };
    }
    return undefined;
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
      const results = await this.runFilterWithProgress(lines, groups);

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

      // 标记本次会话已完整过滤，切回时不再重新 foldAll
      this.attachedEditors.add(editorId);

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
      config.keywords,
      true
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

  /** Test: get detected ring buffer start line for assertion */
  testGetRingBufferState(): Record<string, any> {
    if (!this.currentEditor) { return {}; }
    const editorId = this.currentEditor.document.uri.toString();
    return {
      startLine: this.ringBufferModel.getStartLine(editorId),
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
