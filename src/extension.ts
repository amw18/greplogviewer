// extension.ts — 插件入口
import * as vscode from 'vscode';
import { RegexGroupModel } from './model/RegexGroupModel';
import { EditorStateModel } from './model/EditorStateModel';
import { FilterResultModel } from './model/FilterResultModel';
import { TimeMatchModel } from './model/TimeMatchModel';
import { ConfigController } from './controller/ConfigController';
import { FilterController } from './controller/FilterController';
import { ViewController } from './controller/ViewController';
import { GrepController } from './controller/GrepController';

let viewController: ViewController | undefined;
let grepController: GrepController | undefined;

export function activate(context: vscode.ExtensionContext) {
  const regexGroupModel = new RegexGroupModel();
  const editorStateModel = new EditorStateModel(context);
  const filterResultModel = new FilterResultModel();
  const timeMatchModel = new TimeMatchModel();
  const configController = new ConfigController(regexGroupModel, editorStateModel);
  const filterController = new FilterController();

  viewController = new ViewController(
    configController, filterController,
    editorStateModel, filterResultModel, regexGroupModel, timeMatchModel
  );

  grepController = new GrepController(viewController, regexGroupModel, filterResultModel, editorStateModel);

  const panelProvider = viewController.getPanelProvider();
  const sidebarView = vscode.window.registerWebviewViewProvider(
    'greplogviewer.configView',
    panelProvider,
    { webviewOptions: { retainContextWhenHidden: true } }
  );

  // 右键菜单命令
  const grepKeywordCmd = vscode.commands.registerCommand('greplogviewer.grepKeyword', () => {
    grepController?.grepKeyword();
  });
  const grepFunctionCmd = vscode.commands.registerCommand('greplogviewer.grepFunction', () => {
    grepController?.grepFunction();
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
    grepKeywordCmd,
    grepFunctionCmd,
    editorChangeListener,
    docChangeListener,
    { dispose: () => viewController?.dispose() }
  );
}

export function deactivate() {
  viewController?.dispose();
}
