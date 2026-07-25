// FilterController — 正则匹配引擎，首组匹配优先
import { RegexGroup, RegexExpression, FilterResult, LogicOperator } from '../types';

type CompiledGroup = { group: RegexGroup; exprs: { pattern: RegExp; operator: LogicOperator }[] };

export class FilterController {
  /**
   * 对文档所有行执行过滤（同步版本，适合中小文件）
   * @param lines 文档所有行文本
   * @param groups 正则组配置列表（按优先级排序）
   * @returns 每行的过滤结果
   */
  filter(lines: string[], groups: RegexGroup[]): FilterResult[] {
    const results: FilterResult[] = new Array(lines.length);
    for (let i = 0; i < lines.length; i++) {
      results[i] = { lineNumber: i, groupId: null, color: undefined };
    }

    const compiled = this.compileGroups(groups);
    if (compiled.length === 0) { return results; }

    const matchedLines = new Set<number>();
    for (const cg of compiled) {
      for (let i = 0; i < lines.length; i++) {
        if (matchedLines.has(i)) { continue; }
        if (this.matchGroupCompiled(lines[i], cg.exprs)) {
          results[i] = { lineNumber: i, groupId: cg.group.id, color: cg.group.color };
          matchedLines.add(i);
        }
      }
    }

    return results;
  }

  /**
   * 对文档所有行执行过滤（异步分块版本，避免大文件阻塞 UI）
   * @param lines 文档所有行文本
   * @param groups 正则组配置列表（按优先级排序）
   * @param onProgress 可选进度回调 (processed, total)
   * @param chunkSize 每次处理的行数
   * @returns 每行的过滤结果
   */
  async filterAsync(
    lines: string[],
    groups: RegexGroup[],
    onProgress?: (processed: number, total: number) => void,
    chunkSize = 50000
  ): Promise<FilterResult[]> {
    const results: FilterResult[] = new Array(lines.length);
    for (let i = 0; i < lines.length; i++) {
      results[i] = { lineNumber: i, groupId: null, color: undefined };
    }

    const compiled = this.compileGroups(groups);
    if (compiled.length === 0) { return results; }

    const matchedLines = new Set<number>();
    const totalChunks = Math.max(1, Math.ceil(lines.length / chunkSize));
    const shouldYield = chunkSize < lines.length;

    for (const cg of compiled) {
      for (let chunk = 0; chunk < totalChunks; chunk++) {
        const start = chunk * chunkSize;
        const end = Math.min(start + chunkSize, lines.length);
        for (let i = start; i < end; i++) {
          if (matchedLines.has(i)) { continue; }
          if (this.matchGroupCompiled(lines[i], cg.exprs)) {
            results[i] = { lineNumber: i, groupId: cg.group.id, color: cg.group.color };
            matchedLines.add(i);
          }
        }
        if (onProgress) {
          onProgress(Math.min(end, lines.length), lines.length);
        }
        if (shouldYield && chunk < totalChunks - 1) {
          await new Promise<void>(r => setImmediate(r));
        }
      }
    }

    return results;
  }

  private compileGroups(groups: RegexGroup[]): CompiledGroup[] {
    const compiled: CompiledGroup[] = [];
    for (const g of groups) {
      if (g.enabled === false) { continue; }
      const exprs = g.expressions.filter(e => e.enabled !== false);
      if (exprs.length === 0) { continue; }
      const compiledExprs: { pattern: RegExp; operator: LogicOperator }[] = [];
      for (const e of exprs) {
        try {
          compiledExprs.push({ pattern: new RegExp(e.pattern, e.flags), operator: e.operator });
        } catch { /* skip invalid regex */ }
      }
      if (compiledExprs.length > 0) {
        compiled.push({ group: g, exprs: compiledExprs });
      }
    }
    return compiled;
  }

  /** 用预编译的 regex 判定单行匹配（快速路径） */
  private matchGroupCompiled(line: string, exprs: { pattern: RegExp; operator: LogicOperator }[]): boolean {
    let result = exprs[0].pattern.test(line);
    for (let i = 1; i < exprs.length; i++) {
      const match = exprs[i].pattern.test(line);
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
