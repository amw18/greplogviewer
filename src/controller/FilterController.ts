// FilterController — 正则匹配引擎，首组匹配优先
import { RegexGroup, RegexExpression, FilterResult, LogicOperator } from '../types';

export class FilterController {
  /**
   * 对文档所有行执行过滤
   * @param lines 文档所有行文本
   * @param groups 正则组配置列表（按优先级排序）
   * @param startPattern 开始行正则，第一个匹配行作为范围起始。未指定则从第 1 行开始
   * @param endPattern 结束行正则，第一个匹配行作为范围结束。未指定则到最后一行为止
   * @returns 每行的过滤结果
   */
  filter(lines: string[], groups: RegexGroup[], startPattern?: string, endPattern?: string): FilterResult[] {
    // 通过正则匹配找到起始/结束行号（转为 0-based）
    const scanStart = startPattern !== undefined ? this.findFirstMatchLine(lines, startPattern) : 0;
    const scanEnd = endPattern !== undefined ? this.findFirstMatchLine(lines, endPattern, lines.length) : lines.length;

    // 如果起始行在结束行之后，范围为空
    if (scanStart >= scanEnd) {
      return lines.map((_, i) => ({ lineNumber: i, groupId: null, color: undefined }));
    }

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

  /**
   * 在 lines 中查找第一个匹配 pattern 的行号（0-based）。
   * @param lines 所有行
   * @param pattern 正则表达式字符串
   * @param fallback 未匹配时返回的默认值（默认 0 表示从第一行开始）
   */
  findFirstMatchLine(lines: string[], pattern: string, fallback: number = 0): number {
    if (!pattern) { return fallback; }
    try {
      const regex = new RegExp(pattern);
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          return i;
        }
      }
    } catch {
      // 正则非法时使用 fallback
    }
    return fallback;
  }
}
