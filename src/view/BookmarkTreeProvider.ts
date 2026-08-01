// BookmarkTreeProvider - 书签树视图数据源
import * as path from 'path';
import * as vscode from 'vscode';
import { BookmarkModel } from '../model/BookmarkModel';
import { Bookmark } from '../types';

/** 树节点类型 */
export type BookmarkNode = Bookmark | { type: 'file'; filePath: string; fileName: string };

export class BookmarkTreeProvider implements vscode.TreeDataProvider<BookmarkNode> {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private model: BookmarkModel) {
    model.onChange(() => this._onDidChange.fire());
  }

  getTreeItem(element: BookmarkNode): vscode.TreeItem {
    if ('type' in element) {
      // 文件根节点
      const item = new vscode.TreeItem(element.fileName, vscode.TreeItemCollapsibleState.Expanded);
      item.id = `file:${element.filePath}`;
      item.iconPath = vscode.ThemeIcon.File;
      item.contextValue = 'bookmark-file';
      item.resourceUri = vscode.Uri.file(element.filePath);
      return item;
    }

    // 书签节点
    const bm = element;
    const hasChildren = bm.children.length > 0;
    const item = new vscode.TreeItem(
      bm.label,
      hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
    );
    item.id = bm.id;
    item.description = `Line ${bm.line + 1}`;
    item.contextValue = hasChildren ? 'bookmark-with-children' : 'bookmark';
    item.tooltip = `${bm.label}\n${path.basename(bm.filePath)}:${bm.line + 1}`;

    // 使用颜色生成图标
    item.iconPath = this.makeColorIcon(bm.color);

    // 点击跳转
    item.command = {
      command: 'log-minus-minus.gotoBookmark',
      arguments: [bm.id],
      title: 'Go to Bookmark',
    };

    return item;
  }

  getChildren(element?: BookmarkNode): BookmarkNode[] {
    if (!element) {
      // 顶层：所有文件根
      return this.model.getAllFiles().map(fp => ({
        type: 'file' as const,
        filePath: fp,
        fileName: path.basename(fp),
      }));
    }

    if ('type' in element) {
      // 文件节点的子节点：该文件的顶层书签
      return this.model.getFileRoots(element.filePath)
        .map(id => this.model.getBookmark(id))
        .filter((b): b is Bookmark => !!b);
    }

    // 书签节点的子节点
    const bookmark = element as Bookmark;
    return bookmark.children
      .map(id => this.model.getBookmark(id))
      .filter((b): b is Bookmark => !!b);
  }

  /** 用颜色生成一个 SVG 图标 */
  private makeColorIcon(color: string): vscode.Uri {
    // 用 data URI 生成 SVG 圆点图标
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5" fill="${color}" stroke="#ffffff" stroke-width="1"/></svg>`;
    const encoded = Buffer.from(svg).toString('base64');
    return vscode.Uri.parse(`data:image/svg+xml;base64,${encoded}`);
  }
}
