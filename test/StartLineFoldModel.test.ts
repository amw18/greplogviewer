import * as assert from 'assert';
import { StartLineFoldModel } from '../src/model/StartLineFoldModel';

describe('StartLineFoldModel', () => {
  let model: StartLineFoldModel;

  beforeEach(() => {
    model = new StartLineFoldModel();
  });

  it('默认状态为 none', () => {
    assert.strictEqual(model.getState('editor1'), 'none');
  });

  it('cycleState 按 none -> foldBelow -> foldAbove -> none 循环', () => {
    const editorId = 'editor1';
    assert.strictEqual(model.cycleState(editorId), 'foldBelow');
    assert.strictEqual(model.cycleState(editorId), 'foldAbove');
    assert.strictEqual(model.cycleState(editorId), 'none');
  });

  it('setState 直接设置状态', () => {
    model.setState('editor1', 'foldAbove');
    assert.strictEqual(model.getState('editor1'), 'foldAbove');
  });

  it('clear 清除某编辑器状态', () => {
    model.setState('editor1', 'foldBelow');
    model.clear('editor1');
    assert.strictEqual(model.getState('editor1'), 'none');
  });

  it('onChange 在状态变化时触发', () => {
    let count = 0;
    model.onChange(() => count++);
    model.cycleState('editor1');
    assert.strictEqual(count, 1);
    model.setState('editor1', 'foldAbove');
    assert.strictEqual(count, 2);
    model.clear('editor1');
    assert.strictEqual(count, 3);
  });
});
