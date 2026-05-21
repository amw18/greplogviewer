// 测试 — RegexGroupModel 数据操作
import { strict as assert } from 'assert';
import { RegexGroupModel } from '../src/model/RegexGroupModel';
import { LogicOperator } from '../src/types';

describe('RegexGroupModel', () => {
  let model: RegexGroupModel;

  beforeEach(() => { model = new RegexGroupModel(); });

  it('创建正则组', () => {
    const group = model.createGroup('Errors', '#ff0000');
    assert.strictEqual(group.name, 'Errors');
    assert.strictEqual(group.color, '#ff0000');
    assert.strictEqual(group.expressions.length, 0);
    assert.ok(group.id.length > 0);
    assert.strictEqual(model.getGroups().length, 1);
  });

  it('删除正则组', () => {
    const g = model.createGroup('g1', '#fff');
    model.createGroup('g2', '#000');
    model.removeGroup(g.id);
    assert.strictEqual(model.getGroups().length, 1);
    assert.strictEqual(model.getGroups()[0].name, 'g2');
  });

  it('更新正则组信息', () => {
    const g = model.createGroup('g1', '#fff');
    model.updateGroup(g.id, { name: 'Errors', color: '#ff0000' });
    const updated = model.getGroups()[0];
    assert.strictEqual(updated.name, 'Errors');
    assert.strictEqual(updated.color, '#ff0000');
  });

  it('添加表达式', () => {
    const g = model.createGroup('g1', '#fff');
    const expr = model.addExpression(g.id, 'ERROR', 'i', LogicOperator.AND);
    assert.ok(expr);
    assert.strictEqual(expr!.pattern, 'ERROR');
    assert.strictEqual(expr!.flags, 'i');
    assert.strictEqual(model.getGroups()[0].expressions.length, 1);
  });

  it('删除表达式', () => {
    const g = model.createGroup('g1', '#fff');
    const e1 = model.addExpression(g.id, 'ERROR', '', LogicOperator.AND)!;
    model.addExpression(g.id, 'WARN', '', LogicOperator.OR);
    model.removeExpression(g.id, e1.id);
    assert.strictEqual(model.getGroups()[0].expressions.length, 1);
    assert.strictEqual(model.getGroups()[0].expressions[0].pattern, 'WARN');
  });

  it('更新表达式', () => {
    const g = model.createGroup('g1', '#fff');
    const expr = model.addExpression(g.id, 'ERR', '', LogicOperator.AND)!;
    model.updateExpression(g.id, expr.id, { pattern: 'ERROR', flags: 'i' });
    const updated = model.getGroups()[0].expressions[0];
    assert.strictEqual(updated.pattern, 'ERROR');
    assert.strictEqual(updated.flags, 'i');
  });

  it('校验合法正则', () => {
    const result = model.validatePattern('hello', 'i');
    assert.strictEqual(result.valid, true);
  });

  it('校验非法正则', () => {
    const result = model.validatePattern('[unclosed', '');
    assert.strictEqual(result.valid, false);
    assert.ok(result.error);
  });

  it('设置组列表（用于加载持久化配置）', () => {
    const groups = [
      { id: 'g1', name: 'test', color: '#fff', expressions: [] },
    ];
    model.setGroups(groups);
    assert.strictEqual(model.getGroups().length, 1);
  });
});
