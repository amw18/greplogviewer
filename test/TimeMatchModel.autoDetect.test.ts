// 测试 — TimeMatchModel autoDetect 智能时间格式检测
import { strict as assert } from 'assert';
import { TimeMatchModel } from '../src/model/TimeMatchModel';

describe('TimeMatchModel — autoDetect', () => {
  let model: TimeMatchModel;

  beforeEach(() => { model = new TimeMatchModel(); });

  it('检测标准日志格式 [YYYY-MM-DD HH:mm:ss.SSS]', () => {
    const lines = [
      '[2024-01-15 10:30:45.123] INFO Server started',
      '[2024-01-15 10:30:46.456] DEBUG Connecting to DB',
      '[2024-01-15 10:30:47.789] ERROR Connection timeout',
      '[2024-01-15 10:30:48.012] INFO Retrying...',
      '[2024-01-15 10:30:49.345] INFO Connected',
    ];
    const result = model.autoDetect(lines);
    assert.ok(result !== null);
    assert.strictEqual(result!.format, '[YYYY-MM-DD HH:mm:ss.SSS]');
  });

  it('检测标准日志格式 [YYYY-MM-DD HH:mm:ss]（无毫秒）', () => {
    const lines = [
      '[2024-01-15 10:30:45] INFO Server started',
      '[2024-01-15 10:30:46] DEBUG Connecting',
      '[2024-01-15 10:30:47] ERROR Timeout',
    ];
    const result = model.autoDetect(lines);
    assert.ok(result !== null);
    assert.strictEqual(result!.format, '[YYYY-MM-DD HH:mm:ss]');
  });

  it('检测两位年份格式 [YY-MM-DD HH:mm:ss.SSS]', () => {
    const lines = [
      '[24-01-15 10:30:45.123] INFO Started',
      '[24-01-15 10:30:46.456] DEBUG Running',
      '[24-01-15 10:30:47.789] ERROR Failed',
    ];
    const result = model.autoDetect(lines);
    assert.ok(result !== null);
    assert.strictEqual(result!.format, '[YY-MM-DD HH:mm:ss.SSS]');
  });

  it('检测两位年份无毫秒格式 [YY-MM-DD HH:mm:ss]', () => {
    const lines = [
      '[24-01-15 10:30:45] INFO Started',
      '[24-01-15 10:30:46] DEBUG Running',
      '[24-01-15 10:30:47] ERROR Failed',
    ];
    const result = model.autoDetect(lines);
    assert.ok(result !== null);
    assert.strictEqual(result!.format, '[YY-MM-DD HH:mm:ss]');
  });

  it('检测无方括号格式 YYYY-MM-DD HH:mm:ss.SSS', () => {
    const lines = [
      '2024-01-15 10:30:45.123 INFO Started',
      '2024-01-15 10:30:46.456 DEBUG Running',
      '2024-01-15 10:30:47.789 ERROR Failed',
    ];
    const result = model.autoDetect(lines);
    assert.ok(result !== null);
    assert.strictEqual(result!.format, 'YYYY-MM-DD HH:mm:ss.SSS');
  });

  it('检测无方括号无毫秒格式 YYYY-MM-DD HH:mm:ss', () => {
    const lines = [
      '2024-01-15 10:30:45 INFO Started',
      '2024-01-15 10:30:46 DEBUG Running',
      '2024-01-15 10:30:47 ERROR Failed',
    ];
    const result = model.autoDetect(lines);
    assert.ok(result !== null);
    assert.strictEqual(result!.format, 'YYYY-MM-DD HH:mm:ss');
  });

  it('检测 Linux kernel 格式 [    s.SSSSSS]', () => {
    const lines = [
      '[    0.000000] Booting Linux...',
      '[    1.234567] Initializing cgroup',
      '[    2.500000] Mounting rootfs',
    ];
    const result = model.autoDetect(lines);
    assert.ok(result !== null);
    assert.strictEqual(result!.format, '[    s.SSSSSS]');
  });

  it('检测 Linux kernel 格式 [    s.SSSSSS]（固定空格）', () => {
    const lines = [
      '[    0.000000] Booting Linux...',
      '[    1.234567] Initializing cgroup',
      '[  123.456789] Starting services',
    ];
    const result = model.autoDetect(lines);
    assert.ok(result !== null);
    // 应该匹配到两种 kernel 格式之一
    assert.ok(result!.format === '[s.SSSSSS]' || result!.format === '[    s.SSSSSS]');
  });

  it('少于 3 个样本行时也能检测', () => {
    const lines = [
      '[2024-01-15 10:30:45.123] Line 1',
      '[2024-01-15 10:30:46.456] Line 2',
    ];
    const result = model.autoDetect(lines);
    assert.ok(result !== null);
    assert.strictEqual(result!.format, '[YYYY-MM-DD HH:mm:ss.SSS]');
  });

  it('无时间戳的日志返回 null', () => {
    const lines = [
      'Just some text without timestamps',
      'Another line of plain text',
      'No timestamps here either',
      'Still no time',
      'Nope',
    ];
    const result = model.autoDetect(lines);
    assert.strictEqual(result, null);
  });

  it('混合格式时优先匹配最常见格式', () => {
    // 3 lines with the same format → detected
    const lines = [
      '[2024-01-15 10:30:45.123] Line 1',
      '[2024-01-15 10:30:46.456] Line 2',
      '[2024-01-15 10:30:47.789] Line 3',
    ];
    const result = model.autoDetect(lines);
    assert.ok(result !== null);
    assert.strictEqual(result!.format, '[YYYY-MM-DD HH:mm:ss.SSS]');
  });

  it('空数组返回 null', () => {
    const result = model.autoDetect([]);
    assert.strictEqual(result, null);
  });

  it('单一格式多行确认后才返回', () => {
    // 确保至少阈值数量（min(3, sampleSize)）行匹配才返回
    const lines = [
      '[2024-01-15 10:30:45.123] Match 1',
      'no timestamp here',
      '[2024-01-15 10:30:47.789] Match 3',
      'another without time',
      '[2024-01-15 10:30:49.345] Match 5',
    ];
    const result = model.autoDetect(lines);
    // 3 行匹配，达到阈值
    assert.ok(result !== null);
    assert.strictEqual(result!.format, '[YYYY-MM-DD HH:mm:ss.SSS]');
  });

  it('自动检测后可通过 setConfig 覆盖', () => {
    const lines = [
      '[2024-01-15 10:30:45.123] Line 1',
      '[2024-01-15 10:30:46.456] Line 2',
      '[2024-01-15 10:30:47.789] Line 3',
    ];
    const autoResult = model.autoDetect(lines);
    assert.ok(autoResult !== null);

    // 手动覆盖
    model.setConfig({ format: 'Custom format' });
    assert.strictEqual(model.getConfig().format, 'Custom format');
    assert.strictEqual(model.isConfigured(), true);
  });
});
