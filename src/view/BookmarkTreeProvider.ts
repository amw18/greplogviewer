// BookmarkTreeProvider - 书签树视图数据源 + 拖拽支持
import * as path from 'path';
import * as vscode from 'vscode';
import { BookmarkModel } from '../model/BookmarkModel';
import { Bookmark } from '../types';

const MIME_TYPE = 'application/vnd.log--.bookmark';

/** 树节点类型 */
export type BookmarkNode = Bookmark | { type: 'file'; filePath: string; fileName: string };

function isFileNode(node: BookmarkNode): node is { type: 'file'; filePath: string; fileName: string } {
  return typeof node === 'object' && 'type' in node;
}

export class BookmarkTreeProvider implements vscode.TreeDataProvider<BookmarkNode> {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private model: BookmarkModel) {
    model.onChange(() => this._onDidChange.fire());
  }

  getTreeItem(element: BookmarkNode): vscode.TreeItem {
    if (isFileNode(element)) {
      const item = new vscode.TreeItem(element.fileName, vscode.TreeItemCollapsibleState.Expanded);
      item.id = `file:${element.filePath}`;
      item.iconPath = vscode.ThemeIcon.File;
      item.contextValue = 'bookmark-file';
      item.resourceUri = vscode.Uri.file(element.filePath);
      return item;
    }

    const bm = element;
    const hasChildren = bm.children.length > 0;
    const item = new vscode.TreeItem(
      bm.label,
      hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
    );
    item.id = bm.id;
    item.description = `Line ${bm.line + 1}`;
    item.contextValue = hasChildren ? 'bookmark-with-children' : 'bookmark';

    // 跨文件书签：tooltip 显示原始文件名
    const isCrossFile = this.isCrossFile(bm);
    const fileTip = isCrossFile ? ` [${path.basename(bm.filePath)}]` : '';
    item.tooltip = `${bm.label}${fileTip}\n${path.basename(bm.filePath)}:${bm.line + 1}`;

    item.iconPath = this.makeColorIcon(bm.color);

    return item;
  }

  /** 判断书签是否显示在非原始文件的树下（跨文件嵌套） */
  private isCrossFile(bm: Bookmark): boolean {
    return bm.treeFilePath !== bm.filePath;
  }

  getChildren(element?: BookmarkNode): BookmarkNode[] {
    if (!element) {
      return this.model.getAllFiles().map(fp => ({
        type: 'file' as const,
        filePath: fp,
        fileName: path.basename(fp),
      }));
    }

    if (isFileNode(element)) {
      return this.model.getFileRoots(element.filePath)
        .map(id => this.model.getBookmark(id))
        .filter((b): b is Bookmark => !!b);
    }

    const bookmark = element as Bookmark;
    return bookmark.children
      .map(id => this.model.getBookmark(id))
      .filter((b): b is Bookmark => !!b);
  }

  /** 用颜色生成 SVG 图标 */
  private makeColorIcon(color: string): vscode.Uri {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path d="M4 1 L12 1 L12 15 L8 12 L4 15 Z" fill="${color}" stroke="#333" stroke-width="0.5"/></svg>`;
    return vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
  }
}

/** 拖拽控制器：普通拖拽=同级后插，Ctrl+拖拽=子书签 */
export class BookmarkDragAndDrop implements vscode.TreeDragAndDropController<BookmarkNode> {
  readonly dragMimeTypes = [MIME_TYPE];
  readonly dropMimeTypes = [MIME_TYPE];

  constructor(private model: BookmarkModel) {}

  handleDrag(source: readonly BookmarkNode[], dataTransfer: vscode.DataTransfer): void {
    const ids = source.filter(s => !isFileNode(s)).map(s => (s as Bookmark).id);
    if (ids.length > 0) {
      dataTransfer.set(MIME_TYPE, new vscode.DataTransferItem(ids));
    }
  }

  async handleDrop(target: BookmarkNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const item = dataTransfer.get(MIME_TYPE);
    if (!item) { return; }
    const ids = item.value as string[];
    if (!Array.isArray(ids) || ids.length === 0) { return; }

    if (!target || isFileNode(target)) {
      // 拖到文件根或空白：移到文件顶层
      for (const id of ids) {
        const bm = this.model.getBookmark(id);
        if (bm) {
          this.model.moveBookmark(id, null);
        }
      }
      return;
    }

    const targetBm = target as Bookmark;
    // VS Code API 不支持修饰键检测，默认拖拽=同级后插
    // 子书签操作用右键菜单 Move Under...
    for (const id of ids) {
      this.model.moveBookmarkRelative(id, targetBm.id, false);
    }
  }
}
