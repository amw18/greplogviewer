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
      // ERROR=true, FATAL=true, ignore=false → true||true&&!false = true
      assert.strictEqual(fc.matchGroup('2024 ERROR FATAL timeout', group), true);
      // ERROR=true, FATAL=false, ignore=false → true||false&&!false = true
      assert.strictEqual(fc.matchGroup('2024 ERROR timeout', group), true);
      // FATAL=true, ignore=false → false||true&&!false = true (OR picks it up)
      assert.strictEqual(fc.matchGroup('2024 FATAL crash', group), true);
      // WARNING only: no expr matches → false
      assert.strictEqual(fc.matchGroup('2024 WARNING alert', group), false);
      // ERROR + ignore → true&&!true = false
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

      // 两个组都匹配，但 g1 先匹配，所以 g2 被排除
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
});
