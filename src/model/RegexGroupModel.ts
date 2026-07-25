// RegexGroupModel — 正则组数据的增删改查
import { RegexGroup, RegexExpression, LogicOperator } from '../types';
import { uuid } from './uuid';

export class RegexGroupModel {
  private groups: RegexGroup[] = [];

  /** 获取所有正则组 */
  getGroups(): RegexGroup[] {
    return this.groups;
  }

  /** 设置正则组列表（用于加载持久化配置） */
  setGroups(groups: RegexGroup[]): void {
    this.groups = groups;
  }

  /** 创建正则组 */
  createGroup(name: string, color: string): RegexGroup {
    const group: RegexGroup = {
      id: uuid(),
      name,
      color,
      expressions: [],
      enabled: true,
    };
    this.groups.push(group);
    return group;
  }

  /** 删除正则组 */
  removeGroup(groupId: string): void {
    this.groups = this.groups.filter(g => g.id !== groupId);
  }

  /** 更新正则组信息 */
  updateGroup(groupId: string, updates: Partial<Pick<RegexGroup, 'name' | 'color'>>): void {
    const group = this.groups.find(g => g.id === groupId);
    if (group) {
      if (updates.name !== undefined) { group.name = updates.name; }
      if (updates.color !== undefined) { group.color = updates.color; }
    }
  }

  /** 向组内添加表达式 */
  addExpression(groupId: string, pattern: string, flags: string, operator: LogicOperator): RegexExpression | null {
    const group = this.groups.find(g => g.id === groupId);
    if (!group) { return null; }
    const expr: RegexExpression = {
      id: uuid(),
      pattern,
      flags,
      operator,
      enabled: true,
    };
    group.expressions.push(expr);
    return expr;
  }

  /** 删除组内表达式 */
  removeExpression(groupId: string, expressionId: string): void {
    const group = this.groups.find(g => g.id === groupId);
    if (group) {
      group.expressions = group.expressions.filter(e => e.id !== expressionId);
    }
  }

  /** 更新表达式 */
  updateExpression(groupId: string, expressionId: string, updates: Partial<RegexExpression>): void {
    const group = this.groups.find(g => g.id === groupId);
    if (group) {
      const expr = group.expressions.find(e => e.id === expressionId);
      if (expr) {
        Object.assign(expr, updates);
      }
    }
  }

  /** 移动正则组到指定索引 */
  moveGroup(fromIndex: number, toIndex: number): void {
    if (fromIndex < 0 || fromIndex >= this.groups.length) { return; }
    if (toIndex < 0 || toIndex >= this.groups.length) { return; }
    if (fromIndex === toIndex) { return; }
    const [item] = this.groups.splice(fromIndex, 1);
    this.groups.splice(toIndex, 0, item);
  }

  /** 移动组内表达式到指定索引 */
  moveExpression(groupId: string, fromIndex: number, toIndex: number): void {
    const group = this.groups.find(g => g.id === groupId);
    if (!group) { return; }
    if (fromIndex < 0 || fromIndex >= group.expressions.length) { return; }
    if (toIndex < 0 || toIndex >= group.expressions.length) { return; }
    if (fromIndex === toIndex) { return; }
    const [item] = group.expressions.splice(fromIndex, 1);
    group.expressions.splice(toIndex, 0, item);
  }

  /** 校验正则表达式合法性 */
  validatePattern(pattern: string, flags: string): { valid: boolean; error?: string } {
    try {
      new RegExp(pattern, flags);
      return { valid: true };
    } catch (e: any) {
      return { valid: false, error: e.message };
    }
  }
}
