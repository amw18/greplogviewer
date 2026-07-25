// EditorStateModel — 管理编辑器与配置的绑定关系及持久化
import * as vscode from 'vscode';
import { RegexGroup, EditorConfig } from '../types';

export class EditorStateModel {
  private activeSet = new Set<string>();
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  /** 是否已激活过滤 */
  isActive(editorId: string): boolean {
    return this.activeSet.has(editorId);
  }

  /** 设置激活状态 */
  setActive(editorId: string, active: boolean): void {
    if (active) {
      this.activeSet.add(editorId);
    } else {
      this.activeSet.delete(editorId);
    }
  }

  /** 清除编辑器状态 */
  clearEditor(editorId: string): void {
    this.activeSet.delete(editorId);
  }

  /** 从 workspaceState 加载配置（兼容旧格式 RegexGroup[]） */
  loadConfig(documentUri: string): EditorConfig | undefined {
    const raw = this.context.workspaceState.get<EditorConfig | RegexGroup[]>(`log--.config.${documentUri}`);
    if (!raw) { return undefined; }
    // 兼容旧格式：旧版本存的是 RegexGroup[] 数组
    if (Array.isArray(raw)) {
      return { groups: raw };
    }
    return raw as EditorConfig;
  }

  /** 持久化到 workspaceState */
  saveConfig(documentUri: string, config: EditorConfig): void {
    this.context.workspaceState.update(`log--.config.${documentUri}`, config);
  }
}
