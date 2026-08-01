// FilterResultModel — 存储和管理过滤匹配结果
import { FilterResult } from '../types';

export class FilterResultModel {
  private resultsMap = new Map<string, FilterResult[]>();
  private protectedLinesMap = new Map<string, Set<number>>();
  private changeListeners: Array<() => void> = [];

  /** 注册变更监听（供 extension.ts 绑定 vscode.EventEmitter），返回可释放句柄 */
  onChange(listener: () => void): { dispose(): void } {
    this.changeListeners.push(listener);
    return {
      dispose: () => {
        const idx = this.changeListeners.indexOf(listener);
        if (idx >= 0) { this.changeListeners.splice(idx, 1); }
      }
    };
  }

  /**
   * 设置需要保留不被折叠的行号集合（例如 ring buffer 起点行）。
   * 这些行在计算未匹配区间时会被排除。
   */
  setProtectedLines(editorId: string, lines: Set<number>): void {
    this.protectedLinesMap.set(editorId, new Set(lines));
  }

  /** 清除某编辑器的受保护行 */
  clearProtectedLines(editorId: string): void {
    this.protectedLinesMap.delete(editorId);
  }

  /** 设置过滤结果 */
  setResults(editorId: string, results: FilterResult[]): void {
    this.resultsMap.set(editorId, results);
    this.fireChange();
  }

  /**
   * 设置空结果（表示文件已被过滤但无折叠区间）。
   * 与 clearResults 不同：空结果会让 FoldingRangeProvider 返回 []，
   * 强制 VS Code 移除该文件上由本插件提供的折叠，而不是回退到默认折叠。
   */
  setEmptyResults(editorId: string): void {
    this.resultsMap.set(editorId, []);
    this.fireChange();
  }

  /** 获取过滤结果 */
  getResults(editorId: string): FilterResult[] | undefined {
    return this.resultsMap.get(editorId);
  }

  /** 获取匹配的行号列表 */
  getMatchedLines(editorId: string): number[] {
    const results = this.resultsMap.get(editorId);
    if (!results) { return []; }
    return results.filter(r => r.groupId !== null).map(r => r.lineNumber);
  }

  /** 获取未匹配的连续行区间（用于折叠） */
  getUnmatchedRanges(editorId: string): Array<{ start: number; end: number }> {
    const results = this.resultsMap.get(editorId);
    if (!results || results.length === 0) { return []; }

    const protectedLines = this.protectedLinesMap.get(editorId) ?? new Set<number>();

    const unmatchedLines = results
      .filter(r => r.groupId === null && !protectedLines.has(r.lineNumber))
      .map(r => r.lineNumber)
      .sort((a, b) => a - b);

    if (unmatchedLines.length === 0) { return []; }

    // 将连续行号合并为区间
    const ranges: Array<{ start: number; end: number }> = [];
    let rangeStart = unmatchedLines[0];
    let rangeEnd = unmatchedLines[0];

    for (let i = 1; i < unmatchedLines.length; i++) {
      if (unmatchedLines[i] === rangeEnd + 1) {
        rangeEnd = unmatchedLines[i];
      } else {
        ranges.push({ start: rangeStart, end: rangeEnd });
        rangeStart = unmatchedLines[i];
        rangeEnd = unmatchedLines[i];
      }
    }
    ranges.push({ start: rangeStart, end: rangeEnd });
    return ranges;
  }

  /** 清除结果 */
  clearResults(editorId: string): void {
    this.resultsMap.delete(editorId);
    this.fireChange();
  }

  /** 手动触发变更事件（例如 ring buffer 折叠状态变化时） */
  notifyChange(): void {
    this.fireChange();
  }

  private fireChange(): void {
    for (const l of this.changeListeners) { l(); }
  }
}
