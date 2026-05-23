// ViewController — 协调 View 和 Controller，管理编辑器生命周期
import * as vscode from 'vscode';
import { RegexGroup } from '../types';
import { ConfigController } from './ConfigController';
import { FilterController } from './FilterController';
import { EditorStateModel } from '../model/EditorStateModel';
import { FilterResultModel } from '../model/FilterResultModel';
import { RegexGroupModel } from '../model/RegexGroupModel';
import { ConfigPanel } from '../view/ConfigPanel';
import { EditorDecorations } from '../view/EditorDecorations';

export class ViewController {
  private configPanel: ConfigPanel;
  private decorations: EditorDecorations;
  private currentEditor: vscode.TextEditor | undefined;

  constructor(
    configController: ConfigController,
    private filterController: FilterController,
    private editorStateModel: EditorStateModel,
    private filterResultModel: FilterResultModel,
    private regexGroupModel: RegexGroupModel
  ) {
    this.configPanel = new ConfigPanel();
    this.decorations = new EditorDecorations();

    // 绑定面板回调
    this.configPanel.onGo(groups => this.handleGo(groups));
    this.configPanel.onReset(() => this.handleReset());
  }

  /** 返回 ConfigPanel 供 extension.ts 注册 WebviewViewProvider */
  getPanelProvider(): ConfigPanel {
    return this.configPanel;
  }

  /** 切换到指定编辑器，加载其配置 */
  attach(editor: vscode.TextEditor): void {
    this.decorations.clear();
    this.currentEditor = editor;

    // 加载该文档的持久化配置
    const savedConfig = this.editorStateModel.loadConfig(editor.document.uri.toString());
    if (savedConfig) {
      this.regexGroupModel.setGroups(savedConfig);
      if (this.editorStateModel.isActive(editor.document.uri.toString())) {
        this.reapplyFilter();
      }
    } else {
      this.regexGroupModel.setGroups([]);
    }

    // 刷新侧边栏面板数据
    this.configPanel.render(this.regexGroupModel.getGroups());
  }

  /** 分离编辑器 */
  detach(editor: vscode.TextEditor): void {
    if (this.currentEditor === editor) {
      this.decorations.clear();
    }
  }

  /** Go 按钮处理：保存配置 → 执行过滤 → 应用显示 */
  private async handleGo(groups: RegexGroup[]): Promise<void> {
    if (!this.currentEditor) { return; }

    const editor = this.currentEditor;
    const editorId = editor.document.uri.toString();

    this.regexGroupModel.setGroups(groups);
    this.editorStateModel.saveConfig(editor.document.uri.toString(), groups);
    this.editorStateModel.setActive(editorId, true);

    const results = this.filterController.filter(this.readLines(editor), groups);
    this.filterResultModel.setResults(editorId, results);
    this.decorations.apply(results, editor);
    await this.applyFolding(editor);
  }

  /** 触发自动折叠 */
  private async applyFolding(editor: vscode.TextEditor): Promise<void> {
    const editorId = editor.document.uri.toString();
    const ranges = this.filterResultModel.getUnmatchedRanges(editorId);
    if (ranges.length === 0) { return; }

    await vscode.commands.executeCommand('editor.unfoldAll');

    const currentLang = editor.document.languageId;
    const altLang = currentLang === 'plaintext' ? 'log' : 'plaintext';
    await vscode.languages.setTextDocumentLanguage(editor.document, altLang);
    await vscode.languages.setTextDocumentLanguage(editor.document, currentLang);

    await new Promise(r => setTimeout(r, 500));
    await vscode.commands.executeCommand('editor.foldAllMarkerRegions');
  }

  /** Reset 按钮 */
  private handleReset(): void {
    if (!this.currentEditor) { return; }

    const editor = this.currentEditor;
    const editorId = editor.document.uri.toString();

    this.regexGroupModel.setGroups([]);
    this.editorStateModel.clearEditor(editorId);
    this.filterResultModel.clearResults(editorId);
    this.decorations.clear();
    vscode.commands.executeCommand('editor.unfoldAll');
  }

  /** 文档变更时重新过滤 */
  onDocumentChange(document: vscode.TextDocument): void {
    if (!this.currentEditor) { return; }
    if (document !== this.currentEditor.document) { return; }

    const editor = this.currentEditor;
    const editorId = editor.document.uri.toString();

    if (!this.editorStateModel.isActive(editorId)) { return; }

    const groups = this.regexGroupModel.getGroups();
    if (groups.length === 0) { return; }

    const results = this.filterController.filter(this.readLines(editor), groups);
    this.filterResultModel.setResults(editorId, results);
    this.decorations.apply(results, editor);
  }

  private reapplyFilter(): void {
    if (!this.currentEditor) { return; }
    const editor = this.currentEditor;
    const editorId = editor.document.uri.toString();
    const groups = this.regexGroupModel.getGroups();
    const results = this.filterController.filter(this.readLines(editor), groups);
    this.filterResultModel.setResults(editorId, results);
    this.decorations.apply(results, editor);
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
