// FilterController — 正则匹配引擎，首组匹配优先
import { RegexGroup, RegexExpression, FilterResult, LogicOperator } from '../types';

export class FilterController {
  /**
   * 对文档所有行执行过滤
   * @param lines 文档所有行文本
   * @param groups 正则组配置列表（按优先级排序）
   * @param startLine 开始匹配行号（1-based），未指定则从第 1 行开始
   * @param endLine 结束匹配行号（1-based），未指定则到最后一行为止
   * @returns 每行的过滤结果
   */
  filter(lines: string[], groups: RegexGroup[], startLine?: number, endLine?: number): FilterResult[] {
    // 计算实际扫描范围（转为 0-based）
    const scanStart = startLine !== undefined ? Math.max(0, startLine - 1) : 0;
    const scanEnd = endLine !== undefined ? Math.min(lines.length, endLine) : lines.length;

    // 初始化结果数组：所有行默认为未匹配
    const results: FilterResult[] = new Array(lines.length);
    for (let i = 0; i < lines.length; i++) {
      results[i] = { lineNumber: i, groupId: null, color: undefined };
    }

    const matchedLines = new Set<number>();

    // 仅在 [scanStart, scanEnd) 范围内匹配
    for (const group of groups) {
      // 跳过禁用的组
      if (group.enabled === false) { continue; }

      for (let i = scanStart; i < scanEnd; i++) {
        if (matchedLines.has(i)) { continue; }

        if (this.matchGroup(lines[i], group)) {
          results[i] = { lineNumber: i, groupId: group.id, color: group.color };
          matchedLines.add(i);
        }
      }
    }

    return results;
  }

  /**
   * 判定单行是否匹配指定正则组
   * 组内表达式按顺序计算，通过 operator 组合
   */
  matchGroup(line: string, group: RegexGroup): boolean {
    if (group.expressions.length === 0) { return false; }

    // 过滤出启用的表达式（enabled !== false）
    const enabledExprs = group.expressions.filter(e => e.enabled !== false);
    if (enabledExprs.length === 0) { return false; }

    const exprs = enabledExprs;
    let result = this.matchExpression(line, exprs[0]);

    for (let i = 1; i < exprs.length; i++) {
      const match = this.matchExpression(line, exprs[i]);
      switch (exprs[i].operator) {
        case LogicOperator.AND:
          result = result && match;
          break;
        case LogicOperator.OR:
          result = result || match;
          break;
        case LogicOperator.NOT:
          result = result && !match;
          break;
      }
    }

    return result;
  }

  /** 单行匹配单个正则表达式 */
  private matchExpression(line: string, expr: RegexExpression): boolean {
    try {
      const regex = new RegExp(expr.pattern, expr.flags);
      return regex.test(line);
    } catch {
      // 正则非法时视为不匹配
      return false;
    }
  }
}
