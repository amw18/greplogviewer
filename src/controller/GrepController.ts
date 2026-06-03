// GrepController — 右键菜单 grep 关键字/函数跳转到关联代码目录
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ViewController } from './ViewController';
import { RegexGroupModel } from '../model/RegexGroupModel';
import { FilterResultModel } from '../model/FilterResultModel';
import { EditorStateModel } from '../model/EditorStateModel';

/** 解析后的目录配置 */
interface ParsedDirs {
  includes: string[];
  excludes: string[];
}

export class GrepController {
  constructor(
    private viewController: ViewController,
    private regexGroupModel: RegexGroupModel,
    private filterResultModel: FilterResultModel,
    private editorStateModel: EditorStateModel
  ) {}

  /** Grep Keyword: grep -Rn "keyword" dirs */
  async grepKeyword(): Promise<void> {
    const keyword = this.getSelectedText();
    if (!keyword) { return; }
    await this.runGrep(keyword);
  }

  /**
   * Grep Function: 纯 Node.js 多行匹配函数定义（跨平台）
   * 从 keyword( 开始，按括号深度匹配到闭合 )，支持嵌套括号。
   */
  async grepFunction(): Promise<void> {
    const keyword = this.getSelectedText();
    if (!keyword) { return; }
    await this.runGrepFunctionNode(keyword);
  }

  /** 获取关联目录配置（拆分 include/exclude，环境变量由 shell 展开） */
  private getParsedDirs(): ParsedDirs {
    const dirsStr = this.getRawDirs();
    if (!dirsStr) { return { includes: [], excludes: [] }; }
    return this.parseDirs(dirsStr);
  }

  /** 从持久化配置中获取原始 associatedDirs 字符串（无需点 Go） */
  private getRawDirs(): string | undefined {
    const editor = this.viewController.getCurrentEditor();
    if (!editor) { return undefined; }

    const editorId = editor.document.uri.toString();

    // 优先从持久化配置读取（不依赖 Go 按钮）
    const savedConfig = this.editorStateModel.loadConfig(editorId);
    if (savedConfig?.groups) {
      // 尝试在选中行找到匹配的组
      const results = this.filterResultModel.getResults(editorId);
      const lineNumber = editor.selection.active.line;
      if (results) {
        const lineResult = results.find(r => r.lineNumber === lineNumber);
        if (lineResult?.groupId) {
          const group = savedConfig.groups.find(g => g.id === lineResult.groupId);
          if (group?.associatedDirs) { return group.associatedDirs; }
        }
      }
      // 回退：使用第一个有 associatedDirs 的启用组
      for (const group of savedConfig.groups) {
        if (group.enabled === false) { continue; }
        if (group.associatedDirs) { return group.associatedDirs; }
      }
    }

    // 再去内存模型找
    for (const group of this.regexGroupModel.getGroups()) {
      if (group.enabled === false) { continue; }
      if (group.associatedDirs) { return group.associatedDirs; }
    }

    return undefined;
  }

  /**
   * 解析分号分隔的目录字符串。
   * 环境变量 ${VAR}/$VAR 通过 process.env 展开。
   * 以 ! 开头的路径为排除项。
   */
  private parseDirs(raw: string): ParsedDirs {
    const includes: string[] = [];
    const excludes: string[] = [];

    for (let part of raw.split(';')) {
      part = part.trim();
      if (part.length === 0) { continue; }
      // 展开环境变量
      part = part.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? '');
      part = part.replace(/\$(\w+)/g, (_, name) => process.env[name] ?? '');

      if (part.startsWith('!')) {
        const ex = part.slice(1).trim();
        if (ex.length > 0) {
          excludes.push(ex);
        }
      } else {
        includes.push(part);
      }
    }

    return { includes, excludes };
  }

  /** 获取选中的文本 */
  private getSelectedText(): string | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return undefined; }

    const selection = editor.selection;
    if (selection.isEmpty) {
      const wordRange = editor.document.getWordRangeAtPosition(selection.active);
      if (wordRange) {
        return editor.document.getText(wordRange);
      }
      return undefined;
    }

    return editor.document.getText(selection).trim();
  }

  /** 执行 grep 并在 terminal 中显示结果 */
  private async runGrep(pattern: string): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showWarningMessage('GrepLogViewer: No workspace folder open.');
      return;
    }

    const rootPath = workspaceFolder.uri.fsPath;
    const { includes, excludes } = this.getParsedDirs();

    // 使用绝对路径确保 grep 在任何 terminal cwd 下都能检索
    const searchPaths = includes.length > 0
      ? includes.map(d => `"${path.resolve(rootPath, d)}"`)
      : [`"${rootPath}"`];

    // 排除目录：shell 脚本先展开变量再取 basename 传给 --exclude-dir
    let prefix = '';
    const excludeFlags = excludes.length > 0
      ? excludes.map(d => {
          // 用 shell 取 basename：${d##*/} 去除路径前缀
          prefix += `_ex${excludes.indexOf(d)}=${d}; `;
          return `--exclude-dir="\${_ex${excludes.indexOf(d)}##*/}"`;
        }).join(' ')
      : '';

    const safePattern = pattern.replace(/'/g, "'\\''");
    const sep = '>>>';
    // 用 sed 把绝对路径截短为 workspace-relative，Ctrl+click 可用
    const escapedRoot = rootPath.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&');
    const sedStrip = `sed "s|^\${escapedRoot}/||"`;
    const command = `${prefix}echo "${sep}" && grep -Rn --color=always ${excludeFlags} '${safePattern}' ${searchPaths.join(' ')} | ${sedStrip} && echo "${sep}"`;

    let terminal = vscode.window.activeTerminal;
    if (!terminal) {
      terminal = vscode.window.createTerminal({ name: 'GrepLogViewer', cwd: rootPath });
    }
    terminal.show();
    terminal.sendText(command);
  }

  // ================================================================
  //  Grep Function — 纯 Node.js 跨平台实现
  // ================================================================

  /** 纯 Node.js 多行函数定义搜索 */
  private async runGrepFunctionNode(keyword: string): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showWarningMessage('GrepLogViewer: No workspace folder open.');
      return;
    }

    const rootPath = workspaceFolder.uri.fsPath;
    const { includes, excludes } = this.getParsedDirs();

    // 构建搜索根目录列表
    const searchRoots = includes.length > 0
      ? includes.map(d => path.resolve(rootPath, d))
      : [rootPath];

    // 排除目录的 basename 集合
    const excludeNames = new Set(excludes.map(d => path.basename(d)));

    // 构建函数定义匹配正则
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const startPattern = new RegExp(`\\b${escaped}\\s*\\(`);

    // 收集结果
    const results: string[] = [];

    // 遍历目录
    for (const searchRoot of searchRoots) {
      this.searchDir(searchRoot, rootPath, startPattern, excludeNames, results);
    }

    // 写入临时文件并用终端显示
    const sep = '>>>';
    const lines: string[] = [sep];
    if (results.length === 0) {
      lines.push('(no matches)');
    } else {
      lines.push(...results);
    }
    lines.push(sep);

    const tmpFile = path.join(os.tmpdir(), `greplogviewer_func_${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, lines.join('\n'), 'utf-8');

    // 跨平台显示：Windows 用 type，其他用 cat
    const catCmd = process.platform === 'win32' ? 'type' : 'cat';
    const displayCmd = `${catCmd} "${tmpFile.replace(/\\/g, '\\\\')}"`;

    let terminal = vscode.window.activeTerminal;
    if (!terminal) {
      terminal = vscode.window.createTerminal({ name: 'GrepLogViewer', cwd: rootPath });
    }
    terminal.show();
    terminal.sendText(displayCmd);

    // 延迟清理临时文件
    setTimeout(() => {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }, 10000);
  }

  /** 递归搜索目录 */
  private searchDir(
    dir: string,
    rootPath: string,
    pattern: RegExp,
    excludeNames: Set<string>,
    results: string[]
  ): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      // 跳过隐藏文件和目录
      if (entry.name.startsWith('.')) { continue; }
      // 跳过常见非代码目录
      if (entry.isDirectory() && (entry.name === 'node_modules' || entry.name === '__pycache__')) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (excludeNames.has(entry.name)) { continue; }
        this.searchDir(fullPath, rootPath, pattern, excludeNames, results);
      } else if (entry.isFile()) {
        // 跳过二进制/大型文件（简单扩展名过滤）
        const ext = path.extname(entry.name).toLowerCase();
        if (['.o', '.obj', '.exe', '.dll', '.so', '.a', '.lib', '.class',
             '.jar', '.zip', '.tar', '.gz', '.png', '.jpg', '.gif', '.ico',
             '.pdf', '.ttf', '.woff', '.woff2', '.mp3', '.mp4', '.avi'].includes(ext)) {
          continue;
        }
        this.searchFile(fullPath, rootPath, pattern, results);
      }
    }
  }

  /** 搜索单个文件中的函数定义 */
  private searchFile(
    filePath: string,
    rootPath: string,
    startPattern: RegExp,
    results: string[]
  ): void {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      return;
    }

    const relPath = path.relative(rootPath, filePath);
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      if (!startPattern.test(lines[i])) { continue; }

      // 找到函数定义起始行，按括号深度匹配到闭合
      let depth = 0;
      const matchStart = i;
      let matchEnd = i;

      for (let j = i; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === '(') { depth++; }
          else if (ch === ')') { depth--; }
        }
        if (depth <= 0) {
          matchEnd = j;
          break;
        }
      }

      // 输出所有匹配行
      for (let k = matchStart; k <= matchEnd && k < lines.length; k++) {
        results.push(`${relPath}:${k + 1}:${lines[k]}`);
      }

      // 跳过已匹配的行
      i = matchEnd;
    }
  }
}
