// extension.ts — 插件入口
import * as vscode from 'vscode';
import * as path from 'path';
import { RegexGroupModel } from './model/RegexGroupModel';
import { EditorStateModel } from './model/EditorStateModel';
import { FilterResultModel } from './model/FilterResultModel';
import { TimeMatchModel } from './model/TimeMatchModel';
import { ConfigStorageModel } from './model/ConfigStorageModel';
import { ConfigController } from './controller/ConfigController';
import { FilterController } from './controller/FilterController';
import { ViewController } from './controller/ViewController';
import { GrepController } from './controller/GrepController';
import { KeywordTimeline } from './view/KeywordTimeline';

let viewController: ViewController | undefined;
let grepController: GrepController | undefined;

export function activate(context: vscode.ExtensionContext) {
  const regexGroupModel = new RegexGroupModel();
  const editorStateModel = new EditorStateModel(context);
  const filterResultModel = new FilterResultModel();
  const timeMatchModel = new TimeMatchModel();
  const configController = new ConfigController(regexGroupModel, editorStateModel);
  const filterController = new FilterController();
  const configStorageModel = new ConfigStorageModel(context);

  const timeline = new KeywordTimeline();

  viewController = new ViewController(
    configController, filterController,
    editorStateModel, filterResultModel, regexGroupModel, timeMatchModel,
    configStorageModel, timeline
  );

  grepController = new GrepController(viewController, regexGroupModel, filterResultModel, editorStateModel);

  const panelProvider = viewController.getPanelProvider();
  const sidebarView = vscode.window.registerWebviewViewProvider(
    'greplogviewer.configView',
    panelProvider,
    { webviewOptions: { retainContextWhenHidden: true } }
  );

  const timelineView = vscode.window.registerWebviewViewProvider(
    'greplogviewer.timelineView',
    timeline,
    { webviewOptions: { retainContextWhenHidden: true } }
  );

  // 右键菜单命令
  const grepKeywordCmd = vscode.commands.registerCommand('greplogviewer.grepKeyword', () => {
    grepController?.grepKeyword();
  });
  const grepFunctionCmd = vscode.commands.registerCommand('greplogviewer.grepFunction', () => {
    grepController?.grepFunction();
  });
  const addKeywordCmd = vscode.commands.registerCommand('greplogviewer.addKeyword', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }
    const text = editor.document.getText(editor.selection.isEmpty ? undefined : editor.selection);
    if (!text) { return; }
    await viewController?.addKeyword(text);
  });
  const addDirToGroupCmd = vscode.commands.registerCommand('greplogviewer.addDirToGroup', async (uri: vscode.Uri) => {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) { return; }
    const relativePath = path.relative(folder.uri.fsPath, uri.fsPath) || '.';
    await viewController?.addDirToGroup(relativePath);
  });

  // ── Test-only commands for autotest automation ──
  const testGoCmd = vscode.commands.registerCommand('greplogviewer._testGo', async (config: any) => {
    await viewController?.testGo(config || {});
  });
  const testClearCmd = vscode.commands.registerCommand('greplogviewer._testClear', async () => {
    await viewController?.testClear();
  });
  const testResetCmd = vscode.commands.registerCommand('greplogviewer._testReset', async () => {
    await viewController?.testReset();
  });
  const testGetStateCmd = vscode.commands.registerCommand('greplogviewer._testGetState', (): any => {
    return {
      foldSummaries: viewController?.testGetFoldSummaries() || [],
      foldRanges: viewController?.testGetFoldRanges() || [],
      timeInfo: viewController?.testGetTimeInfo() || {},
    };
  });

  const editorChangeListener = vscode.window.onDidChangeActiveTextEditor(editor => {
    if (editor) { viewController!.attach(editor); }
  });

  const docChangeListener = vscode.workspace.onDidChangeTextDocument(e => {
    viewController?.onDocumentChange(e.document);
  });

  if (vscode.window.activeTextEditor) {
    viewController.attach(vscode.window.activeTextEditor);
  }

  context.subscriptions.push(
    sidebarView,
    timelineView,
    grepKeywordCmd,
    grepFunctionCmd,
    addKeywordCmd,
    addDirToGroupCmd,
    testGoCmd,
    testClearCmd,
    testResetCmd,
    testGetStateCmd,
    editorChangeListener,
    docChangeListener,
    { dispose: () => viewController?.dispose() }
  );
}

export function deactivate() {
  viewController?.dispose();
}
