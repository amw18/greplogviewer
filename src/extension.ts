// extension.ts — 插件入口
import * as vscode from 'vscode';
import { RegexGroupModel } from './model/RegexGroupModel';
import { EditorStateModel } from './model/EditorStateModel';
import { FilterResultModel } from './model/FilterResultModel';
import { ConfigController } from './controller/ConfigController';
import { FilterController } from './controller/FilterController';
import { ViewController } from './controller/ViewController';

let viewController: ViewController | undefined;

export function activate(context: vscode.ExtensionContext) {
  // 初始化模型
  const regexGroupModel = new RegexGroupModel();
  const editorStateModel = new EditorStateModel(context);
  const filterResultModel = new FilterResultModel();

  // 初始化控制器
  const configController = new ConfigController(regexGroupModel, editorStateModel);
  const filterController = new FilterController();

  // 初始化视图控制器
  viewController = new ViewController(
    configController, filterController,
    editorStateModel, filterResultModel, regexGroupModel
  );

  // 注册侧边栏 WebviewView
  const panelProvider = viewController.getPanelProvider();
  const sidebarView = vscode.window.registerWebviewViewProvider(
    'greplogviewer.configView',
    panelProvider,
    { webviewOptions: { retainContextWhenHidden: true } }
  );

  // 注册 FoldingRangeProvider
  const foldingProvider = vscode.languages.registerFoldingRangeProvider(
    { scheme: 'file' },
    {
      provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
        const editorId = document.uri.toString();
        const ranges = filterResultModel.getUnmatchedRanges(editorId);
        return ranges
          .filter(r => r.start < r.end)
          .map(r => new vscode.FoldingRange(r.start, r.end, vscode.FoldingRangeKind.Region));
      }
    }
  );

  // 监听编辑器切换
  const editorChangeListener = vscode.window.onDidChangeActiveTextEditor(editor => {
    if (editor) {
      viewController!.attach(editor);
    }
  });

  // 监听文档变更
  const docChangeListener = vscode.workspace.onDidChangeTextDocument(e => {
    if (viewController) {
      viewController.onDocumentChange(e.document);
    }
  });

  // 当前活动编辑器
  if (vscode.window.activeTextEditor) {
    viewController.attach(vscode.window.activeTextEditor);
  }

  context.subscriptions.push(
    sidebarView,
    foldingProvider,
    editorChangeListener,
    docChangeListener,
    { dispose: () => viewController?.dispose() }
  );
}

export function deactivate() {
  viewController?.dispose();
}
