// EditorStateModel — 管理编辑器与配置的绑定关系及持久化
import * as vscode from 'vscode';
import { RegexGroup } from '../types';

export class EditorStateModel {
  private configMap = new Map<string, RegexGroup[]>();
  private activeSet = new Set<string>();
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  /** 获取编辑器配置 */
  getConfig(editorId: string): RegexGroup[] | undefined {
    return this.configMap.get(editorId);
  }

  /** 设置编辑器配置并持久化 */
  setConfig(editorId: string, groups: RegexGroup[]): void {
    this.configMap.set(editorId, groups);
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
    this.configMap.delete(editorId);
    this.activeSet.delete(editorId);
  }

  /** 从 workspaceState 加载配置 */
  loadConfig(documentUri: string): RegexGroup[] | undefined {
    return this.context.workspaceState.get<RegexGroup[]>(`greplogviewer.config.${documentUri}`);
  }

  /** 持久化到 workspaceState */
  saveConfig(documentUri: string, groups: RegexGroup[]): void {
    this.context.workspaceState.update(`greplogviewer.config.${documentUri}`, groups);
  }
}
