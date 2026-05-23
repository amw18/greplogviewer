// FilterResultModel — 存储和管理过滤匹配结果
import { FilterResult, FoldRange } from '../types';
import { TimeMatchModel } from './TimeMatchModel';

export class FilterResultModel {
  private resultsMap = new Map<string, FilterResult[]>();

  /** 设置过滤结果 */
  setResults(editorId: string, results: FilterResult[]): void {
    this.resultsMap.set(editorId, results);
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

    const unmatchedLines = results
      .filter(r => r.groupId === null)
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

  /**
   * 获取带时间元数据的折叠区间
   * @param editorId 编辑器 ID
   * @param timeModel 时间匹配模型（用于填充时间元数据）
   * @param totalLines 文档总行数
   */
  getFoldRanges(editorId: string, timeModel: TimeMatchModel, totalLines: number): FoldRange[] {
    const rawRanges = this.getUnmatchedRanges(editorId);
    if (timeModel.isConfigured()) {
      return timeModel.enrichFoldRanges(rawRanges, totalLines);
    }
    // 无时间配置时返回基本区间
    return rawRanges.map(r => ({
      start: r.start,
      end: r.end,
      lineCount: r.end - r.start + 1,
    }));
  }

  /** 清除结果 */
  clearResults(editorId: string): void {
    this.resultsMap.delete(editorId);
  }
}
