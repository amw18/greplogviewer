// GrepController — 右键菜单 grep 关键字/函数跳转到关联代码目录
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';
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
  /** Grep Function: 用 grep 搜索 keyword( 函数定义行 */
  async grepFunction(): Promise<void> {
    const keyword = this.getSelectedText();
    if (!keyword) { return; }
    await this.runGrepFunction(keyword);
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

    // 使用绝对路径（不依赖 terminal cwd）
    const absDirs = includes.length > 0
      ? includes.map(d => path.resolve(rootPath, d))
      : [rootPath];
    const searchPaths = absDirs.map(d => `"${d}"`).join(' ');

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
    let command = `${prefix}echo "${sep}" && grep -Rn --color=always ${excludeFlags} '${safePattern}' ${searchPaths}`;
    // 用 sed 把 home 目录前缀替换为 ~，缩短输出路径
    const homeDir = os.homedir();
    if (absDirs.some(d => d.startsWith(homeDir))) {
      command += ` | sed "s|^${homeDir}/|~\/|"`;
    }
    command += ` && echo "${sep}"`;

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

  /** 用 grep + Node.js 搜索多行函数定义 */
  private async runGrepFunction(keyword: string): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showWarningMessage('GrepLogViewer: No workspace folder open.');
      return;
    }

    const rootPath = workspaceFolder.uri.fsPath;
    const { includes, excludes } = this.getParsedDirs();

    const absDirs = includes.length > 0
      ? includes.map(d => path.resolve(rootPath, d))
      : [rootPath];

    // Step 1: 用 grep 快速找出包含 keyword 的文件
    const searchPaths = absDirs.map(d => `"${d}"`).join(' ');
    let prefix = '';
    const excludeFlags = excludes.length > 0
      ? excludes.map(d => {
          prefix += `_ex${excludes.indexOf(d)}=${d}; `;
          return `--exclude-dir="\${_ex${excludes.indexOf(d)}##*/}"`;
        }).join(' ')
      : '';

    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const kwPattern = `\\b${escaped}\\s*\\(`;
    // grep -Erl: 只输出文件名（ERE 模式，\( = 字面括号）
    const grepCmd = `${prefix}grep -Erl ${excludeFlags} '${kwPattern}' ${searchPaths}`;

    // Step 2: 逐一读取候选文件，多行匹配函数定义
    const result = spawnSync('sh', ['-c', grepCmd], { cwd: rootPath, encoding: 'utf-8', timeout: 15000 });
    const files = (result.stdout || '').trim().split('\n').filter(Boolean);

    // 在候选文件中匹配函数定义（多行）
    const defPattern = new RegExp(`\\b${escaped}\\s*\\(`);
    const results: string[] = [];

    for (const file of files) {
      const absPath = path.isAbsolute(file) ? file : path.resolve(rootPath, file);
      this.matchDefinitions(absPath, rootPath, defPattern, results);
    }

    this.outputResults(results, rootPath);
  }

  /** 在单个文件中匹配多行函数定义 */
  private matchDefinitions(
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

    const homeDir = os.homedir();
    const displayPath = filePath.startsWith(homeDir)
      ? '~' + filePath.slice(homeDir.length)
      : path.relative(rootPath, filePath);
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      if (!startPattern.test(lines[i])) { continue; }

      // 从 keyword( 行开始，按括号深度追踪到闭合的 )
      let depth = 0;
      let started = false;
      const matchStart = i;
      let parenEnd = i;
      let closeCol = -1;  // ) 所在的列（同一行内）

      for (let j = i; j < lines.length; j++) {
        for (let c = 0; c < lines[j].length; c++) {
          const ch = lines[j][c];
          if (ch === '(') { depth++; started = true; }
          else if (ch === ')') {
            depth--;
            if (started && depth <= 0) {
              parenEnd = j;
              closeCol = c;
              break;
            }
          }
        }
        if (closeCol >= 0) { break; }
      }
      if (closeCol < 0) { continue; }

      // 检查 ) 之后到 { 之间是否只有空白
      // 从 ) 下一字符开始扫描，跳过空白，直到遇到非空白字符
      let foundBrace = false;
      let hasOtherCode = false;
      let braceLine = -1;

      scanLoop:
      for (let j = parenEnd; j < Math.min(parenEnd + 5, lines.length); j++) {
        const startCol = (j === parenEnd) ? closeCol + 1 : 0;
        for (let c = startCol; c < lines[j].length; c++) {
          const ch = lines[j][c];
          if (ch === ' ' || ch === '\t' || ch === '\r') { continue; }
          // 跳过单行注释
          if (ch === '/' && c + 1 < lines[j].length && lines[j][c + 1] === '/') {
            break; // 跳过本行剩余
          }
          if (ch === '{') {
            foundBrace = true;
            braceLine = j;
            break scanLoop;
          }
          // 遇到其他非空白字符（; 或任何代码）→ 不是定义
          hasOtherCode = true;
          break scanLoop;
        }
      }

      if (!foundBrace || hasOtherCode) { continue; }

      // 输出 keyword( 起始行到 ) 所在行（如果 { 单独一行也输出）
      const endLine = braceLine >= 0 ? braceLine : parenEnd;
      for (let k = matchStart; k <= endLine && k < lines.length; k++) {
        results.push(`${displayPath}:${k + 1}:${lines[k]}`);
      }

      i = endLine;
    }
  }

  /** 输出结果到 terminal */
  private outputResults(results: string[], rootPath: string): void {
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

    const catCmd = process.platform === 'win32' ? 'type' : 'cat';
    const displayCmd = `${catCmd} "${tmpFile.replace(/\\/g, '\\\\')}"`;

    let terminal = vscode.window.activeTerminal;
    if (!terminal) {
      terminal = vscode.window.createTerminal({ name: 'GrepLogViewer', cwd: rootPath });
    }
    terminal.show();
    terminal.sendText(displayCmd);

    setTimeout(() => {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }, 10000);
  }
}
