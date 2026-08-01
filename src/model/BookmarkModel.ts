// BookmarkModel - 全局书签存储，支持树形嵌套，持久化到 globalState
import * as path from 'path';
import * as vscode from 'vscode';
import { Bookmark } from '../types';
import { uuid } from './uuid';
import { log } from './Logger';

const STORAGE_KEY = 'log--.bookmarks';

interface StoredData {
  bookmarks: Record<string, Bookmark>;
  /** filePath -> 顶层书签 ID 列表 */
  fileRoots: Record<string, string[]>;
}

export class BookmarkModel {
  private bookmarks = new Map<string, Bookmark>();
  private fileRoots = new Map<string, string[]>();
  private _onChange = new vscode.EventEmitter<void>();
  readonly onChange = this._onChange.event;

  constructor(private context: vscode.ExtensionContext) {
    this.load();
  }

  private load(): void {
    const data = this.context.globalState.get<StoredData>(STORAGE_KEY);
    if (!data) { return; }
    for (const [id, bm] of Object.entries(data.bookmarks)) {
      this.bookmarks.set(id, bm);
    }
    for (const [fp, ids] of Object.entries(data.fileRoots)) {
      this.fileRoots.set(fp, ids);
    }
  }

  private save(): void {
    const data: StoredData = {
      bookmarks: Object.fromEntries(this.bookmarks),
      fileRoots: Object.fromEntries(this.fileRoots),
    };
    this.context.globalState.update(STORAGE_KEY, data);
    this._onChange.fire();
  }

  /** 添加书签；返回创建的书签 */
  addBookmark(filePath: string, line: number, label: string, color: string, parentId: string | null): Bookmark {
    const bm: Bookmark = {
      id: uuid(),
      label,
      filePath,
      line,
      color,
      parentId,
      children: [],
    };
    this.bookmarks.set(bm.id, bm);

    if (parentId) {
      const parent = this.bookmarks.get(parentId);
      if (parent) {
        parent.children.push(bm.id);
      }
    } else {
      const roots = this.fileRoots.get(filePath) || [];
      roots.push(bm.id);
      this.fileRoots.set(filePath, roots);
    }

    log(`Bookmark added: "${label}" at ${path.basename(filePath)}:${line + 1}`);
    this.save();
    return bm;
  }

  /** 删除书签（含子书签） */
  deleteBookmark(id: string): void {
    const bm = this.bookmarks.get(id);
    if (!bm) { return; }

    // 递归删除子书签
    for (const childId of [...bm.children]) {
      this.deleteBookmark(childId);
    }

    // 从父节点移除引用
    if (bm.parentId) {
      const parent = this.bookmarks.get(bm.parentId);
      if (parent) {
        parent.children = parent.children.filter(c => c !== id);
      }
    } else {
      const roots = this.fileRoots.get(bm.filePath);
      if (roots) {
        this.fileRoots.set(bm.filePath, roots.filter(r => r !== id));
        if (this.fileRoots.get(bm.filePath)!.length === 0) {
          this.fileRoots.delete(bm.filePath);
        }
      }
    }

    this.bookmarks.delete(id);
    log(`Bookmark deleted: "${bm.label}"`);
    this.save();
  }

  /** 删除书签但保留子书签（子书签提升到同层） */
  deleteBookmarkKeepChildren(id: string): void {
    const bm = this.bookmarks.get(id);
    if (!bm) { return; }

    // 子书签提升
    for (const childId of [...bm.children]) {
      const child = this.bookmarks.get(childId);
      if (child) {
        child.parentId = bm.parentId;
        if (bm.parentId) {
          const parent = this.bookmarks.get(bm.parentId);
          if (parent) { parent.children.push(childId); }
        } else {
          const roots = this.fileRoots.get(bm.filePath) || [];
          roots.push(childId);
          this.fileRoots.set(bm.filePath, roots);
        }
      }
    }

    // 从父节点移除被删书签引用
    if (bm.parentId) {
      const parent = this.bookmarks.get(bm.parentId);
      if (parent) {
        parent.children = parent.children.filter(c => c !== id);
      }
    } else {
      const roots = this.fileRoots.get(bm.filePath);
      if (roots) {
        this.fileRoots.set(bm.filePath, roots.filter(r => r !== id));
        if (this.fileRoots.get(bm.filePath)!.length === 0) {
          this.fileRoots.delete(bm.filePath);
        }
      }
    }

    this.bookmarks.delete(id);
    log(`Bookmark deleted (children kept): "${bm.label}"`);
    this.save();
  }

  /** 更新书签标注 */
  updateLabel(id: string, label: string): void {
    const bm = this.bookmarks.get(id);
    if (!bm) { return; }
    bm.label = label;
    this.save();
  }

  /** 更新书签颜色 */
  updateColor(id: string, color: string): void {
    const bm = this.bookmarks.get(id);
    if (!bm) { return; }
    bm.color = color;
    this.save();
  }

  /** 移动书签到新父节点下（parentId=null 表示移到文件根层）
   *  注意：filePath 始终指向书签原始文件，不随移动改变 */
  moveBookmark(id: string, newParentId: string | null): void {
    const bm = this.bookmarks.get(id);
    if (!bm) { return; }
    if (id === newParentId) { return; }
    if (newParentId && this.isDescendant(newParentId, id)) { return; }

    this.removeFromParent(id);
    bm.parentId = newParentId;

    if (newParentId) {
      const parent = this.bookmarks.get(newParentId);
      if (parent) { parent.children.push(id); }
    } else {
      const roots = this.fileRoots.get(bm.filePath) || [];
      roots.push(id);
      this.fileRoots.set(bm.filePath, roots);
    }
    this.save();
  }

  /** 拖拽移动：asChild=true 作为目标子书签，否则插入到目标后面同级 */
  moveBookmarkRelative(id: string, targetId: string, asChild: boolean): void {
    const bm = this.bookmarks.get(id);
    const target = this.bookmarks.get(targetId);
    if (!bm || !target) { return; }
    if (id === targetId) { return; }
    if (this.isDescendant(targetId, id)) { return; }

    this.removeFromParent(id);

    if (asChild) {
      bm.parentId = targetId;
      target.children.push(id);
    } else {
      bm.parentId = target.parentId;
      if (target.parentId) {
        const parent = this.bookmarks.get(target.parentId);
        if (parent) {
          const idx = parent.children.indexOf(targetId);
          parent.children.splice(idx + 1, 0, id);
        }
      } else {
        const roots = this.fileRoots.get(target.filePath) || [];
        const idx = roots.indexOf(targetId);
        roots.splice(idx + 1, 0, id);
        this.fileRoots.set(target.filePath, roots);
      }
    }
    this.save();
  }

  /** 从父节点移除书签引用（不删除书签本身） */
  private removeFromParent(id: string): void {
    const bm = this.bookmarks.get(id);
    if (!bm) { return; }
    if (bm.parentId) {
      const parent = this.bookmarks.get(bm.parentId);
      if (parent) {
        parent.children = parent.children.filter(c => c !== id);
      }
    } else {
      const roots = this.fileRoots.get(bm.filePath);
      if (roots) {
        this.fileRoots.set(bm.filePath, roots.filter(r => r !== id));
        if (this.fileRoots.get(bm.filePath)!.length === 0) {
          this.fileRoots.delete(bm.filePath);
        }
      }
    }
  }

  /** 检查 candidateId 是否是 ancestorId 的后代 */
  private isDescendant(candidateId: string, ancestorId: string): boolean {
    const candidate = this.bookmarks.get(candidateId);
    if (!candidate || !candidate.parentId) { return false; }
    if (candidate.parentId === ancestorId) { return true; }
    return this.isDescendant(candidate.parentId, ancestorId);
  }

  /** 获取指定文件的所有顶层书签 ID */
  getFileRoots(filePath: string): string[] {
    return this.fileRoots.get(filePath) || [];
  }

  /** 获取所有有书签的文件路径 */
  getAllFiles(): string[] {
    return Array.from(this.fileRoots.keys());
  }

  /** 获取书签 */
  getBookmark(id: string): Bookmark | undefined {
    return this.bookmarks.get(id);
  }

  /** 获取指定文件的所有书签（含子书签） */
  getBookmarksForFile(filePath: string): Bookmark[] {
    const result: Bookmark[] = [];
    const collect = (ids: string[]) => {
      for (const id of ids) {
        const bm = this.bookmarks.get(id);
        if (bm) {
          result.push(bm);
          collect(bm.children);
        }
      }
    };
    collect(this.fileRoots.get(filePath) || []);
    return result;
  }

  /** 行号变化时更新书签行号 */
  updateLineNumbers(filePath: string, lineDeltas: Map<number, number>): void {
    // TODO: 处理文档编辑导致行号变化的情况
  }
}
