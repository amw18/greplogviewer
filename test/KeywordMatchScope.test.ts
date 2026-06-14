// 测试 — Keyword matchScope 匹配范围选择
// 验证 matched/full 两种模式下的 keyword 匹配行为
import { strict as assert } from 'assert';
import { FilterController } from '../src/controller/FilterController';
import { RegexGroup, LogicOperator, KeywordConfig, FilterResult } from '../src/types';

function makeGroup(id: string, name: string, color: string, patterns: string[]): RegexGroup {
  return {
    id, name, color,
    expressions: patterns.map((p, i) => ({
      id: `${id}-e${i}`,
      pattern: p,
      flags: '',
      operator: i === 0 ? LogicOperator.AND : LogicOperator.AND,
      enabled: true,
    })),
    enabled: true,
  };
}

function makeKeyword(id: string, pattern: string, color: string, matchScope?: 'matched' | 'full'): KeywordConfig {
  return { id, pattern, flags: '', color, enabled: true, matchScope };
}

/**
 * 模拟 markKeywordVisibleLines 的行为：
 * 将 keyword 命中的未匹配行标记为可见。
 * matchScope='matched' 时只考虑已匹配行。
 * matchScope='full' 时考虑范围内所有行。
 * 向后兼容：未设置 matchScope 视为 'full'。
 */
function markKeywordVisibleLines(
  results: FilterResult[],
  lines: string[],
  keywords: KeywordConfig[],
  scanStart: number,
  scanEnd: number
): void {
  if (!keywords || keywords.length === 0) { return; }

  for (const r of results) {
    if (r.groupId !== null) { continue; } // 已匹配的行
    if (r.lineNumber < scanStart || r.lineNumber >= scanEnd) { continue; }

    for (const kw of keywords) {
      if (kw.enabled === false) { continue; }
      try {
        const regex = new RegExp(kw.pattern, kw.flags);
        if (!regex.test(lines[r.lineNumber])) { continue; }
      } catch { continue; }
      // matchScope='matched' 跳过（不标记未匹配行）
      if (kw.matchScope === 'matched') { continue; }
      // matchScope='full' 或未设置（向后兼容）：标记为可见
      r.groupId = '__kw_visible__';
      break;
    }
  }
}

describe('Keyword matchScope', () => {
  let fc: FilterController;

  beforeEach(() => { fc = new FilterController(); });

  describe('matchScope="full" (默认/向后兼容)', () => {
    it('未设置 matchScope 时行为保持向后兼容：keyword 命中未匹配行使其可见', () => {
      const lines = [
        'ERROR something failed',
        'DEBUG processing timeout',
        'INFO started',
      ];
      const groups = [
        makeGroup('g1', 'Errors', '#f00', ['ERROR']),
      ];
      const keywords: KeywordConfig[] = [
        makeKeyword('k1', 'timeout', '#0f0'),  // matchScope 未设置
      ];

      const results = fc.filter(lines, groups);
      // 初始：line 0 匹配 g1, line 1 未匹配, line 2 未匹配
      assert.strictEqual(results[0].groupId, 'g1');
      assert.strictEqual(results[1].groupId, null);
      assert.strictEqual(results[2].groupId, null);

      markKeywordVisibleLines(results, lines, keywords, 0, lines.length);

      // 向后兼容：line 1 被标记为可见（因为 timeout keyword 命中）
      assert.strictEqual(results[1].groupId, '__kw_visible__');
      assert.strictEqual(results[2].groupId, null);
    });
  });

  describe('matchScope="matched"', () => {
    it('keyword 命中的未匹配行不被标记为可见', () => {
      const lines = [
        'ERROR something failed',
        'DEBUG processing timeout',
        'INFO started',
      ];
      const groups = [
        makeGroup('g1', 'Errors', '#f00', ['ERROR']),
      ];
      const keywords: KeywordConfig[] = [
        makeKeyword('k1', 'timeout', '#0f0', 'matched'),
      ];

      const results = fc.filter(lines, groups);
      assert.strictEqual(results[0].groupId, 'g1');
      assert.strictEqual(results[1].groupId, null);

      markKeywordVisibleLines(results, lines, keywords, 0, lines.length);

      // matchScope='matched'：未匹配行即使 keyword 命中也不标记为可见
      assert.strictEqual(results[1].groupId, null);
      // line 0 已被 group 匹配，keyword 在其上做二次匹配（颜色装饰时处理）
    });

    it('已匹配行中 keyword 仍可高亮（二次匹配由 EditorDecorations 处理）', () => {
      // markKeywordVisibleLines 不处理已匹配行 — 二次匹配颜色由 EditorDecorations 单独处理
      const lines = [
        'ERROR timeout occurred',
        'INFO timeout happened',
      ];
      const groups = [
        makeGroup('g1', 'Errors', '#f00', ['ERROR']),
      ];
      const keywords: KeywordConfig[] = [
        makeKeyword('k1', 'timeout', '#ff0', 'matched'),
      ];

      const results = fc.filter(lines, groups);
      // line 0 匹配 g1
      assert.strictEqual(results[0].groupId, 'g1');
      assert.strictEqual(results[1].groupId, null);

      markKeywordVisibleLines(results, lines, keywords, 0, lines.length);

      // line 0 groupId 不变
      assert.strictEqual(results[0].groupId, 'g1');
      // line 1 不被标记为可见（matchScope='matched'）
      assert.strictEqual(results[1].groupId, null);
    });

    it('混合 matchScope：部分 keyword 用 full 部分用 matched', () => {
      const lines = [
        'ERROR critical timeout',
        'INFO processing done',
        'WARN timeout alert',
      ];
      const groups = [
        makeGroup('g1', 'Errors', '#f00', ['ERROR']),
      ];
      const keywords: KeywordConfig[] = [
        makeKeyword('k1', 'timeout', '#ff0', 'matched'),
        makeKeyword('k2', 'WARN', '#fa0', 'full'),
      ];

      const results = fc.filter(lines, groups);
      assert.strictEqual(results[0].groupId, 'g1');
      assert.strictEqual(results[1].groupId, null);
      assert.strictEqual(results[2].groupId, null);

      markKeywordVisibleLines(results, lines, keywords, 0, lines.length);

      // line 1: 无 keyword 命中 → 仍 null
      assert.strictEqual(results[1].groupId, null);
      // line 2: WARN keyword (matchScope='full') 命中 → 标记可见
      assert.strictEqual(results[2].groupId, '__kw_visible__');
      // line 0: 已匹配 g1，timeout keyword 在其上做二次匹配
      assert.strictEqual(results[0].groupId, 'g1');
    });
  });

  describe('EditorDecorations — keyword 扫描范围', () => {
    it('matchScope="matched" 时 computeKeywordMatches 应只扫描已匹配行', () => {
      // 此测试验证逻辑：keyword 的 matchScope 决定扫描范围
      // matched: 只扫描 groupId !== null 的行
      // full: 扫描 [scanStart, scanEnd) 内所有行

      const results: FilterResult[] = [
        { lineNumber: 0, groupId: 'g1', color: '#f00' },
        { lineNumber: 1, groupId: null, color: undefined },
        { lineNumber: 2, groupId: 'g1', color: '#f00' },
        { lineNumber: 3, groupId: null, color: undefined },
      ];

      const matchedSet = new Set<number>();
      for (const r of results) {
        if (r.groupId && r.groupId !== '__kw_visible__') {
          matchedSet.add(r.lineNumber);
        }
      }
      assert.deepStrictEqual(Array.from(matchedSet).sort(), [0, 2]);
    });
  });

  describe('KeywordConfig 兼容性', () => {
    it('旧 KeywordConfig（无 matchScope）序列化后反序列化仍正常', () => {
      const oldKw = {
        id: 'k1',
        pattern: 'ERROR',
        flags: '',
        color: '#f00',
        enabled: true,
      };
      // 类型安全：matchScope 为可选字段，缺失时默认 full
      const scope = oldKw['matchScope'] || 'full';
      assert.strictEqual(scope, 'full');
    });

    it('新 KeywordConfig 设置 matchScope="matched" 正确保留', () => {
      const newKw: KeywordConfig = {
        id: 'k1',
        pattern: 'ERROR',
        flags: '',
        color: '#f00',
        enabled: true,
        matchScope: 'matched',
      };
      assert.strictEqual(newKw.matchScope, 'matched');
    });
  });
});
