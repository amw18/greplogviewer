// 测试 — TimeMatchModel 时间匹配与解析
import { strict as assert } from 'assert';
import { TimeMatchModel } from '../src/model/TimeMatchModel';

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
      assert.strictEqual(segs.length, 13);
      assert.deepStrictEqual(segs[0], { type: 'literal', value: '[' });
      assert.deepStrictEqual(segs[segs.length - 1], { type: 'literal', value: ']' });
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

  // ===== computeFoldRanges — 仅解析边界行 =====
  describe('computeFoldRanges', () => {
    it('为折叠区间计算时间元数据（仅解析边界行）', () => {
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

      const ranges = [
        { start: 1, end: 2 },
        { start: 4, end: 6 },
      ];
      const result = model.computeFoldRanges(ranges, lines, lines.length);

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
      const result = model.computeFoldRanges(
        [{ start: 0, end: 0 }], lines, lines.length
      );
      assert.strictEqual(result[0].timeFrom, undefined);
      assert.ok(result[0].timeTo instanceof Date);
    });

    it('文件末尾无后置时间时 timeTo 为 undefined', () => {
      model.setConfig({ format: 'HH:mm:ss' });
      const lines = [
        '10:00:00 time here',
        'no time after',
      ];
      const result = model.computeFoldRanges(
        [{ start: 1, end: 1 }], lines, lines.length
      );
      assert.ok(result[0].timeFrom instanceof Date);
      assert.strictEqual(result[0].timeTo, undefined);
    });

    it('跨越多行查找边界时间', () => {
      model.setConfig({ format: 'HH:mm:ss' });
      const lines = [
        '10:00:00 first',
        'no time',
        'no time',
        '10:00:10 second',
      ];
      // 折叠区间 [1,2]，边界应为 line 0 和 line 3
      const result = model.computeFoldRanges(
        [{ start: 1, end: 2 }], lines, lines.length
      );
      assert.strictEqual(result[0].timeFrom!.getSeconds(), 0);
      assert.strictEqual(result[0].timeTo!.getSeconds(), 10);
      assert.strictEqual(result[0].durationMs, 10000);
    });

    it('带方括号格式仅解析边界行', () => {
      model.setConfig({ format: '[YYYY-MM-DD HH:mm:ss]' });
      const lines = [
        '[2023-01-01 10:00:00] start',
        'no match',
        '[2023-01-01 10:00:05] end',
      ];
      const result = model.computeFoldRanges(
        [{ start: 1, end: 1 }], lines, lines.length
      );
      assert.ok(result[0].timeFrom instanceof Date);
      assert.strictEqual(result[0].timeFrom!.getSeconds(), 0);
      assert.ok(result[0].timeTo instanceof Date);
      assert.strictEqual(result[0].timeTo!.getSeconds(), 5);
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
