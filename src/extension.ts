// extension.ts — 插件入口
import * as path from 'path';
import * as vscode from 'vscode';
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

  grepController = new GrepController(viewController);

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
  const testOpenFileCmd = vscode.commands.registerCommand('greplogviewer._testOpenFile', async (filePath: string) => {
    const uri = path.isAbsolute(filePath)
      ? vscode.Uri.file(filePath)
      : vscode.Uri.file(path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '', filePath));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
  });
  const testGetVisibleRangesCmd = vscode.commands.registerCommand('greplogviewer._testGetVisibleRanges', (): any => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return []; }
    return editor.visibleRanges.map(r => ({
      start: { line: r.start.line, character: r.start.character },
      end: { line: r.end.line, character: r.end.character },
    }));
  });

  const editorChangeListener = vscode.window.onDidChangeActiveTextEditor(editor => {
    if (editor) { viewController!.attach(editor); }
  });

  // ── 折叠区间 Provider（声明式，比逐个 createFoldingRangeFromSelection 快 N 倍）──
  const foldChangeEmitter = new vscode.EventEmitter<void>();
  filterResultModel.onChange(() => foldChangeEmitter.fire());
  const foldProvider = vscode.languages.registerFoldingRangeProvider(
    { scheme: 'file' },
    {
      onDidChangeFoldingRanges: foldChangeEmitter.event,
      provideFoldingRanges(document) {
        const ranges = filterResultModel.getUnmatchedRanges(document.uri.toString());
        // 无过滤结果时返回 undefined，让 VS Code 回退到默认折叠（不影响代码文件）
        if (!ranges.length) { return undefined; }
        return ranges.map(r => new vscode.FoldingRange(r.start, r.end));
      },
    }
  );

  const docChangeListener = vscode.workspace.onDidChangeTextDocument(e => {
    viewController?.onDocumentChange(e.document);
  });

  if (vscode.window.activeTextEditor) {
    viewController.attach(vscode.window.activeTextEditor);
  }

  context.subscriptions.push(
    sidebarView,
    timelineView,
    foldProvider,
    grepKeywordCmd,
    grepFunctionCmd,
    addKeywordCmd,
    testGoCmd,
    testClearCmd,
    testResetCmd,
    testGetStateCmd,
    testOpenFileCmd,
    testGetVisibleRangesCmd,
    editorChangeListener,
    docChangeListener,
    { dispose: () => viewController?.dispose() }
  );
}

export function deactivate() {
  viewController?.dispose();
}
