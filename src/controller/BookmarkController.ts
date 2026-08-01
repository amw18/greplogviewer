// BookmarkController - 书签 CRUD + editor gutter 图标
import * as path from 'path';
import * as vscode from 'vscode';
import { BookmarkModel } from '../model/BookmarkModel';
import { Bookmark } from '../types';
import { log } from '../model/Logger';

const DEFAULT_COLOR = '#4488ff';

export class BookmarkController {
  private gutterDecoration: vscode.TextEditorDecorationType;
  /** editorId -> color -> decorationType（按颜色区分 gutter icon） */
  private colorDecorations = new Map<string, vscode.TextEditorDecorationType>();

  constructor(
    private model: BookmarkModel,
    private getGroupColorForLine?: (filePath: string, line: number) => string | undefined,
  ) {
    // 默认蓝色 gutter 图标
    this.gutterDecoration = vscode.window.createTextEditorDecorationType({
      gutterIconPath: this.makeGutterIconUri(DEFAULT_COLOR),
      gutterIconSize: 'cover',
    });

    // 编辑器切换/内容变化时刷新 gutter
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor) { this.refreshGutter(editor); }
    });
    model.onChange(() => {
      for (const editor of vscode.window.visibleTextEditors) {
        this.refreshGutter(editor);
      }
    });
  }

  /** 删除光标所在行的书签（右键菜单入口） */
  async deleteBookmarkAtCursor(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }
    const filePath = editor.document.uri.fsPath;
    const line = editor.selection.active.line;
    const bookmarks = this.model.getBookmarksForFile(filePath);
    const bm = bookmarks.find(b => b.line === line);
    if (!bm) {
      vscode.window.showInformationMessage('Log--: No bookmark at current line.');
      return;
    }
    await this.deleteBookmark(bm.id);
  }

  /** 添加书签（右键菜单入口） */
  async addBookmark(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    const line = editor.selection.active.line;
    const filePath = editor.document.uri.fsPath;
    const lineText = editor.document.lineAt(line).text.trim();

    // 提示输入标注
    const label = await vscode.window.showInputBox({
      prompt: 'Bookmark label (Enter to use line content)',
      value: '',
      placeHolder: lineText.slice(0, 80) || 'Bookmark',
    });

    // 用户取消
    if (label === undefined) { return; }
    const finalLabel = label.trim() || lineText.slice(0, 100) || `Line ${line + 1}`;

    // 确定颜色：当前行匹配的 group 颜色，否则默认蓝
    const groupColor = this.getGroupColorForLine?.(filePath, line);
    const color = groupColor || DEFAULT_COLOR;

    this.model.addBookmark(filePath, line, finalLabel, color, null);
    this.refreshGutter(editor);
    vscode.window.showInformationMessage(`Log--: Bookmark added: "${finalLabel}"`);
  }

  /** 跳转到书签 */
  async gotoBookmark(bookmarkId: string): Promise<void> {
    const bm = this.model.getBookmark(bookmarkId);
    if (!bm) { return; }

    const uri = vscode.Uri.file(bm.filePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc);
    const pos = new vscode.Position(bm.line, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  }

  /** 修改标注 */
  async editLabel(bookmarkId: string): Promise<void> {
    const bm = this.model.getBookmark(bookmarkId);
    if (!bm) { return; }
    const newLabel = await vscode.window.showInputBox({
      prompt: 'Edit bookmark label',
      value: bm.label,
    });
    if (newLabel === undefined) { return; }
    this.model.updateLabel(bookmarkId, newLabel.trim() || bm.label);
  }

  /** 修改颜色 */
  async editColor(bookmarkId: string): Promise<void> {
    const bm = this.model.getBookmark(bookmarkId);
    if (!bm) { return; }
    const color = await vscode.window.showInputBox({
      prompt: 'Bookmark color (hex)',
      value: bm.color,
    });
    if (color === undefined) { return; }
    this.model.updateColor(bookmarkId, color.trim() || bm.color);
  }

  /** 删除书签（有子书签时提示） */
  async deleteBookmark(bookmarkId: string): Promise<void> {
    const bm = this.model.getBookmark(bookmarkId);
    if (!bm) { return; }

    if (bm.children.length > 0) {
      const choice = await vscode.window.showInformationMessage(
        `Bookmark "${bm.label}" has ${bm.children.length} sub-bookmark(s).`,
        'Delete all',
        'Move children up',
        'Cancel'
      );
      if (choice === 'Delete all') {
        this.model.deleteBookmark(bookmarkId);
      } else if (choice === 'Move children up') {
        this.model.deleteBookmarkKeepChildren(bookmarkId);
      }
    } else {
      this.model.deleteBookmark(bookmarkId);
    }
  }

  /** 移动书签到另一个书签下 */
  async moveBookmark(bookmarkId: string): Promise<void> {
    const bm = this.model.getBookmark(bookmarkId);
    if (!bm) { return; }

    // 列出所有可用的目标书签（排除自己和后代）
    const allBookmarks: { id: string; label: string; filePath: string }[] = [];
    for (const fp of this.model.getAllFiles()) {
      for (const b of this.model.getBookmarksForFile(fp)) {
        if (b.id !== bookmarkId && !this.isDescendant(b.id, bookmarkId)) {
          allBookmarks.push({ id: b.id, label: b.label, filePath: fp });
        }
      }
    }

    if (allBookmarks.length === 0) {
      vscode.window.showInformationMessage('Log--: No other bookmarks to move under.');
      return;
    }

    const items = allBookmarks.map(b => ({
      label: b.label,
      description: path.basename(b.filePath),
      targetId: b.id,
    }));
    items.push({ label: 'Move to file root', description: '', targetId: '' });

    const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Move bookmark under...' });
    if (!picked) { return; }

    if (picked.targetId === '') {
      this.model.moveBookmark(bookmarkId, null);
    } else {
      const target = this.model.getBookmark(picked.targetId);
      this.model.moveBookmark(bookmarkId, picked.targetId, target?.filePath);
    }
  }

  private isDescendant(candidateId: string, ancestorId: string): boolean {
    const candidate = this.model.getBookmark(candidateId);
    if (!candidate || !candidate.parentId) { return false; }
    if (candidate.parentId === ancestorId) { return true; }
    return this.isDescendant(candidate.parentId, ancestorId);
  }

  /** 刷新编辑器 gutter 图标 */
  refreshGutter(editor: vscode.TextEditor): void {
    const filePath = editor.document.uri.fsPath;
    const bookmarks = this.model.getBookmarksForFile(filePath);
    if (bookmarks.length === 0) {
      editor.setDecorations(this.gutterDecoration, []);
      return;
    }

    // 按颜色分组
    const byColor = new Map<string, vscode.Range[]>();
    for (const bm of bookmarks) {
      const ranges = byColor.get(bm.color) || [];
      ranges.push(new vscode.Range(bm.line, 0, bm.line, 0));
      byColor.set(bm.color, ranges);
    }

    // 先清除所有旧的颜色装饰
    for (const [, deco] of this.colorDecorations) {
      editor.setDecorations(deco, []);
    }

    // 应用每个颜色的装饰
    for (const [color, ranges] of byColor) {
      let deco = this.colorDecorations.get(color);
      if (!deco) {
        deco = vscode.window.createTextEditorDecorationType({
          gutterIconPath: this.makeGutterIconUri(color),
          gutterIconSize: 'cover',
        });
        this.colorDecorations.set(color, deco);
      }
      editor.setDecorations(deco, ranges);
    }
  }

  /** 生成 gutter 图标的 SVG data URI */
  private makeGutterIconUri(color: string): vscode.Uri {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path d="M4 1 L12 1 L12 15 L8 12 L4 15 Z" fill="${color}" stroke="#333" stroke-width="0.5"/></svg>`;
    const encoded = Buffer.from(svg).toString('base64');
    return vscode.Uri.parse(`data:image/svg+xml;base64,${encoded}`);
  }

  dispose(): void {
    this.gutterDecoration.dispose();
    for (const [, deco] of this.colorDecorations) {
      deco.dispose();
    }
  }
}
