// EditorDecorations — 行颜色高亮装饰管理
import * as vscode from 'vscode';
import { FilterResult } from '../types';

export class EditorDecorations {
  private decorationTypes = new Map<string, vscode.TextEditorDecorationType>();
  /** 未匹配行装饰类型（降低透明度） */
  private dimDecoration: vscode.TextEditorDecorationType;
  private editor: vscode.TextEditor | undefined;

  constructor() {
    this.dimDecoration = vscode.window.createTextEditorDecorationType({
      opacity: '0.3',
    });
  }

  /**
   * 应用过滤结果到编辑器
   * - 匹配行：按组颜色高亮
   * - 未匹配行：降低透明度
   */
  apply(results: FilterResult[], editor: vscode.TextEditor): void {
    this.clear();
    this.editor = editor;

    // 按 groupId 分组匹配行
    const groupLines = new Map<string, vscode.Range[]>();
    const unmatchedLines: vscode.Range[] = [];

    for (const r of results) {
      if (r.groupId && r.color) {
        if (!groupLines.has(r.groupId)) {
          groupLines.set(r.groupId, []);
        }
        const range = editor.document.lineAt(r.lineNumber).range;
        groupLines.get(r.groupId)!.push(range);
      } else {
        const range = editor.document.lineAt(r.lineNumber).range;
        unmatchedLines.push(range);
      }
    }

    // 为每组创建对应颜色的装饰类型并应用
    for (const [groupId, ranges] of groupLines) {
      const result = results.find(r => r.groupId === groupId);
      const color = result?.color ?? '#ffffff';

      const key = `${groupId}_${color}`;
      if (!this.decorationTypes.has(key)) {
        this.decorationTypes.set(
          key,
          vscode.window.createTextEditorDecorationType({
            color,
            fontWeight: 'bold',
          })
        );
      }
      editor.setDecorations(this.decorationTypes.get(key)!, ranges);
    }

    // 未匹配行应用暗淡效果
    if (unmatchedLines.length > 0) {
      editor.setDecorations(this.dimDecoration, unmatchedLines);
    }
  }

  /** 清除所有装饰 */
  clear(): void {
    if (this.editor) {
      for (const dt of this.decorationTypes.values()) {
        this.editor.setDecorations(dt, []);
      }
      this.editor.setDecorations(this.dimDecoration, []);
    }
  }

  /** 刷新装饰（文档变更后重新绘制） */
  refresh(): void {
    // 装饰在重新 apply 时自动刷新
  }

  dispose(): void {
    this.clear();
    for (const dt of this.decorationTypes.values()) {
      dt.dispose();
    }
    this.decorationTypes.clear();
    this.dimDecoration.dispose();
  }
}
