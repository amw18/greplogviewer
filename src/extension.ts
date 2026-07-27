// extension.ts - 插件入口
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
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
import { RingBufferModel } from './model/RingBufferModel';

let viewController: ViewController | undefined;
let grepController: GrepController | undefined;

export function activate(context: vscode.ExtensionContext) {
  // 安装/更新 skill 到 ~/.log--/ai/skills/
  installSkill(context);

  const regexGroupModel = new RegexGroupModel();
  const editorStateModel = new EditorStateModel(context);
  const filterResultModel = new FilterResultModel();
  const timeMatchModel = new TimeMatchModel();
  const configController = new ConfigController(regexGroupModel, editorStateModel);
  const filterController = new FilterController();
  const configStorageModel = new ConfigStorageModel(context);
  // ── 折叠区间 Provider（声明式，比逐个 createFoldingRangeFromSelection 快 N 倍）──

  const ringBufferModel = new RingBufferModel();
  const foldChangeEmitter = new vscode.EventEmitter<void>();
  filterResultModel.onChange(() => foldChangeEmitter.fire());

  let foldProvider: vscode.Disposable | undefined;
  const registerFoldProvider = () => {
    foldProvider?.dispose();
    foldProvider = vscode.languages.registerFoldingRangeProvider(
      { scheme: 'file' },
      {
        onDidChangeFoldingRanges: foldChangeEmitter.event,
        provideFoldingRanges(document) {
          const editorId = document.uri.toString();
          const results = filterResultModel.getResults(editorId);
          // 未过滤:返回 undefined,让 VS Code 回退到默认折叠(不影响代码文件)
          if (results === undefined) { return undefined; }
          // 已过滤(包括主动清空):返回实际区间或空数组,强制 VS Code 使用本插件的区间
          const ranges = filterResultModel.getUnmatchedRanges(editorId);
          return ranges.map(r => new vscode.FoldingRange(r.start, r.end));
        },
      }
    );
  };
  registerFoldProvider();

  viewController = new ViewController(
    configController, filterController,
    editorStateModel, filterResultModel, regexGroupModel, timeMatchModel,
    configStorageModel,
    context,
    ringBufferModel,
    registerFoldProvider
  );

  grepController = new GrepController(viewController);

  const panelProvider = viewController.getPanelProvider();
  const sidebarView = vscode.window.registerWebviewViewProvider(
    'log-minus-minus.configView',
    panelProvider,
    { webviewOptions: { retainContextWhenHidden: true } }
  );

  // 右键菜单命令
  const grepKeywordCmd = vscode.commands.registerCommand('log-minus-minus.grepKeyword', () => {
    grepController?.grepKeyword();
  });
  const grepFunctionCmd = vscode.commands.registerCommand('log-minus-minus.grepFunction', () => {
    grepController?.grepFunction();
  });
  const addKeywordCmd = vscode.commands.registerCommand('log-minus-minus.addKeyword', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }
    const text = editor.document.getText(editor.selection.isEmpty ? undefined : editor.selection);
    if (!text) { return; }
    await viewController?.addKeyword(text);
  });
  const gotoPrevHitCmd = vscode.commands.registerCommand('log-minus-minus.gotoPrevHit', () => {
    return viewController?.gotoPrevNextHit('prev');
  });
  const gotoNextHitCmd = vscode.commands.registerCommand('log-minus-minus.gotoNextHit', () => {
    return viewController?.gotoPrevNextHit('next');
  });
  const exportMatchedLinesCmd = vscode.commands.registerCommand('log-minus-minus.exportMatchedLines', () => {
    return viewController?.exportMatchedLines();
  });
  const gotoKeywordHitCmd = vscode.commands.registerCommand('log-minus-minus.gotoKeywordHit', (args: any) => {
    return viewController?.gotoKeywordHit(args?.direction || 'next', args?.keywordId);
  });

  // ── Test-only commands for autotest automation ──
  const testGoCmd = vscode.commands.registerCommand('log-minus-minus._testGo', async (config: any) => {
    await viewController?.testGo(config || {});
  });
  const testSyncConfigCmd = vscode.commands.registerCommand('log-minus-minus._testSyncConfig', (config: any) => {
    viewController?.testSyncConfig(config || {});
  });
  const testClearCmd = vscode.commands.registerCommand('log-minus-minus._testClear', async () => {
    await viewController?.testClear();
  });
  const testResetCmd = vscode.commands.registerCommand('log-minus-minus._testReset', async () => {
    await viewController?.testReset();
  });
  const testGetStateCmd = vscode.commands.registerCommand('log-minus-minus._testGetState', (): any => {
    return {
      foldSummaries: viewController?.testGetFoldSummaries() || [],
      foldRanges: viewController?.testGetFoldRanges() || [],
      timeInfo: viewController?.testGetTimeInfo() || {},
    };
  });
  const testOpenFileCmd = vscode.commands.registerCommand('log-minus-minus._testOpenFile', async (filePath: string) => {
    const uri = path.isAbsolute(filePath)
      ? vscode.Uri.file(filePath)
      : vscode.Uri.file(path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '', filePath));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
  });
  const testGetVisibleRangesCmd = vscode.commands.registerCommand('log-minus-minus._testGetVisibleRanges', (): any => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return []; }
    return editor.visibleRanges.map(r => ({
      start: { line: r.start.line, character: r.start.character },
      end: { line: r.end.line, character: r.end.character },
    }));
  });
  const testGetEditorInfoCmd = vscode.commands.registerCommand('log-minus-minus._testGetEditorInfo', (): any => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return null; }
    const doc = editor.document;
    return {
      fileName: doc.fileName,
      isUntitled: doc.isUntitled,
      languageId: doc.languageId,
      lineCount: doc.lineCount,
      cursorLine: editor.selection.active.line,
    };
  });
  const testGetTimelineDataCmd = vscode.commands.registerCommand('log-minus-minus._testGetTimelineData', (): any => {
    return viewController?.testGetTimelineData() || {};
  });
  const testGetMatchCountsCmd = vscode.commands.registerCommand('log-minus-minus._testGetMatchCounts', (): any => {
    return viewController?.testGetMatchCounts() || {};
  });
  const testOpenFilteredTempFileCmd = vscode.commands.registerCommand('log-minus-minus._testOpenFilteredTempFile', async (): Promise<any> => {
    await viewController?.testOpenFilteredTempFile();
    const editor = vscode.window.activeTextEditor;
    return editor ? { fileName: editor.document.fileName, lineCount: editor.document.lineCount } : null;
  });
  const testGetRingBufferStateCmd = vscode.commands.registerCommand('log-minus-minus._testGetRingBufferState', (): any => {
    return viewController?.testGetRingBufferState?.() ?? {};
  });
  const testGetSavedConfigsCmd = vscode.commands.registerCommand('log-minus-minus._testGetSavedConfigs', (): any => {
    return configStorageModel.listAll();
  });

  const editorChangeListener = vscode.window.onDidChangeActiveTextEditor(editor => {
    if (editor) { viewController!.attach(editor); }
  });

  const docChangeListener = vscode.workspace.onDidChangeTextDocument(async e => {
    await viewController?.onDocumentChange(e.document);
  });

  if (vscode.window.activeTextEditor) {
    viewController.attach(vscode.window.activeTextEditor);
  }

  context.subscriptions.push(
    sidebarView,
    { dispose: () => foldProvider?.dispose() },
    grepKeywordCmd,
    grepFunctionCmd,
    addKeywordCmd,
    gotoPrevHitCmd,
    gotoNextHitCmd,
    exportMatchedLinesCmd,
    gotoKeywordHitCmd,
    testGoCmd,
    testSyncConfigCmd,
    testClearCmd,
    testResetCmd,
    testGetStateCmd,
    testOpenFileCmd,
    testGetVisibleRangesCmd,
    testGetEditorInfoCmd,
    testGetTimelineDataCmd,
    testGetMatchCountsCmd,
    testOpenFilteredTempFileCmd,
    testGetRingBufferStateCmd,
    testGetSavedConfigsCmd,
    editorChangeListener,
    docChangeListener,
    { dispose: () => viewController?.dispose() }
  );
}

export function deactivate() {
  viewController?.dispose();
}

/**
 * 将打包的 log-config skill 拷贝到用户 ~/.log--/ai/skills/ 目录。
 * 已存在且内容相同时跳过,避免每次激活都写盘。
 */
function installSkill(context: vscode.ExtensionContext): void {
  const bundledSkillPath = path.join(context.extensionPath, 'skills', 'log-config', 'SKILL.md');
  const targetDir = path.join(os.homedir(), '.log--', 'ai', 'skills', 'log-config');
  const targetPath = path.join(targetDir, 'SKILL.md');

  let bundledContent: string;
  try {
    bundledContent = fs.readFileSync(bundledSkillPath, 'utf-8');
  } catch {
    // 打包文件缺失,静默跳过
    return;
  }

  // 已存在且内容相同则跳过
  try {
    const existing = fs.readFileSync(targetPath, 'utf-8');
    if (existing === bundledContent) { return; }
  } catch {
    // 不存在,继续拷贝
  }

  try {
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(targetPath, bundledContent, 'utf-8');
  } catch {
    // 权限不足等错误,静默跳过
  }
}
