// GrepController — 右键菜单 grep 关键字/函数跳转
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { ViewController } from './ViewController';

export class GrepController {
  constructor(
    private viewController: ViewController,
  ) {}

  /** Grep Keyword: grep -Rn "keyword" 在当前 terminal 路径 */
  async grepKeyword(): Promise<void> {
    const keyword = this.getSelectedText();
    if (!keyword) { return; }
    await this.runGrep(keyword);
  }

  /** Grep Function: 用 grep 搜索 keyword( 函数定义行 */
  async grepFunction(): Promise<void> {
    const keyword = this.getSelectedText();
    if (!keyword) { return; }
    await this.runGrepFunction(keyword);
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

  /** 执行 grep 并在 terminal 中显示结果（使用 workspace root 或当前终端路径） */
  private async runGrep(pattern: string): Promise<void> {
    const cwd = this.getSearchPath();
    if (!cwd) { return; }

    const safePattern = pattern.replace(/'/g, "'\\''");
    const sep = '>>>';
    let command = `echo "${sep}" && grep -Rn --color=always '${safePattern}' "${cwd}"`;
    const homeDir = os.homedir();
    if (cwd.startsWith(homeDir)) {
      command += ` | sed "s|^${homeDir}/|~\/|"`;
    }
    command += ` && echo "${sep}"`;

    let terminal = vscode.window.activeTerminal;
    if (!terminal) {
      terminal = vscode.window.createTerminal({ name: 'GrepLogViewer', cwd });
    }
    terminal.show();
    terminal.sendText(command);
  }

  /** 获取搜索根路径：当前终端 cwd 或 workspace root */
  private getSearchPath(): string | undefined {
    // 优先使用 workspace root
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
      return workspaceFolder.uri.fsPath;
    }
    vscode.window.showWarningMessage('GrepLogViewer: No workspace folder or terminal path available.');
    return undefined;
  }

  // ================================================================
  //  Grep Function — 纯 Node.js 跨平台实现
  // ================================================================

  /** 用 grep + Node.js 搜索多行函数定义 */
  private async runGrepFunction(keyword: string): Promise<void> {
    const rootPath = this.getSearchPath();
    if (!rootPath) { return; }

    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const kwPattern = `\\b${escaped}\\s*\\(`;
    // grep -Erl: 只输出文件名（ERE 模式，\( = 字面括号）
    const grepCmd = `grep -Erl '${kwPattern}' "${rootPath}"`;

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
      let closeCol = -1;

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

      // 检查 ) 之后到 { 之间是否只有空白和注释
      let foundBrace = false;
      let hasOtherCode = false;
      let braceLine = -1;
      let inBlockComment = false;

      scanLoop:
      for (let j = parenEnd; j < Math.min(parenEnd + 5, lines.length); j++) {
        const startCol = (j === parenEnd) ? closeCol + 1 : 0;
        for (let c = startCol; c < lines[j].length; c++) {
          if (inBlockComment) {
            if (lines[j][c] === '*' && c + 1 < lines[j].length && lines[j][c + 1] === '/') {
              inBlockComment = false;
              c++;
            }
            continue;
          }
          const ch = lines[j][c];
          if (ch === ' ' || ch === '\t' || ch === '\r') { continue; }
          if (ch === '/' && c + 1 < lines[j].length && lines[j][c + 1] === '/') {
            break;
          }
          if (ch === '/' && c + 1 < lines[j].length && lines[j][c + 1] === '*') {
            inBlockComment = true;
            c++;
            continue;
          }
          if (ch === '{') {
            foundBrace = true;
            braceLine = j;
            break scanLoop;
          }
          hasOtherCode = true;
          break scanLoop;
        }
      }

      if (!foundBrace || hasOtherCode) { continue; }

      results.push(`${displayPath}:${matchStart + 1}:${lines[matchStart]}`);
      i = braceLine >= 0 ? braceLine : parenEnd;
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
