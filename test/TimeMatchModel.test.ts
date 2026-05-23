// 测试 — TimeMatchModel 时间匹配与解析
import { strict as assert } from 'assert';
import { TimeMatchModel } from '../src/model/TimeMatchModel';
import { TimePatternConfig } from '../src/types';

describe('TimeMatchModel', () => {
  let model: TimeMatchModel;

  beforeEach(() => { model = new TimeMatchModel(); });

  // ===== 格式解析 =====
  describe('parseFormat', () => {
    it('解析简单格式 YYYY-MM-DD', () => {
      const segs = model.parseFormat('YYYY-MM-DD');
      assert.strictEqual(segs.length, 5);
      assert.deepStrictEqual(segs[0], { type: 'token', value: 'YYYY' });
      assert.deepStrictEqual(segs[1], { type: 'literal', value: '-' });
      assert.deepStrictEqual(segs[2], { type: 'token', value: 'MM' });
      assert.deepStrictEqual(segs[3], { type: 'literal', value: '-' });
      assert.deepStrictEqual(segs[4], { type: 'token', value: 'DD' });
    });

    it('解析包含可选部分的格式 {.SSS}', () => {
      const segs = model.parseFormat('HH:mm:ss{.SSS}');
      assert.strictEqual(segs.length, 6);
      assert.deepStrictEqual(segs[0], { type: 'token', value: 'HH' });
      assert.deepStrictEqual(segs[1], { type: 'literal', value: ':' });
      assert.deepStrictEqual(segs[2], { type: 'token', value: 'mm' });
      assert.deepStrictEqual(segs[3], { type: 'literal', value: ':' });
      assert.deepStrictEqual(segs[4], { type: 'token', value: 'ss' });
      assert.strictEqual(segs[5].type, 'optional');
      if (segs[5].type === 'optional') {
        assert.strictEqual(segs[5].segments.length, 2);
        assert.deepStrictEqual(segs[5].segments[0], { type: 'literal', value: '.' });
        assert.deepStrictEqual(segs[5].segments[1], { type: 'token', value: 'SSS' });
      }
    });

    it('解析带 YY 的格式', () => {
      const segs = model.parseFormat('YY/MM/DD');
      assert.strictEqual(segs.length, 5);
      assert.deepStrictEqual(segs[0], { type: 'token', value: 'YY' });
    });

    it('解析带方括号的格式 [YYYY-MM-DD HH:mm:ss]', () => {
      const segs = model.parseFormat('[YYYY-MM-DD HH:mm:ss]');
      // [ YYYY - MM - DD SP HH : mm : ss ] = 13 segments
      assert.strictEqual(segs.length, 13);
      assert.deepStrictEqual(segs[0], { type: 'literal', value: '[' });
      assert.deepStrictEqual(segs[segs.length - 1], { type: 'literal', value: ']' });
    });
  });

  // ===== walkSegments 直接匹配（替代原 buildLineRegex） =====
  describe('parseTimestamps — 行首匹配', () => {
    it('纯格式匹配行首时间戳', () => {
      model.setConfig({ format: 'YYYY-MM-DD HH:mm:ss' });
      const lines = [
        '2024-01-15 12:30:45 INFO',
        '2024-01-15 12:30 incomplete',
      ];
      model.parseTimestamps(lines);
      assert.ok(model.getTimestamp(0) instanceof Date);
      assert.strictEqual(model.getTimestamp(1), undefined); // 不完整
    });

    it('带方括号匹配行首', () => {
      model.setConfig({ format: '[YYYY-MM-DD HH:mm:ss]' });
      const lines = [
        '[2023-01-01 10:00:05] INFO',
        ' [2023-01-01 10:00:05] INFO', // 行首有空格不匹配
      ];
      model.parseTimestamps(lines);
      assert.ok(model.getTimestamp(0) instanceof Date);
      assert.strictEqual(model.getTimestamp(1), undefined);
    });

    it('带可选毫秒匹配', () => {
      model.setConfig({ format: 'YYYY-MM-DD HH:mm:ss{.SSS}' });
      const lines = [
        '2024-01-15 12:30:45.123 INFO',
        '2024-01-15 12:30:45 INFO',
      ];
      model.parseTimestamps(lines);
      assert.ok(model.getTimestamp(0) instanceof Date);
      assert.strictEqual(model.getTimestamp(0)!.getMilliseconds(), 123);
      assert.ok(model.getTimestamp(1) instanceof Date);
      assert.strictEqual(model.getTimestamp(1)!.getMilliseconds(), 0);
    });
  });

  // ===== 日期解析 =====
  describe('parseDate', () => {
    it('解析完整时间戳 YYYY-MM-DD HH:mm:ss.SSS', () => {
      const segs = model.parseFormat('YYYY-MM-DD HH:mm:ss.SSS');
      const result = model.parseDate('2024-01-15 12:30:45.123', segs);
      assert.ok(result instanceof Date);
      assert.strictEqual(result!.getFullYear(), 2024);
      assert.strictEqual(result!.getMonth(), 0);
      assert.strictEqual(result!.getDate(), 15);
      assert.strictEqual(result!.getHours(), 12);
      assert.strictEqual(result!.getMinutes(), 30);
      assert.strictEqual(result!.getSeconds(), 45);
      assert.strictEqual(result!.getMilliseconds(), 123);
    });

    it('解析无毫秒的时间戳 YYYY-MM-DD HH:mm:ss', () => {
      const segs = model.parseFormat('YYYY-MM-DD HH:mm:ss');
      const result = model.parseDate('2024-12-31 23:59:59', segs);
      assert.ok(result instanceof Date);
      assert.strictEqual(result!.getFullYear(), 2024);
      assert.strictEqual(result!.getMonth(), 11);
      assert.strictEqual(result!.getDate(), 31);
      assert.strictEqual(result!.getHours(), 23);
      assert.strictEqual(result!.getMinutes(), 59);
      assert.strictEqual(result!.getSeconds(), 59);
      assert.strictEqual(result!.getMilliseconds(), 0);
    });

    it('解析可选毫秒 — 有毫秒部分', () => {
      const segs = model.parseFormat('HH:mm:ss{.SSS}');
      const result = model.parseDate('08:15:30.500', segs);
      assert.ok(result instanceof Date);
      assert.strictEqual(result!.getHours(), 8);
      assert.strictEqual(result!.getMinutes(), 15);
      assert.strictEqual(result!.getSeconds(), 30);
      assert.strictEqual(result!.getMilliseconds(), 500);
    });

    it('解析可选毫秒 — 无毫秒部分', () => {
      const segs = model.parseFormat('HH:mm:ss{.SSS}');
      const result = model.parseDate('08:15:30', segs);
      assert.ok(result instanceof Date);
      assert.strictEqual(result!.getHours(), 8);
      assert.strictEqual(result!.getMinutes(), 15);
      assert.strictEqual(result!.getSeconds(), 30);
      assert.strictEqual(result!.getMilliseconds(), 0);
    });

    it('解析 YY（两位年份）', () => {
      const segs = model.parseFormat('YY-MM-DD');
      const result = model.parseDate('24-03-10', segs);
      assert.ok(result instanceof Date);
      assert.strictEqual(result!.getFullYear(), 2024);
    });

    it('非法日期返回 null', () => {
      const segs = model.parseFormat('YYYY-MM-DD');
      const result = model.parseDate('2024-02-30', segs);
      assert.strictEqual(result, null);
    });

    it('格式不匹配返回 null', () => {
      const segs = model.parseFormat('YYYY-MM-DD');
      const result = model.parseDate('abc', segs);
      assert.strictEqual(result, null);
    });

    it('解析带 T 分隔的 ISO 风格时间', () => {
      const segs = model.parseFormat('YYYY-MM-DDTHH:mm:ss');
      const result = model.parseDate('2024-06-15T14:22:33', segs);
      assert.ok(result instanceof Date);
      assert.strictEqual(result!.getFullYear(), 2024);
      assert.strictEqual(result!.getMonth(), 5);
      assert.strictEqual(result!.getDate(), 15);
      assert.strictEqual(result!.getHours(), 14);
      assert.strictEqual(result!.getMinutes(), 22);
      assert.strictEqual(result!.getSeconds(), 33);
    });
  });

  // ===== 时间戳提取 =====
  describe('parseTimestamps', () => {
    it('从多行文本提取时间戳', () => {
      model.setConfig({ format: 'YYYY-MM-DD HH:mm:ss' });
      const lines = [
        '2024-01-15 10:00:00 INFO Start',
        '2024-01-15 10:00:01 DEBUG Processing',
        '2024-01-15 10:00:05 ERROR Failed',
      ];
      model.parseTimestamps(lines);
      assert.ok(model.getTimestamp(0) instanceof Date);
      assert.strictEqual(model.getTimestamp(0)!.getSeconds(), 0);
      assert.strictEqual(model.getTimestamp(1)!.getSeconds(), 1);
      assert.strictEqual(model.getTimestamp(2)!.getSeconds(), 5);
    });

    it('匹配带方括号的时间戳 [YYYY-MM-DD HH:mm:ss]', () => {
      model.setConfig({ format: '[YYYY-MM-DD HH:mm:ss]' });
      const lines = [
        '[2023-01-01 10:00:05] INFO Started',
        '[2023-01-01 10:00:30] INFO Stopped',
      ];
      model.parseTimestamps(lines);
      assert.ok(model.getTimestamp(0) instanceof Date);
      assert.strictEqual(model.getTimestamp(0)!.getFullYear(), 2023);
      assert.strictEqual(model.getTimestamp(0)!.getMonth(), 0);
      assert.strictEqual(model.getTimestamp(0)!.getDate(), 1);
      assert.strictEqual(model.getTimestamp(0)!.getHours(), 10);
      assert.strictEqual(model.getTimestamp(0)!.getMinutes(), 0);
      assert.strictEqual(model.getTimestamp(0)!.getSeconds(), 5);
      assert.strictEqual(model.getTimestamp(1)!.getSeconds(), 30);
    });

    it('未配置时返回 undefined', () => {
      const lines = ['2024-01-15 10:00:00 test'];
      model.parseTimestamps(lines);
      assert.strictEqual(model.getTimestamp(0), undefined);
    });

    it('时间模式不匹配时返回 undefined', () => {
      model.setConfig({ format: 'YYYY-MM-DD' });
      const lines = ['[2024-01-15] test']; // 方括号不匹配 ^YYYY-MM-DD 格式
      model.parseTimestamps(lines);
      assert.strictEqual(model.getTimestamp(0), undefined);
    });

    it('指定行范围扫描', () => {
      model.setConfig({ format: 'HH:mm:ss' });
      const lines = [
        '00:00:00 line 0',
        '00:00:01 line 1',
        '00:00:02 line 2',
        '00:00:03 line 3',
        '00:00:04 line 4',
      ];
      model.parseTimestamps(lines, 2, 4);
      assert.strictEqual(model.getTimestamp(0), undefined);
      assert.ok(model.getTimestamp(1) instanceof Date);
      assert.ok(model.getTimestamp(2) instanceof Date);
      assert.ok(model.getTimestamp(3) instanceof Date);
      assert.strictEqual(model.getTimestamp(4), undefined);
    });

    it('匹配带可选毫秒的完整时间', () => {
      model.setConfig({ format: 'YYYY-MM-DD HH:mm:ss{.SSS}' });
      const lines = [
        '2024-01-15 12:30:45.123 INFO test',
        '2024-01-15 12:30:46 INFO test',
      ];
      model.parseTimestamps(lines);
      assert.ok(model.getTimestamp(0) instanceof Date);
      assert.strictEqual(model.getTimestamp(0)!.getMilliseconds(), 123);
      assert.ok(model.getTimestamp(1) instanceof Date);
      assert.strictEqual(model.getTimestamp(1)!.getMilliseconds(), 0);
    });
  });

  // ===== 折叠区间富化 =====
  describe('enrichFoldRanges', () => {
    it('为折叠区间计算时间元数据', () => {
      model.setConfig({ format: 'HH:mm:ss' });
      const lines = [
        '10:00:00 INFO Matched line 0',
        '10:00:01 DEBUG Unmatched 1',
        '10:00:02 DEBUG Unmatched 2',
        '10:00:05 INFO Matched line 3',
        '10:00:06 DEBUG Unmatched 4',
        '10:00:07 DEBUG Unmatched 5',
        '10:00:08 DEBUG Unmatched 6',
        '10:00:10 INFO Matched line 7',
      ];
      model.parseTimestamps(lines);

      const ranges = [
        { start: 1, end: 2 },
        { start: 4, end: 6 },
      ];
      const result = model.enrichFoldRanges(ranges, lines.length);

      assert.strictEqual(result.length, 2);

      assert.strictEqual(result[0].lineCount, 2);
      assert.ok(result[0].timeFrom instanceof Date);
      assert.strictEqual(result[0].timeFrom!.getSeconds(), 0);
      assert.ok(result[0].timeTo instanceof Date);
      assert.strictEqual(result[0].timeTo!.getSeconds(), 5);
      assert.strictEqual(result[0].durationMs, 5000);

      assert.strictEqual(result[1].lineCount, 3);
      assert.ok(result[1].timeFrom instanceof Date);
      assert.strictEqual(result[1].timeFrom!.getSeconds(), 5);
      assert.ok(result[1].timeTo instanceof Date);
      assert.strictEqual(result[1].timeTo!.getSeconds(), 10);
      assert.strictEqual(result[1].durationMs, 5000);
    });

    it('文件开头无前置时间时 timeFrom 为 undefined', () => {
      model.setConfig({ format: 'HH:mm:ss' });
      const lines = [
        'no time here',
        '10:00:01 first time',
      ];
      model.parseTimestamps(lines);
      const ranges = [{ start: 0, end: 0 }];
      const result = model.enrichFoldRanges(ranges, lines.length);
      assert.strictEqual(result[0].timeFrom, undefined);
      assert.ok(result[0].timeTo instanceof Date);
    });

    it('文件末尾无后置时间时 timeTo 为 undefined', () => {
      model.setConfig({ format: 'HH:mm:ss' });
      const lines = [
        '10:00:00 time here',
        'no time after',
      ];
      model.parseTimestamps(lines);
      const ranges = [{ start: 1, end: 1 }];
      const result = model.enrichFoldRanges(ranges, lines.length);
      assert.ok(result[0].timeFrom instanceof Date);
      assert.strictEqual(result[0].timeTo, undefined);
    });
  });

  // ===== 边界情况 =====
  describe('边界情况', () => {
    it('空格式字符串 isConfigured 为 false', () => {
      model.setConfig({ format: '' });
      assert.strictEqual(model.isConfigured(), false);
    });

    it('setConfig 后再调用可正确重置', () => {
      model.setConfig({ format: 'YYYY' });
      assert.strictEqual(model.isConfigured(), true);
      model.setConfig({ format: '' });
      assert.strictEqual(model.isConfigured(), false);
    });

    it('格式中花括号不匹配时当作普通字符', () => {
      const segs = model.parseFormat('YYYY-MM-DD HH:mm:ss{');
      const lastSeg = segs[segs.length - 1];
      assert.deepStrictEqual(lastSeg, { type: 'literal', value: '{' });
    });

    it('格式中空格和符号作为字面量解析', () => {
      const segs = model.parseFormat('YYYY/MM/DD');
      assert.strictEqual(segs.length, 5);
      assert.deepStrictEqual(segs[1], { type: 'literal', value: '/' });
      assert.deepStrictEqual(segs[3], { type: 'literal', value: '/' });
    });
  });
});
