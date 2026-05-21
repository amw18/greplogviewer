// FilterController — 正则匹配引擎，首组匹配优先
import { RegexGroup, RegexExpression, FilterResult, LogicOperator } from '../types';

export class FilterController {
  /**
   * 对文档所有行执行过滤
   * @param lines 文档所有行文本
   * @param groups 正则组配置列表（按优先级排序）
   * @returns 每行的过滤结果
   */
  filter(lines: string[], groups: RegexGroup[]): FilterResult[] {
    // 初始化结果数组
    const results: FilterResult[] = new Array(lines.length);
    for (let i = 0; i < lines.length; i++) {
      results[i] = { lineNumber: i, groupId: null, color: undefined };
    }

    const matchedLines = new Set<number>();

    // 按组顺序匹配，首次匹配优先
    for (const group of groups) {
      for (let i = 0; i < lines.length; i++) {
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

    const exprs = group.expressions;
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
