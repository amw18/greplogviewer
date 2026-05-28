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

  // ===== Bug Fix #1: 6-digit microsecond (SSSSSS) =====
  describe('SSSSSS — 6位微秒', () => {
    it('解析 SSSSSS 格式', () => {
      const segs = model.parseFormat('HH:mm:ss.SSSSSS');
      assert.strictEqual(segs.length, 7);
      assert.deepStrictEqual(segs[0], { type: 'token', value: 'HH' });
      assert.deepStrictEqual(segs[4], { type: 'token', value: 'ss' });
      assert.deepStrictEqual(segs[5], { type: 'literal', value: '.' });
      assert.deepStrictEqual(segs[6], { type: 'token', value: 'SSSSSS' });
    });

    it('解析 6 位微秒时间戳', () => {
      const segs = model.parseFormat('HH:mm:ss.SSSSSS');
      const result = model.parseDate('08:15:30.456789', segs);
      assert.ok(result instanceof Date);
      assert.strictEqual(result!.getSeconds(), 30);
      assert.strictEqual(result!.getMilliseconds(), 456);
    });

    it('6 位微秒与 3 位毫秒并存时优先匹配长的', () => {
      const segs = model.parseFormat('HH:mm:ss.SSSSSS');
      // parseFormat 应优先匹配 SSSSSS 而非两次 SSS
      const tokenSegs = segs.filter(s => s.type === 'token');
      assert.strictEqual(tokenSegs[tokenSegs.length - 1].value, 'SSSSSS');
    });
  });

  // ===== Bug Fix #1: 可变宽度秒数 (s) =====
  describe('s token — 可变宽度秒数', () => {
    it('解析格式 s.SSSSSS', () => {
      const segs = model.parseFormat('s.SSSSSS');
      assert.strictEqual(segs.length, 3);
      assert.deepStrictEqual(segs[0], { type: 'token', value: 's' });
      assert.deepStrictEqual(segs[1], { type: 'literal', value: '.' });
    });

    it('s 读取多位秒数 (3 digits)', () => {
      const segs = model.parseFormat('[s.SSSSSS]');
      const result = model.parseDate('[123.456789]', segs);
      assert.ok(result instanceof Date);
      // 123 seconds → 2m 3s after Date normalization
      assert.strictEqual(result!.getMinutes(), 2);
      assert.strictEqual(result!.getSeconds(), 3);
      assert.strictEqual(result!.getMilliseconds(), 456);
    });

    it('s 读取单位秒数 (1 digit)', () => {
      const segs = model.parseFormat('[s.SSSSSS]');
      const result = model.parseDate('[0.000000]', segs);
      assert.ok(result instanceof Date);
      assert.strictEqual(result!.getSeconds(), 0);
      assert.strictEqual(result!.getMilliseconds(), 0);
    });

    it('s 读取多位秒数 (5 digits)', () => {
      const segs = model.parseFormat('[s.SSSSSS]');
      const result = model.parseDate('[12345.678901]', segs);
      assert.ok(result instanceof Date);
      // 12345 seconds → 3h 25m 45s
      assert.strictEqual(result!.getHours(), 3);
      assert.strictEqual(result!.getMinutes(), 25);
      assert.strictEqual(result!.getSeconds(), 45);
      assert.strictEqual(result!.getMilliseconds(), 678);
    });

    it('s 后无数字时返回 null', () => {
      const segs = model.parseFormat('s');
      const result = model.parseDate('', segs);
      assert.strictEqual(result, null);
    });

    it('ss 仍然保持 2 位固定宽度', () => {
      const segs = model.parseFormat('HH:mm:ss');
      const result = model.parseDate('10:30:05', segs);
      assert.ok(result instanceof Date);
      assert.strictEqual(result!.getSeconds(), 5);
    });
  });

  // ===== Bug Fix #1: 连续空格合并 + token 前空白跳过 =====
  describe('空白处理 — Linux Kernel 格式', () => {
    it('parseFormat 合并连续空格为 whitespace 段', () => {
      const segs = model.parseFormat('[    s.SSSSSS]');
      assert.strictEqual(segs.length, 6);
      assert.deepStrictEqual(segs[0], { type: 'literal', value: '[' });
      assert.deepStrictEqual(segs[1], { type: 'whitespace' });
      assert.deepStrictEqual(segs[2], { type: 'token', value: 's' });
      assert.deepStrictEqual(segs[3], { type: 'literal', value: '.' });
      assert.deepStrictEqual(segs[4], { type: 'token', value: 'SSSSSS' });
      assert.deepStrictEqual(segs[5], { type: 'literal', value: ']' });
    });

    it('单个空格保留为字面量', () => {
      const segs = model.parseFormat('HH:mm:ss');
      // 无空格，所有段都不是 whitespace
      assert.strictEqual(segs.every(s => s.type !== 'whitespace'), true);
    });

    it('Linux kernel 格式 [    s.SSSSSS] 匹配 [    0.000000]', () => {
      model.setConfig({ format: '[    s.SSSSSS]' });
      const lines = [
        '[    0.000000] Matched line 0',
        'no match',
        '[    1.500000] Matched line 2',
      ];
      const result = model.computeFoldRanges(
        [{ start: 1, end: 1 }], lines, lines.length
      );
      assert.ok(result[0].timeFrom instanceof Date);
      assert.strictEqual(result[0].timeFrom!.getSeconds(), 0);
      assert.ok(result[0].timeTo instanceof Date);
      assert.strictEqual(result[0].timeTo!.getSeconds(), 1);
      assert.strictEqual(result[0].durationMs, 1500);
    });

    it('Linux kernel 格式 [    s.SSSSSS] 匹配 [  123.456789]（较少空格）', () => {
      model.setConfig({ format: '[    s.SSSSSS]' });
      const lines = [
        '[    0.000000] Matched line 0',
        'no match',
        '[  123.456789] Matched line 2',
      ];
      const result = model.computeFoldRanges(
        [{ start: 1, end: 1 }], lines, lines.length
      );
      assert.ok(result[0].timeFrom instanceof Date);
      assert.strictEqual(result[0].timeFrom!.getSeconds(), 0);
      assert.ok(result[0].timeTo instanceof Date);
      // 123 seconds → 2m 3s and 123000ms span
      assert.strictEqual(result[0].timeTo!.getMinutes(), 2);
      assert.strictEqual(result[0].timeTo!.getSeconds(), 3);
      assert.strictEqual(result[0].timeTo!.getMilliseconds(), 456);
    });

    it('token 前自动跳过空白（格式无空格，日志有空格也能匹配）', () => {
      model.setConfig({ format: '[s.SSSSSS]' });
      const lines = [
        '[    0.000000] Matched line 0',
        'no match',
        '[    1.500000] Matched line 2',
      ];
      const result = model.computeFoldRanges(
        [{ start: 1, end: 1 }], lines, lines.length
      );
      assert.ok(result[0].timeFrom instanceof Date);
      assert.ok(result[0].timeTo instanceof Date);
      assert.strictEqual(result[0].durationMs, 1500);
    });

    it('Linux kernel 格式 computeFoldRanges 完整流程', () => {
      model.setConfig({ format: '[    s.SSSSSS]' });
      const lines = [
        '[    0.000000] Kernel boot',
        'some unmatched log',
        'another unmatched',
        '[    2.500000] Another event',
        'unmatched again',
        '[    5.000000] Final event',
      ];
      const ranges = [
        { start: 1, end: 2 },
        { start: 4, end: 4 },
      ];
      const result = model.computeFoldRanges(ranges, lines, lines.length);

      assert.strictEqual(result.length, 2);
      // fold [1,2]: between [0.000] matched and [2.500] matched
      assert.strictEqual(result[0].lineCount, 2);
      assert.strictEqual(result[0].timeFrom!.getSeconds(), 0);
      assert.strictEqual(result[0].timeTo!.getSeconds(), 2);
      assert.strictEqual(result[0].durationMs, 2500);
      // fold [4,4]: between [2.500] matched and [5.000] matched
      assert.strictEqual(result[1].lineCount, 1);
      assert.strictEqual(result[1].timeFrom!.getSeconds(), 2);
      assert.strictEqual(result[1].timeTo!.getSeconds(), 5);
      assert.strictEqual(result[1].durationMs, 2500);
    });
  });

  // ===== Bug Fix #2 & #3: 仅搜索匹配行的时间 =====
  describe('匹配行限定 — firstMatchTime/timeBefore/timeAfter 仅搜索匹配行', () => {
    it('firstMatchTime 跳过折叠行，从第一个匹配行开始', () => {
      model.setConfig({ format: 'HH:mm:ss' });
      const lines = [
        '10:00:00 Folded line 0',   // 折叠（未匹配）但有时间戳
        '10:00:00 Folded line 1',   // 折叠
        '10:00:05 Matched line 2',  // 第一个匹配行
      ];
      const ranges = [{ start: 0, end: 1 }]; // lines 0,1 折叠
      const result = model.computeFoldRanges(ranges, lines, lines.length);
      // firstMatchTime 应为匹配行 (line 2) 的时间，不是折叠行 (line 0) 的
      assert.ok(result[0].firstMatchTime instanceof Date);
      assert.strictEqual(result[0].firstMatchTime!.getSeconds(), 5);
    });

    it('findTimeBefore 跳过折叠行查找前一个匹配行', () => {
      model.setConfig({ format: 'HH:mm:ss' });
      const lines = [
        '10:00:00 Folded line 0',   // 折叠（有 timestamp）
        '10:00:03 Matched line 1',  // 匹配
        '10:00:05 Folded line 2',   // 折叠
        '10:00:10 Matched line 3',  // 匹配
      ];
      const ranges = [
        { start: 0, end: 0 },   // line 0 折叠
        { start: 2, end: 2 },   // line 2 折叠
      ];
      const result = model.computeFoldRanges(ranges, lines, lines.length);
      // fold [2,2] 的 timeFrom 应为 line 1 (匹配行) 的 10:00:03，而非 line 0 (折叠行) 的 10:00:00
      assert.strictEqual(result.length, 2);
      assert.ok(result[1].timeFrom instanceof Date);
      // line 0 是折叠行，应被跳过；line 1 是匹配行
      assert.strictEqual(result[1].timeFrom!.getSeconds(), 3);
    });

    it('findTimeAfter 跳过折叠行查找后一个匹配行', () => {
      model.setConfig({ format: 'HH:mm:ss' });
      const lines = [
        '10:00:00 Matched line 0',
        '10:00:05 Folded line 1',   // 折叠（有 timestamp）
        '10:00:07 Folded line 2',   // 折叠（有 timestamp）
        'no time Matched line 3',   // 匹配但无时间戳
        '10:00:15 Matched line 4',
      ];
      const ranges = [{ start: 1, end: 2 }];
      const result = model.computeFoldRanges(ranges, lines, lines.length);
      // fold [1,2] 的 timeTo 应跳过折叠行 (line 1,2) 和 line 3（无时间戳），到 line 4
      assert.ok(result[0].timeTo instanceof Date);
      assert.strictEqual(result[0].timeTo!.getSeconds(), 15);
    });

    it('折叠行的时间戳不会影响 elapsed time 计算', () => {
      model.setConfig({ format: 'HH:mm:ss' });
      const lines = [
        '10:00:00 Folded line 0',  // 折叠（有 timestamp）→ 应该被跳过
        '10:00:05 Matched line 1',
      ];
      const ranges = [{ start: 0, end: 0 }];
      const result = model.computeFoldRanges(ranges, lines, lines.length);
      // fold [0,0] 的 timeFrom 为 undefined（前面无匹配行）
      assert.strictEqual(result[0].timeFrom, undefined);
      // firstMatchTime 应为匹配行 line 1 的时间
      assert.ok(result[0].firstMatchTime instanceof Date);
      assert.strictEqual(result[0].firstMatchTime!.getSeconds(), 5);
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
