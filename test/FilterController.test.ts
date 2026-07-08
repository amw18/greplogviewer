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

  describe('enabled — 启用/禁用', () => {
    const lines = ['ERROR timeout', 'INFO started', 'WARN memory'];

    it('enabled 未设置时默认为启用', () => {
      const group: RegexGroup = {
        id: 'g1', name: 'test', color: '#ff0',
        expressions: [{ id: 'e1', pattern: 'ERROR', flags: '', operator: LogicOperator.AND }],
      };
      assert.strictEqual(fc.matchGroup('ERROR timeout', group), true);
    });

    it('group.enabled=false 时整组被跳过，所有行未匹配', () => {
      const group: RegexGroup = {
        id: 'g1', name: 'test', color: '#ff0', enabled: false,
        expressions: [{ id: 'e1', pattern: 'ERROR', flags: '', operator: LogicOperator.AND }],
      };
      const results = fc.filter(lines, [group]);
      results.forEach(r => assert.strictEqual(r.groupId, null));
    });

    it('group.enabled=true 时正常匹配', () => {
      const group: RegexGroup = {
        id: 'g1', name: 'test', color: '#ff0', enabled: true,
        expressions: [{ id: 'e1', pattern: 'ERROR', flags: '', operator: LogicOperator.AND }],
      };
      const results = fc.filter(lines, [group]);
      assert.strictEqual(results[0].groupId, 'g1');
      assert.strictEqual(results[1].groupId, null);
    });

    it('多组中禁用某组后，后续组仍可匹配该组原本匹配的行', () => {
      const g1: RegexGroup = {
        id: 'g1', name: 'first', color: '#f00', enabled: false,
        expressions: [{ id: 'e1', pattern: 'ERROR', flags: '', operator: LogicOperator.AND }],
      };
      const g2: RegexGroup = {
        id: 'g2', name: 'second', color: '#0f0',
        expressions: [{ id: 'e1', pattern: 'ERROR', flags: '', operator: LogicOperator.AND }],
      };
      const results = fc.filter(lines, [g1, g2]);
      // g1 被跳过，g2 匹配到 ERROR
      assert.strictEqual(results[0].groupId, 'g2');
      assert.strictEqual(results[0].color, '#0f0');
    });

    it('expression.enabled=false 时该表达式在 matchGroup 中被跳过', () => {
      const group: RegexGroup = {
        id: 'g1', name: 'test', color: '#ff0',
        expressions: [
          { id: 'e1', pattern: 'ERROR', flags: '', operator: LogicOperator.AND },
          { id: 'e2', pattern: 'timeout', flags: '', operator: LogicOperator.AND, enabled: false },
        ],
      };
      // e2 被跳过，仅 e1 生效 → 匹配
      assert.strictEqual(fc.matchGroup('ERROR timeout', group), true);
      assert.strictEqual(fc.matchGroup('ERROR crash', group), true);
    });

    it('所有 expression 都被禁用时 matchGroup 返回 false', () => {
      const group: RegexGroup = {
        id: 'g1', name: 'test', color: '#ff0',
        expressions: [
          { id: 'e1', pattern: 'ERROR', flags: '', operator: LogicOperator.AND, enabled: false },
        ],
      };
      assert.strictEqual(fc.matchGroup('ERROR timeout', group), false);
    });

    it('expression.enabled=true 时正常参与逻辑运算', () => {
      const group: RegexGroup = {
        id: 'g1', name: 'test', color: '#ff0',
        expressions: [
          { id: 'e1', pattern: 'ERROR', flags: '', operator: LogicOperator.AND },
          { id: 'e2', pattern: 'timeout', flags: '', operator: LogicOperator.AND, enabled: true },
        ],
      };
      assert.strictEqual(fc.matchGroup('ERROR timeout', group), true);
      assert.strictEqual(fc.matchGroup('ERROR crash', group), false);
    });
  });
});
