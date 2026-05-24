// ConfigController — 配置操作的业务逻辑层
import { RegexGroup, RegexExpression, LogicOperator, EditorConfig } from '../types';
import { RegexGroupModel } from '../model/RegexGroupModel';
import { EditorStateModel } from '../model/EditorStateModel';

export class ConfigController {
  constructor(
    private regexGroupModel: RegexGroupModel,
    private editorStateModel: EditorStateModel
  ) {}

  /** 获取当前所有正则组 */
  getGroups(): RegexGroup[] {
    return this.regexGroupModel.getGroups();
  }

  /** 创建正则组 */
  createGroup(name: string, color: string): RegexGroup {
    return this.regexGroupModel.createGroup(name, color);
  }

  /** 删除正则组 */
  removeGroup(groupId: string): void {
    this.regexGroupModel.removeGroup(groupId);
  }

  /** 更新正则组 */
  updateGroup(groupId: string, updates: Partial<Pick<RegexGroup, 'name' | 'color'>>): void {
    this.regexGroupModel.updateGroup(groupId, updates);
  }

  /** 添加表达式 */
  addExpression(groupId: string, pattern: string, flags: string, operator: LogicOperator): RegexExpression | null {
    return this.regexGroupModel.addExpression(groupId, pattern, flags, operator);
  }

  /** 删除表达式 */
  removeExpression(groupId: string, expressionId: string): void {
    this.regexGroupModel.removeExpression(groupId, expressionId);
  }

  /** 更新表达式 */
  updateExpression(groupId: string, expressionId: string, updates: Partial<RegexExpression>): void {
    this.regexGroupModel.updateExpression(groupId, expressionId, updates);
  }

  /** 移动正则组到指定索引 */
  moveGroup(fromIndex: number, toIndex: number): void {
    this.regexGroupModel.moveGroup(fromIndex, toIndex);
  }

  /** 移动组内表达式到指定索引 */
  moveExpression(groupId: string, fromIndex: number, toIndex: number): void {
    this.regexGroupModel.moveExpression(groupId, fromIndex, toIndex);
  }

  /** 校验正则表达式合法性 */
  validatePattern(pattern: string, flags: string): { valid: boolean; error?: string } {
    return this.regexGroupModel.validatePattern(pattern, flags);
  }

  /** 加载持久化配置 */
  loadConfig(documentUri: string): EditorConfig | undefined {
    return this.editorStateModel.loadConfig(documentUri);
  }

  /** 保存配置到持久化存储 */
  saveConfig(documentUri: string, config: EditorConfig): void {
    this.editorStateModel.saveConfig(documentUri, config);
  }
}
