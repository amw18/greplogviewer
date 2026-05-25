// ViewController — 协调 View 和 Controller，管理编辑器生命周期
import * as vscode from 'vscode';
import * as fs from 'fs';
import { RegexGroup, TimePatternConfig, KeywordConfig, ConfigScope } from '../types';
import { ConfigController } from './ConfigController';
import { FilterController } from './FilterController';
import { EditorStateModel } from '../model/EditorStateModel';
import { FilterResultModel } from '../model/FilterResultModel';
import { RegexGroupModel } from '../model/RegexGroupModel';
import { TimeMatchModel } from '../model/TimeMatchModel';
import { ConfigStorageModel } from '../model/ConfigStorageModel';
import { ConfigPanel } from '../view/ConfigPanel';
import { EditorDecorations } from '../view/EditorDecorations';

export class ViewController {
  private configPanel: ConfigPanel;
  private decorations: EditorDecorations;
  private currentEditor: vscode.TextEditor | undefined;
  private currentStartLine?: number;
  private currentEndLine?: number;
  private currentRangeDescription?: string;
  private currentKeywords?: KeywordConfig[];

  constructor(
    configController: ConfigController,
    private filterController: FilterController,
    private editorStateModel: EditorStateModel,
    private filterResultModel: FilterResultModel,
    private regexGroupModel: RegexGroupModel,
    private timeMatchModel: TimeMatchModel,
    private configStorageModel: ConfigStorageModel
  ) {
    this.configPanel = new ConfigPanel();
    this.decorations = new EditorDecorations();

    this.configPanel.onGo((g, s, e, rd, tp, kw) => this.handleGo(g, s, e, rd, tp, kw));
    this.configPanel.onReset(() => this.handleReset());
    this.configPanel.onClear(() => this.handleClear());

    // Config management callbacks
    this.configPanel.onExport((g, s, e, rd, tp, kw) => this.handleExport(g, s, e, rd, tp, kw));
    this.configPanel.onImport(() => this.handleImport());
    this.configPanel.onSave((n, sc, g, s, e, rd, tp, kw) => this.handleSave(n, sc, g, s, e, rd, tp, kw));
    this.configPanel.onListSaved(() => this.handleListSaved());
    this.configPanel.onApply((n, sc) => this.handleApply(n, sc));
    this.configPanel.onDelete((n, sc) => this.handleDelete(n, sc));
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
      this.currentStartLine = savedConfig.startLine;
      this.currentEndLine = savedConfig.endLine;
      this.currentRangeDescription = savedConfig.rangeDescription;

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
          savedConfig.startLine, savedConfig.endLine
        );
        this.filterResultModel.setResults(editorId, results);
        this.decorations.apply(results, editor, this.currentKeywords);

        // 恢复时间标注
        if (this.timeMatchModel.isConfigured()) {
          const rawRanges = this.filterResultModel.getUnmatchedRanges(editorId);
          const foldRanges = this.timeMatchModel.computeFoldRanges(
            rawRanges, lines, editor.document.lineCount
          );
          this.decorations.applyTimeAnnotations(foldRanges, editor);
        }
      } else {
        // 未激活但有旧配置：清除持久化的手动折叠残留
        await this.removeAllManualFolds(editor);
      }
    } else {
      this.regexGroupModel.setGroups([]);
      this.currentStartLine = undefined;
      this.currentEndLine = undefined;
      this.currentRangeDescription = undefined;
    }

    const tp = this.timeMatchModel.getConfig();
    this.configPanel.render(
      this.regexGroupModel.getGroups(),
      this.currentStartLine, this.currentEndLine,
      this.currentRangeDescription,
      tp.format ? tp : undefined,
      this.currentKeywords
    );
  }

  /** Go: 应用过滤 + 颜色高亮 + 创建折叠 + 时间标注 */
  private async handleGo(groups: RegexGroup[], startLine?: number, endLine?: number, rangeDescription?: string, timePattern?: TimePatternConfig, keywords?: KeywordConfig[]): Promise<void> {
    if (!this.currentEditor) { return; }
    const editor = this.currentEditor;
    const editorId = editor.document.uri.toString();

    this.regexGroupModel.setGroups(groups);
    this.currentStartLine = startLine;
    this.currentEndLine = endLine;
    this.currentRangeDescription = rangeDescription;

    // 时间匹配配置
    if (timePattern && timePattern.format) {
      this.timeMatchModel.setConfig(timePattern);
    }

    // 关键字配置
    this.currentKeywords = keywords;

    this.editorStateModel.saveConfig(editorId, {
      groups, startLine, endLine, rangeDescription,
      timePattern: this.timeMatchModel.isConfigured() ? this.timeMatchModel.getConfig() : undefined,
      keywords,
    });
    this.editorStateModel.setActive(editorId, true);

    const lines = this.readLines(editor);
    const results = this.filterController.filter(lines, groups, startLine, endLine);
    this.filterResultModel.setResults(editorId, results);
    this.decorations.apply(results, editor, keywords);

    // 时间匹配：按需解析折叠边界行
    if (this.timeMatchModel.isConfigured()) {
      const rawRanges = this.filterResultModel.getUnmatchedRanges(editorId);
      const foldRanges = this.timeMatchModel.computeFoldRanges(
        rawRanges, lines, editor.document.lineCount
      );
      this.decorations.applyTimeAnnotations(foldRanges, editor);
    }

    await this.applyFolding(editor);

    // 发送范围时间信息到 webview
    this.sendRangeTimeInfo(editorId, lines);
  }

  /** 计算范围时间信息并发送到 webview */
  private sendRangeTimeInfo(editorId: string, lines: string[]): void {
    if (!this.timeMatchModel.isConfigured()) { return; }
    const matchedLines = this.filterResultModel.getMatchedLines(editorId);
    if (matchedLines.length === 0) { return; }

    const info = this.timeMatchModel.computeRangeTimeInfo(matchedLines, lines);
    this.configPanel.sendRangeTimeInfo(info);
  }

  /** 使用 createFoldingRangeFromSelection 折叠未匹配行 */
  private async applyFolding(editor: vscode.TextEditor): Promise<void> {
    const editorId = editor.document.uri.toString();
    const ranges = this.filterResultModel.getUnmatchedRanges(editorId);
    if (ranges.length === 0) { return; }

    const savedSelection = editor.selection;

    await vscode.commands.executeCommand('editor.unfoldAll');

    for (const range of ranges) {
      if (range.start >= range.end) { continue; }
      const endLen = editor.document.lineAt(range.end).text.length;
      editor.selection = new vscode.Selection(range.start, 0, range.end, endLen);
      await vscode.commands.executeCommand('editor.createFoldingRangeFromSelection');
    }

    editor.selection = savedSelection;
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
    this.currentStartLine = undefined;
    this.currentEndLine = undefined;
    this.currentRangeDescription = undefined;
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
    const results = this.filterController.filter(lines, groups, this.currentStartLine, this.currentEndLine);
    this.filterResultModel.setResults(editorId, results);
    this.decorations.apply(results, editor, this.currentKeywords);

    // 重新计算时间标注
    if (this.timeMatchModel.isConfigured()) {
      const rawRanges = this.filterResultModel.getUnmatchedRanges(editorId);
      const foldRanges = this.timeMatchModel.computeFoldRanges(
        rawRanges, lines, editor.document.lineCount
      );
      this.decorations.applyTimeAnnotations(foldRanges, editor);
    }
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
  private async handleExport(groups: RegexGroup[], startLine?: number, endLine?: number, rangeDescription?: string, timePattern?: TimePatternConfig, keywords?: KeywordConfig[]): Promise<void> {
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file('greplogviewer-config.json'),
      filters: { 'JSON Files': ['json'] },
    });
    if (!uri) { return; }

    const content = JSON.stringify({ groups, startLine, endLine, rangeDescription, timePattern, keywords }, null, 2);
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
        startLine: data.startLine,
        endLine: data.endLine,
        rangeDescription: data.rangeDescription,
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
  private async handleSave(name: string, scope: ConfigScope, groups: RegexGroup[], startLine?: number, endLine?: number, rangeDescription?: string, timePattern?: TimePatternConfig, keywords?: KeywordConfig[]): Promise<void> {
    if (this.configStorageModel.exists(name, scope)) {
      const answer = await vscode.window.showWarningMessage(
        `Config "${name}" already exists in ${scope}. Overwrite?`,
        { modal: true },
        'Overwrite'
      );
      if (answer !== 'Overwrite') { return; }
    }

    await this.configStorageModel.save(name, {
      groups, startLine, endLine, rangeDescription, timePattern, keywords,
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
      entry.config.startLine,
      entry.config.endLine,
      entry.config.rangeDescription,
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

  dispose(): void {
    this.decorations.dispose();
  }
}
