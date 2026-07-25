import * as assert from 'assert';
import { RingBufferModel } from '../src/model/RingBufferModel';

describe('RingBufferModel', () => {
  let model: RingBufferModel;

  beforeEach(() => {
    model = new RingBufferModel();
  });

  it('未设置时返回 undefined', () => {
    assert.strictEqual(model.getStartLine('editor1'), undefined);
  });

  it('setStartLine 保存起点行', () => {
    model.setStartLine('editor1', 5);
    assert.strictEqual(model.getStartLine('editor1'), 5);
  });

  it('clear 清除某编辑器状态', () => {
    model.setStartLine('editor1', 5);
    model.clear('editor1');
    assert.strictEqual(model.getStartLine('editor1'), undefined);
  });

  it('不同编辑器相互独立', () => {
    model.setStartLine('editor1', 5);
    model.setStartLine('editor2', 10);
    assert.strictEqual(model.getStartLine('editor1'), 5);
    assert.strictEqual(model.getStartLine('editor2'), 10);
  });
});
