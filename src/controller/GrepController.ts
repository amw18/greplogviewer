// GrepController — 右键菜单 grep 关键字/函数跳转到关联代码目录
import * as vscode from 'vscode';
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

  /** Grep Function: grep -Rn -A 20 "keyword\s*\(" dirs（-A 捕获跨行定义） */
  async grepFunction(): Promise<void> {
    const keyword = this.getSelectedText();
    if (!keyword) { return; }
    // 匹配函数定义：keyword 后紧跟可选的空白和左括号，-A 20 显示后续 20 行以捕获跨行参数
    await this.runGrep(`${this.escapeRegex(keyword)}\\s*\\(`, 20);
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
   * 环境变量 ${VAR}/$VAR 保留原样由 shell 展开。
   * 以 ! 开头的路径为排除项（取 basename 用于 --exclude-dir）。
   */
  private parseDirs(raw: string): ParsedDirs {
    const includes: string[] = [];
    const excludes: string[] = [];

    for (let part of raw.split(';')) {
      part = part.trim();
      if (part.length === 0) { continue; }

      if (part.startsWith('!')) {
        const ex = part.slice(1).trim();
        if (ex.length > 0) {
          // 保留原始变量引用，shell 会展开 ${VAR}
          excludes.push(ex);
        }
      } else {
        includes.push(part);
      }
    }

    return { includes, excludes };
  }

  /** 转义 grep 正则特殊字符 */
  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  private async runGrep(pattern: string, contextAfter?: number): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showWarningMessage('GrepLogViewer: No workspace folder open.');
      return;
    }

    const rootPath = workspaceFolder.uri.fsPath;
    const { includes, excludes } = this.getParsedDirs();

    // 搜索目录使用相对路径（terminal cwd = rootPath）
    const searchPaths = includes.length > 0
      ? includes.map(d => `"${d}"`)
      : [`"."`];

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
    const contextFlag = contextAfter ? `-A ${contextAfter} ` : '';
    const command = `${prefix}echo "${sep}" && grep -Rn --color=always ${contextFlag}${excludeFlags} '${safePattern}' ${searchPaths.join(' ')} && echo "${sep}"`;

    let terminal = vscode.window.activeTerminal;
    if (!terminal) {
      terminal = vscode.window.createTerminal({ name: 'GrepLogViewer', cwd: rootPath });
    }
    terminal.show();
    terminal.sendText(command);
  }
}
