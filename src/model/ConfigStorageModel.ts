// ConfigStorageModel — 管理命名配置预设，持久化到 workspaceState / globalState
import * as vscode from 'vscode';
import { EditorConfig, SavedConfigEntry, ConfigScope } from '../types';

export class ConfigStorageModel {
  private static WORKSPACE_KEY = 'greplogviewer.savedConfigs';
  private static USER_KEY = 'greplogviewer.userSavedConfigs';

  constructor(private context: vscode.ExtensionContext) {}

  /** 保存命名配置到指定 scope，已存在则覆盖（调用方应提前确认） */
  async save(name: string, config: EditorConfig, scope: ConfigScope): Promise<void> {
    const state = this.scopeState(scope);
    const key = this.scopeKey(scope);
    // 从存储读取当前列表（可能是同一个引用，我们创建新数组避免副作用）
    const current = state.get<SavedConfigEntry[]>(key) || [];
    const configs: SavedConfigEntry[] = [...current];
    const existingIdx = configs.findIndex(c => c.name === name);
    if (existingIdx >= 0) {
      configs[existingIdx] = { name, config };
    } else {
      configs.push({ name, config });
    }
    await state.update(key, configs);
  }

  /** 检查命名配置是否已存在 */
  exists(name: string, scope: ConfigScope): boolean {
    const configs = this.readAll(scope);
    return configs.some(c => c.name === name);
  }

  /** 获取指定命名配置 */
  get(name: string, scope: ConfigScope): SavedConfigEntry | undefined {
    return this.readAll(scope).find(c => c.name === name);
  }

  /** 列出指定 scope 下的所有命名配置名称 */
  list(scope: ConfigScope): string[] {
    return this.readAll(scope).map(c => c.name);
  }

  /** 列出所有 scope 下的命名配置 */
  listAll(): { name: string; scope: ConfigScope }[] {
    const result: { name: string; scope: ConfigScope }[] = [];
    for (const name of this.list('workspace')) {
      result.push({ name, scope: 'workspace' });
    }
    for (const name of this.list('user')) {
      result.push({ name, scope: 'user' });
    }
    return result;
  }

  /** 删除指定命名配置，返回是否成功 */
  async delete(name: string, scope: ConfigScope): Promise<boolean> {
    const state = this.scopeState(scope);
    const key = this.scopeKey(scope);
    const current = state.get<SavedConfigEntry[]>(key) || [];
    const configs: SavedConfigEntry[] = current.filter(c => c.name !== name);
    if (configs.length === current.length) {
      return false; // 未找到，未做任何删除
    }
    await state.update(key, configs);
    return true;
  }

  private readAll(scope: ConfigScope): SavedConfigEntry[] {
    return this.scopeState(scope).get<SavedConfigEntry[]>(this.scopeKey(scope)) || [];
  }

  private scopeKey(scope: ConfigScope): string {
    return scope === 'workspace' ? ConfigStorageModel.WORKSPACE_KEY : ConfigStorageModel.USER_KEY;
  }

  private scopeState(scope: ConfigScope): vscode.Memento {
    return scope === 'workspace' ? this.context.workspaceState : this.context.globalState;
  }
}
