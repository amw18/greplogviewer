// 测试 — FilterResultModel 结果管理
import { strict as assert } from 'assert';
import { FilterResultModel } from '../src/model/FilterResultModel';
import { FilterResult } from '../src/types';

describe('FilterResultModel', () => {
  let model: FilterResultModel;

  beforeEach(() => { model = new FilterResultModel(); });

  function makeResults(editorId: string, matchedLines: number[]): void {
    const results: FilterResult[] = [];
    for (let i = 0; i < 10; i++) {
      const matched = matchedLines.includes(i);
      results.push({
        lineNumber: i,
        groupId: matched ? 'g1' : null,
        color: matched ? '#fff' : undefined,
      });
    }
    model.setResults(editorId, results);
  }

  it('获取匹配行号列表', () => {
    makeResults('doc1', [2, 5, 7]);
    const matched = model.getMatchedLines('doc1');
    assert.deepStrictEqual(matched, [2, 5, 7]);
  });

  it('获取未匹配的连续行区间', () => {
    makeResults('doc1', [3, 7]); // 匹配行: 3, 7
    const ranges = model.getUnmatchedRanges('doc1');
    // 行: 0 1 2 | 3(m) | 4 5 6 | 7(m) | 8 9
    assert.deepStrictEqual(ranges, [
      { start: 0, end: 2 },
      { start: 4, end: 6 },
      { start: 8, end: 9 },
    ]);
  });

  it('全部匹配时无未匹配区间', () => {
    makeResults('doc1', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const ranges = model.getUnmatchedRanges('doc1');
    assert.deepStrictEqual(ranges, []);
  });

  it('全部未匹配时返回整个区间', () => {
    makeResults('doc1', []);
    const ranges = model.getUnmatchedRanges('doc1');
    assert.deepStrictEqual(ranges, [{ start: 0, end: 9 }]);
  });

  it('清除结果', () => {
    makeResults('doc1', [1]);
    model.clearResults('doc1');
    assert.strictEqual(model.getResults('doc1'), undefined);
    assert.deepStrictEqual(model.getMatchedLines('doc1'), []);
  });

  it('设置空结果表示已过滤但无折叠区间', () => {
    makeResults('doc1', [1]);
    model.setEmptyResults('doc1');
    assert.deepStrictEqual(model.getResults('doc1'), []);
    assert.deepStrictEqual(model.getUnmatchedRanges('doc1'), []);
    assert.deepStrictEqual(model.getMatchedLines('doc1'), []);
  });

  it('单行未匹配区间', () => {
    makeResults('doc1', [0, 2, 4]); // 匹配 0,2,4, 未匹配 1,3
    const ranges = model.getUnmatchedRanges('doc1');
    assert.deepStrictEqual(ranges, [
      { start: 1, end: 1 },
      { start: 3, end: 3 },
      { start: 5, end: 9 },
    ]);
  });

  it('受保护行不被包含在未匹配区间中', () => {
    makeResults('doc1', [0, 2, 4]); // 未匹配 1,3,5-9
    model.setProtectedLines('doc1', new Set([3, 7]));
    const ranges = model.getUnmatchedRanges('doc1');
    assert.deepStrictEqual(ranges, [
      { start: 1, end: 1 },
      { start: 5, end: 6 },
      { start: 8, end: 9 },
    ]);
  });

  it('清除受保护行后恢复原始未匹配区间', () => {
    makeResults('doc1', [0, 2, 4]);
    model.setProtectedLines('doc1', new Set([3, 7]));
    model.clearProtectedLines('doc1');
    const ranges = model.getUnmatchedRanges('doc1');
    assert.deepStrictEqual(ranges, [
      { start: 1, end: 1 },
      { start: 3, end: 3 },
      { start: 5, end: 9 },
    ]);
  });
});
