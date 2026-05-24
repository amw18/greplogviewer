// ViewController — 协调 View 和 Controller，管理编辑器生命周期
import * as vscode from 'vscode';
import { RegexGroup, TimePatternConfig, KeywordConfig } from '../types';
import { ConfigController } from './ConfigController';
import { FilterController } from './FilterController';
import { EditorStateModel } from '../model/EditorStateModel';
import { FilterResultModel } from '../model/FilterResultModel';
import { RegexGroupModel } from '../model/RegexGroupModel';
import { TimeMatchModel } from '../model/TimeMatchModel';
import { ConfigPanel } from '../view/ConfigPanel';
import { EditorDecorations } from '../view/EditorDecorations';

export class ViewController {
  private configPanel: ConfigPanel;
  private decorations: EditorDecorations;
  private currentEditor: vscode.TextEditor | undefined;
  private currentStartLine?: number;
  private currentEndLine?: number;
  private currentKeywords?: KeywordConfig[];

  constructor(
    configController: ConfigController,
    private filterController: FilterController,
    private editorStateModel: EditorStateModel,
    private filterResultModel: FilterResultModel,
    private regexGroupModel: RegexGroupModel,
    private timeMatchModel: TimeMatchModel
  ) {
    this.configPanel = new ConfigPanel();
    this.decorations = new EditorDecorations();

    this.configPanel.onGo((g, s, e, tp, kw) => this.handleGo(g, s, e, tp, kw));
    this.configPanel.onReset(() => this.handleReset());
    this.configPanel.onClear(() => this.handleClear());
  }

  getPanelProvider(): ConfigPanel {
    return this.configPanel;
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
    }

    const tp = this.timeMatchModel.getConfig();
    this.configPanel.render(
      this.regexGroupModel.getGroups(),
      this.currentStartLine, this.currentEndLine,
      tp.format ? tp : undefined,
      this.currentKeywords
    );
  }

  /** Go: 应用过滤 + 颜色高亮 + 创建折叠 + 时间标注 */
  private async handleGo(groups: RegexGroup[], startLine?: number, endLine?: number, timePattern?: TimePatternConfig, keywords?: KeywordConfig[]): Promise<void> {
    if (!this.currentEditor) { return; }
    const editor = this.currentEditor;
    const editorId = editor.document.uri.toString();

    this.regexGroupModel.setGroups(groups);
    this.currentStartLine = startLine;
    this.currentEndLine = endLine;

    // 时间匹配配置
    if (timePattern && timePattern.format) {
      this.timeMatchModel.setConfig(timePattern);
    }

    // 关键字配置
    this.currentKeywords = keywords;

    this.editorStateModel.saveConfig(editorId, {
      groups, startLine, endLine,
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
  }

  /** 使用 createFoldingRangeFromSelection 折叠未匹配行 */
  private async applyFolding(editor: vscode.TextEditor): Promise<void> {
    const editorId = editor.document.uri.toString();
    const ranges = this.filterResultModel.getUnmatchedRanges(editorId);
    if (ranges.length === 0) { return; }

    await vscode.commands.executeCommand('editor.unfoldAll');

    for (const range of ranges) {
      if (range.start >= range.end) { continue; }
      const endLen = editor.document.lineAt(range.end).text.length;
      editor.selection = new vscode.Selection(range.start, 0, range.end, endLen);
      await vscode.commands.executeCommand('editor.createFoldingRangeFromSelection');
    }
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
    await vscode.commands.executeCommand('editor.unfoldAll');
    const lastLine = editor.document.lineCount - 1;
    editor.selection = new vscode.Selection(0, 0, lastLine, editor.document.lineAt(lastLine).text.length);
    await vscode.commands.executeCommand('editor.removeManualFoldingRanges');
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

  dispose(): void {
    this.decorations.dispose();
  }
}
