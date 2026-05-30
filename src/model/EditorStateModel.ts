// EditorStateModel — 管理编辑器与配置的绑定关系及持久化
import * as vscode from 'vscode';
import { RegexGroup, EditorConfig } from '../types';

export class EditorStateModel {
  private configMap = new Map<string, RegexGroup[]>();
  private activeSet = new Set<string>();
  private context: vscode.ExtensionContext;
  /** 编辑器级别的行范围配置 */
  private lineRangeMap = new Map<string, { startPattern?: string; endPattern?: string }>();

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

  /** 获取行范围配置 */
  getLineRange(editorId: string): { startPattern?: string; endPattern?: string } {
    return this.lineRangeMap.get(editorId) || {};
  }

  /** 设置行范围配置 */
  setLineRange(editorId: string, startPattern?: string, endPattern?: string): void {
    this.lineRangeMap.set(editorId, { startPattern, endPattern });
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
    this.lineRangeMap.delete(editorId);
    this.activeSet.delete(editorId);
  }

  /** 从 workspaceState 加载配置（兼容旧格式 RegexGroup[]） */
  loadConfig(documentUri: string): EditorConfig | undefined {
    const raw = this.context.workspaceState.get<EditorConfig | RegexGroup[]>(`greplogviewer.config.${documentUri}`);
    if (!raw) { return undefined; }
    // 兼容旧格式：旧版本存的是 RegexGroup[] 数组
    if (Array.isArray(raw)) {
      return { groups: raw };
    }
    return raw as EditorConfig;
  }

  /** 持久化到 workspaceState */
  saveConfig(documentUri: string, config: EditorConfig): void {
    this.context.workspaceState.update(`greplogviewer.config.${documentUri}`, config);
  }
}
