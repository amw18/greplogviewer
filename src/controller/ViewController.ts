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
    private context: vscode.ExtensionContext,
    private configController: ConfigController,
    private filterController: FilterController,
    private editorStateModel: EditorStateModel,
    private filterResultModel: FilterResultModel,
    private regexGroupModel: RegexGroupModel
  ) {
    this.configPanel = new ConfigPanel(context);
    this.decorations = new EditorDecorations();

    // 绑定面板回调
    this.configPanel.onGo(groups => this.handleGo(groups));
    this.configPanel.onReset(() => this.handleReset());
  }

  /** 切换到指定编辑器，加载其配置 */
  attach(editor: vscode.TextEditor): void {
    // 先清理旧编辑器的装饰
    this.decorations.clear();

    this.currentEditor = editor;

    // 加载该文档的持久化配置
    const savedConfig = this.editorStateModel.loadConfig(editor.document.uri.toString());
    if (savedConfig) {
      this.regexGroupModel.setGroups(savedConfig);

      // 如果之前已激活，重新应用过滤
      if (this.editorStateModel.isActive(editor.document.uri.toString())) {
        this.reapplyFilter();
      }
    } else {
      this.regexGroupModel.setGroups([]);
    }

    // 显示配置面板（首次创建时注入初始数据）
    this.configPanel.show(this.regexGroupModel.getGroups());
    // 面板已存在时发送更新消息
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

    // 保存配置
    this.regexGroupModel.setGroups(groups);
    this.editorStateModel.saveConfig(editor.document.uri.toString(), groups);
    this.editorStateModel.setActive(editorId, true);

    // 执行过滤
    const results = this.filterController.filter(this.readLines(editor), groups);
    this.filterResultModel.setResults(editorId, results);

    // 应用颜色装饰
    this.decorations.apply(results, editor);

    // 折叠未匹配行
    await this.applyFolding(editor);
  }

  /**
   * 折叠未匹配行。
   * 通过 editor.edit 触发文档变更 → VS Code 重新查询 FoldingRangeProvider →
   * foldAll 折叠。两次 edit（插入+撤销）确保 Provider 拿到最新 filterResult。
   */
  private async applyFolding(editor: vscode.TextEditor): Promise<void> {
    const editorId = editor.document.uri.toString();
    const ranges = this.filterResultModel.getUnmatchedRanges(editorId);
    console.log(`[GrepLogViewer] applyFolding: ${ranges.length} ranges to fold`);
    if (ranges.length === 0) { return; }

    // 先展开所有折叠
    await vscode.commands.executeCommand('editor.unfoldAll');
    console.log('[GrepLogViewer] unfoldAll done');

    // 插入空格触发文档变更，让 FoldingRangeProvider 重新计算
    const edited = await editor.edit(builder => {
      builder.insert(new vscode.Position(0, 0), ' ');
    });
    console.log(`[GrepLogViewer] edit result: ${edited}`);

    if (edited) {
      // 撤销恢复文档原样（撤销也是一次文档变更 → Provider 再次刷新）
      await vscode.commands.executeCommand('undo');
      console.log('[GrepLogViewer] undo done, waiting 200ms');
      // 等待 folding 计算完成
      await new Promise(r => setTimeout(r, 200));
      console.log('[GrepLogViewer] calling foldAll');
      await vscode.commands.executeCommand('editor.foldAll');
      console.log('[GrepLogViewer] foldAll done');
    }
  }

  /** Reset 按钮处理：清除配置和显示 */
  private handleReset(): void {
    if (!this.currentEditor) { return; }

    const editor = this.currentEditor;
    const editorId = editor.document.uri.toString();

    this.regexGroupModel.setGroups([]);
    this.editorStateModel.clearEditor(editorId);
    this.filterResultModel.clearResults(editorId);
    this.decorations.clear();
    this.unfoldAll();
  }

  /** 文档变更时重新应用过滤（仅当前编辑器且已激活时） */
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

  /** 重新应用当前过滤（用于编辑器切换后恢复） */
  private reapplyFilter(): void {
    if (!this.currentEditor) { return; }
    const editor = this.currentEditor;
    const editorId = editor.document.uri.toString();
    const groups = this.regexGroupModel.getGroups();
    const results = this.filterController.filter(this.readLines(editor), groups);
    this.filterResultModel.setResults(editorId, results);
    this.decorations.apply(results, editor);
  }

  /** 读取编辑器所有行文本 */
  private readLines(editor: vscode.TextEditor): string[] {
    const lines: string[] = [];
    for (let i = 0; i < editor.document.lineCount; i++) {
      lines.push(editor.document.lineAt(i).text);
    }
    return lines;
  }

  /** 展开所有折叠 */
  private unfoldAll(): void {
    vscode.commands.executeCommand('editor.unfoldAll');
  }

  /** 释放资源 */
  dispose(): void {
    this.configPanel.dispose();
    this.decorations.dispose();
  }
}
