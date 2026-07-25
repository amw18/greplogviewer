// ConfigStorageModel - 管理命名配置预设，持久化到 workspaceState / globalState / 文件
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EditorConfig, SavedConfigEntry, ConfigScope } from '../types';

export class ConfigStorageModel {
  private static WORKSPACE_KEY = 'log-minus-minus.savedConfigs';
  private static USER_KEY = 'log-minus-minus.userSavedConfigs';

  /** agent 写入配置的共享目录 */
  private static FILE_CONFIG_DIR = path.join(os.homedir(), '.agents', 'log-configs');

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
    for (const name of this.list('file')) {
      result.push({ name, scope: 'file' });
    }
    return result;
  }

  /** 删除指定命名配置，返回是否成功 */
  async delete(name: string, scope: ConfigScope): Promise<boolean> {
    if (scope === 'file') {
      const filePath = path.join(ConfigStorageModel.FILE_CONFIG_DIR, `${name}.json`);
      try {
        fs.unlinkSync(filePath);
        return true;
      } catch {
        return false;
      }
    }
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
    if (scope === 'file') {
      return this.readFileConfigs();
    }
    return this.scopeState(scope).get<SavedConfigEntry[]>(this.scopeKey(scope)) || [];
  }

  /** 扫描 ~/.agents/log-configs/ 目录下的 JSON 配置文件 */
  private readFileConfigs(): SavedConfigEntry[] {
    const dir = ConfigStorageModel.FILE_CONFIG_DIR;
    try {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      const configs: SavedConfigEntry[] = [];
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(dir, file), 'utf-8');
          const config = JSON.parse(content) as EditorConfig;
          const name = file.replace(/\.json$/, '');
          // 基本校验：必须有 groups 字段
          if (config && Array.isArray(config.groups)) {
            configs.push({ name, config });
          }
        } catch { /* 跳过无效文件 */ }
      }
      return configs;
    } catch {
      return []; // 目录不存在
    }
  }

  private scopeKey(scope: ConfigScope): string {
    return scope === 'workspace' ? ConfigStorageModel.WORKSPACE_KEY : ConfigStorageModel.USER_KEY;
  }

  private scopeState(scope: ConfigScope): vscode.Memento {
    return scope === 'workspace' ? this.context.workspaceState : this.context.globalState;
  }
}
