// 测试 — FilterController 正则匹配引擎
import { strict as assert } from 'assert';
import { FilterController } from '../src/controller/FilterController';
import { RegexGroup, LogicOperator } from '../src/types';

function makeGroup(id: string, name: string, color: string, exprs: Array<{ pattern: string; flags: string; operator: LogicOperator }>): RegexGroup {
  return {
    id, name, color,
    expressions: exprs.map((e, i) => ({ id: `${id}-e${i}`, ...e })),
  };
}

describe('FilterController', () => {
  let fc: FilterController;

  beforeEach(() => { fc = new FilterController(); });

  describe('matchGroup — 单组匹配', () => {
    it('空表达式列表应返回 false', () => {
      const group: RegexGroup = { id: 'g1', name: 'test', color: '#fff', expressions: [] };
      assert.strictEqual(fc.matchGroup('hello', group), false);
    });

    it('单表达式匹配成功', () => {
      const group = makeGroup('g1', 'test', '#fff', [
        { pattern: 'ERROR', flags: '', operator: LogicOperator.AND },
      ]);
      assert.strictEqual(fc.matchGroup('2024 ERROR timeout', group), true);
      assert.strictEqual(fc.matchGroup('2024 INFO started', group), false);
    });

    it('AND 逻辑：两个表达式都匹配才为真', () => {
      const group = makeGroup('g1', 'test', '#fff', [
        { pattern: 'ERROR', flags: '', operator: LogicOperator.AND },
        { pattern: 'timeout', flags: '', operator: LogicOperator.AND },
      ]);
      assert.strictEqual(fc.matchGroup('2024 ERROR timeout', group), true);
      assert.strictEqual(fc.matchGroup('2024 ERROR retry', group), false);
    });

    it('OR 逻辑：任一表达式匹配即为真', () => {
      const group = makeGroup('g1', 'test', '#fff', [
        { pattern: 'ERROR', flags: '', operator: LogicOperator.AND },
        { pattern: 'FATAL', flags: '', operator: LogicOperator.OR },
      ]);
      assert.strictEqual(fc.matchGroup('2024 ERROR timeout', group), true);
      assert.strictEqual(fc.matchGroup('2024 FATAL crash', group), true);
      assert.strictEqual(fc.matchGroup('2024 INFO started', group), false);
    });

    it('NOT 逻辑：首匹配为真 + NOT 不匹配 = 真', () => {
      const group = makeGroup('g1', 'test', '#fff', [
        { pattern: 'ERROR', flags: '', operator: LogicOperator.AND },
        { pattern: 'ignore', flags: '', operator: LogicOperator.NOT },
      ]);
      assert.strictEqual(fc.matchGroup('2024 ERROR timeout', group), true);
      assert.strictEqual(fc.matchGroup('2024 ERROR ignore', group), false);
    });

    it('大小写不敏感标志 (i)', () => {
      const group = makeGroup('g1', 'test', '#fff', [
        { pattern: 'error', flags: 'i', operator: LogicOperator.AND },
      ]);
      assert.strictEqual(fc.matchGroup('2024 ERROR timeout', group), true);
      assert.strictEqual(fc.matchGroup('2024 Error timeout', group), true);
    });

    it('复合逻辑：AND + OR + NOT', () => {
      const group = makeGroup('g1', 'test', '#fff', [
        { pattern: 'ERROR', flags: '', operator: LogicOperator.AND },
        { pattern: 'FATAL', flags: '', operator: LogicOperator.OR },
        { pattern: 'ignore', flags: '', operator: LogicOperator.NOT },
      ]);
      assert.strictEqual(fc.matchGroup('2024 ERROR FATAL timeout', group), true);
      assert.strictEqual(fc.matchGroup('2024 ERROR timeout', group), true);
      assert.strictEqual(fc.matchGroup('2024 FATAL crash', group), true);
      assert.strictEqual(fc.matchGroup('2024 WARNING alert', group), false);
      assert.strictEqual(fc.matchGroup('2024 ERROR ignore', group), false);
    });
  });

  describe('filter — 全文过滤 + 首组匹配优先', () => {
    it('空组列表返回全部未匹配', () => {
      const results = fc.filter(['line1', 'line2', 'line3'], []);
      assert.strictEqual(results.length, 3);
      results.forEach(r => assert.strictEqual(r.groupId, null));
    });

    it('单组匹配部分行', () => {
      const groups = [
        makeGroup('g1', 'Errors', '#ff0000', [
          { pattern: 'ERROR', flags: '', operator: LogicOperator.AND },
        ]),
      ];
      const results = fc.filter([
        'INFO started',
        'ERROR timeout',
        'DEBUG config',
        'ERROR crash',
      ], groups);

      assert.strictEqual(results.length, 4);
      assert.strictEqual(results[0].groupId, null);
      assert.strictEqual(results[1].groupId, 'g1');
      assert.strictEqual(results[1].color, '#ff0000');
      assert.strictEqual(results[2].groupId, null);
      assert.strictEqual(results[3].groupId, 'g1');
    });

    it('首组匹配优先：多组匹配同一行时只算第一组', () => {
      const groups = [
        makeGroup('g1', 'Errors', '#ff0000', [
          { pattern: 'ERROR', flags: '', operator: LogicOperator.AND },
        ]),
        makeGroup('g2', 'Server', '#00ff00', [
          { pattern: 'ERROR', flags: '', operator: LogicOperator.AND },
          { pattern: 'server', flags: '', operator: LogicOperator.AND },
        ]),
      ];
      const results = fc.filter([
        'ERROR on server',
      ], groups);

      assert.strictEqual(results[0].groupId, 'g1');
      assert.strictEqual(results[0].color, '#ff0000');
    });

    it('多组优先级正确', () => {
      const groups = [
        makeGroup('g1', 'Errors', '#ff0000', [
          { pattern: 'ERROR', flags: '', operator: LogicOperator.AND },
        ]),
        makeGroup('g2', 'Warnings', '#ffaa00', [
          { pattern: 'WARN', flags: '', operator: LogicOperator.AND },
        ]),
        makeGroup('g3', 'Info', '#00ff00', [
          { pattern: 'INFO', flags: '', operator: LogicOperator.AND },
        ]),
      ];
      const results = fc.filter([
        'INFO started',
        'ERROR timeout',
        'WARN memory',
        'INFO done',
        'DEBUG trace',
      ], groups);

      assert.strictEqual(results[0].groupId, 'g3');
      assert.strictEqual(results[1].groupId, 'g1');
      assert.strictEqual(results[2].groupId, 'g2');
      assert.strictEqual(results[3].groupId, 'g3');
      assert.strictEqual(results[4].groupId, null);
    });

    it('组2匹配组1未匹配的行', () => {
      const groups = [
        makeGroup('g1', 'Fatal', '#ff0000', [
          { pattern: 'FATAL', flags: '', operator: LogicOperator.AND },
        ]),
        makeGroup('g2', 'Error', '#ff4444', [
          { pattern: 'ERROR', flags: '', operator: LogicOperator.AND },
        ]),
      ];
      const results = fc.filter([
        'FATAL crash',
        'ERROR timeout',
        'FATAL oom',
        'INFO started',
      ], groups);

      assert.strictEqual(results[0].groupId, 'g1');
      assert.strictEqual(results[1].groupId, 'g2');
      assert.strictEqual(results[2].groupId, 'g1');
      assert.strictEqual(results[3].groupId, null);
    });
  });

  describe('filter — 行范围过滤', () => {
    const lines = [
      'L01 header',
      'L02 header',
      'L03 ERROR something',
      'L04 INFO start',
      'L05 ERROR crash',
      'L06 DEBUG trace',
      'L07 ERROR timeout',
      'L08 INFO done',
      'L09 footer',
      'L10 footer',
    ];

    const groups = [
      makeGroup('g1', 'Errors', '#ff0000', [
        { pattern: 'ERROR', flags: '', operator: LogicOperator.AND },
      ]),
    ];

    it('指定 startLine 和 endLine 后，范围外的行都是未匹配', () => {
      // startLine=3, endLine=7 → 扫描第 3~7 行（0-based: 2~6）
      const results = fc.filter(lines, groups, 3, 7);

      // 范围外的行都是 null
      assert.strictEqual(results[0].groupId, null); // L01: line 0, 范围外
      assert.strictEqual(results[1].groupId, null); // L02: line 1, 范围外
      // 范围内
      assert.strictEqual(results[2].groupId, 'g1');  // L03: line 2, ERROR
      assert.strictEqual(results[3].groupId, null);  // L04: line 3, INFO
      assert.strictEqual(results[4].groupId, 'g1');  // L05: line 4, ERROR
      assert.strictEqual(results[5].groupId, null);  // L06: line 5, DEBUG
      assert.strictEqual(results[6].groupId, 'g1');  // L07: line 6, ERROR
      // 范围外
      assert.strictEqual(results[7].groupId, null);  // L08: line 7, 范围外
      assert.strictEqual(results[8].groupId, null);  // L09: line 8, 范围外
      assert.strictEqual(results[9].groupId, null);  // L10: line 9, 范围外
    });

    it('只指定 startLine，endLine 未指定时匹配到末尾', () => {
      // startLine=5
      const results = fc.filter(lines, groups, 5, undefined);

      // 前 4 行范围外
      for (let i = 0; i < 4; i++) {
        assert.strictEqual(results[i].groupId, null);
      }
      // 第 5 行：L05 ERROR crash → 匹配
      assert.strictEqual(results[4].groupId, 'g1');
      assert.strictEqual(results[5].groupId, null);  // L06 DEBUG
      assert.strictEqual(results[6].groupId, 'g1');  // L07 ERROR timeout
      assert.strictEqual(results[7].groupId, null);  // L08 INFO
      assert.strictEqual(results[8].groupId, null);  // L09 footer
      assert.strictEqual(results[9].groupId, null);  // L10 footer
    });

    it('只指定 endLine，startLine 未指定时从第 1 行开始匹配', () => {
      // endLine=4
      const results = fc.filter(lines, groups, undefined, 4);

      assert.strictEqual(results[0].groupId, null);  // L01 header
      assert.strictEqual(results[1].groupId, null);  // L02 header
      assert.strictEqual(results[2].groupId, 'g1');  // L03 ERROR
      assert.strictEqual(results[3].groupId, null);  // L04 INFO
      // 范围外
      assert.strictEqual(results[4].groupId, null);  // L05 ERROR crash, 不匹配！
      assert.strictEqual(results[5].groupId, null);  // L06
      assert.strictEqual(results[6].groupId, null);  // L07 ERROR, 不匹配！
      assert.strictEqual(results[7].groupId, null);  // L08
      assert.strictEqual(results[8].groupId, null);  // L09
      assert.strictEqual(results[9].groupId, null);  // L10
    });

    it('startLine 超出行数时，结果全部未匹配', () => {
      const results = fc.filter(lines, groups, 999, undefined);
      results.forEach(r => assert.strictEqual(r.groupId, null));
    });

    it('范围完全包含所有行时行为与不指定范围相同', () => {
      const resultsRanged = fc.filter(lines, groups, 1, 10);
      const resultsFull = fc.filter(lines, groups);
      for (let i = 0; i < lines.length; i++) {
        assert.strictEqual(resultsRanged[i].groupId, resultsFull[i].groupId);
      }
    });

    it('不指定范围时行为不变', () => {
      const results = fc.filter(lines, groups);
      assert.strictEqual(results[2].groupId, 'g1');  // ERROR
      assert.strictEqual(results[4].groupId, 'g1');  // ERROR
      assert.strictEqual(results[6].groupId, 'g1');  // ERROR
      assert.strictEqual(results[0].groupId, null);
      assert.strictEqual(results[3].groupId, null);
    });
  });
});
