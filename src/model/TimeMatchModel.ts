// TimeMatchModel — 时间匹配引擎：直接从行文本开头逐字符解析时间戳
// 仅按需解析折叠边界行，不扫描全文
import { TimePatternConfig, FoldRange } from '../types';

/** 格式解析内部节点 */
type FormatSegment =
  | { type: 'token'; value: string }
  | { type: 'literal'; value: string }
  | { type: 'optional'; segments: FormatSegment[] }
  | { type: 'whitespace' }
  | { type: 'wildcard' };

/** 支持的格式 token → 数字位数（0 = 可变宽度） */
const TOKEN_DIGITS: Record<string, number> = {
  SSSSSS: 6, YYYY: 4, YY: 2, MM: 2, DD: 2,
  HH: 2, mm: 2, ss: 2, SSS: 3,
  s: 0,
};

/** walk 返回值 */
interface WalkResult {
  values: Record<string, number>;
  endPos: number;
}

export class TimeMatchModel {
  private format: string = '';
  private additionalFormats: string[] = [];
  private formatSegmentLists: FormatSegment[][] = [];

  /** 设置时间匹配配置（支持主格式 + 附加格式） */
  setConfig(config: TimePatternConfig): void {
    this.format = config.format;
    this.additionalFormats = config.additionalFormats || [];
    this.formatSegmentLists = [];
    const allFormats = [this.format, ...this.additionalFormats];
    for (const fmt of allFormats) {
      if (fmt) {
        this.formatSegmentLists.push(this.parseFormat(fmt));
      }
    }
  }

  /** 获取配置 */
  getConfig(): TimePatternConfig {
    const cfg: TimePatternConfig = { format: this.format };
    if (this.additionalFormats.length > 0) {
      cfg.additionalFormats = [...this.additionalFormats];
    }
    return cfg;
  }

  /** 是否已配置时间匹配 */
  isConfigured(): boolean {
    return this.formatSegmentLists.length > 0;
  }

  /**
   * 从日志行自动检测时间格式。
   * 采样前 20 行，按优先级尝试常见格式模板，收集所有匹配到的格式。
   * @returns 检测到的格式配置（含附加格式），未检测到返回 null
   */
  autoDetect(lines: string[]): TimePatternConfig | null {
    if (lines.length === 0) { return null; }

    // 常见格式按优先级排序（覆盖 Android / Kernel 等常见日志）
    const formats = [
      '[YYYY-MM-DD HH:mm:ss.SSS]',
      '[YYYY-MM-DD HH:mm:ss]',
      '[YY-MM-DD HH:mm:ss.SSS]',
      '[YY-MM-DD HH:mm:ss]',
      'YYYY-MM-DD HH:mm:ss.SSS',
      'YYYY-MM-DD HH:mm:ss',
      'MM-DD HH:mm:ss.SSS',
      'MM-DD HH:mm:ss',
      'HH:mm:ss.SSS',
      'HH:mm:ss',
      '[*:    s.SSSSSS]',
      '[    s.SSSSSS]',
    ];

    const sampleSize = Math.min(20, lines.length);
    const minMatches = Math.min(3, sampleSize);
    const matchedFormats: string[] = [];
    const coveredLines = new Set<number>();

    for (const format of formats) {
      const segments = this.parseFormat(format);
      const matchedLines = new Set<number>();
      for (let i = 0; i < sampleSize; i++) {
        const result = walkSegments(lines[i], segments, 0);
        if (result) { matchedLines.add(i); }
      }
      if (matchedLines.size === 0) { continue; }

      // 选择能为未覆盖行提供新解析能力的格式
      let newCoverage = 0;
      for (const idx of matchedLines) {
        if (!coveredLines.has(idx)) { newCoverage++; }
      }
      if (newCoverage > 0) {
        matchedFormats.push(format);
        for (const idx of matchedLines) { coveredLines.add(idx); }
      }
    }

    if (coveredLines.size < minMatches) { return null; }
    const cfg: TimePatternConfig = { format: matchedFormats[0] };
    if (matchedFormats.length > 1) {
      cfg.additionalFormats = matchedFormats.slice(1);
    }
    return cfg;
  }

  /**
   * 为折叠区间计算时间元数据（仅解析边界行）
   * @param ranges 未匹配行区间
   * @param lines 文档所有行
   * @param totalLines 总行数
   */
  computeFoldRanges(
    ranges: Array<{ start: number; end: number }>,
    lines: string[],
    totalLines: number
  ): FoldRange[] {
    // 构建匹配行（非折叠行）的行号集合
    const matchedSet = buildMatchedLineSet(ranges, totalLines);
    const firstMatchTime = this.findFirstMatchTime(lines, matchedSet);
    return ranges.map(r => {
      const timeFrom = this.findTimeBefore(r.start, lines, matchedSet);
      const timeTo = this.findTimeAfter(r.end, lines, totalLines, matchedSet);
      return {
        start: r.start,
        end: r.end,
        lineCount: r.end - r.start + 1,
        timeFrom,
        timeTo,
        durationMs: timeFrom && timeTo ? timeTo.getTime() - timeFrom.getTime() : undefined,
        firstMatchTime,
      };
    });
  }

  /**
   * 计算指定行范围内的时间信息
   * @returns {{ startTime, endTime, durationMs }} 范围内首个和最后一个匹配行的时间及跨度
   */
  computeRangeTimeInfo(
    matchedLines: number[],
    lines: string[]
  ): { startTime?: Date; endTime?: Date; durationMs?: number } | undefined {
    if (matchedLines.length === 0) { return undefined; }

    const firstLine = matchedLines[0];
    const lastLine = matchedLines[matchedLines.length - 1];

    const startTime = this.parseLineTimestamp(lines[firstLine]);
    if (!startTime) { return undefined; }

    if (firstLine === lastLine) {
      return { startTime, endTime: startTime, durationMs: 0 };
    }

    const endTime = this.parseLineTimestamp(lines[lastLine]);
    if (!endTime) { return { startTime, durationMs: undefined } as any; }

    return {
      startTime,
      endTime,
      durationMs: endTime.getTime() - startTime.getTime(),
    };
  }

  /** 从第一个匹配（非折叠）行开始查找时间戳 */
  private findFirstMatchTime(lines: string[], matchedSet: Set<number>): Date | undefined {
    for (let i = 0; i < lines.length; i++) {
      if (!matchedSet.has(i)) { continue; }
      const date = this.parseLineTimestamp(lines[i]);
      if (date) { return date; }
    }
    return undefined;
  }

  /** 从指定行向前查找最近的匹配行时间戳 */
  private findTimeBefore(line: number, lines: string[], matchedSet: Set<number>): Date | undefined {
    for (let i = line - 1; i >= 0; i--) {
      if (!matchedSet.has(i)) { continue; }
      const date = this.parseLineTimestamp(lines[i]);
      if (date) { return date; }
    }
    return undefined;
  }

  /** 从指定行向后查找最近的匹配行时间戳 */
  private findTimeAfter(line: number, lines: string[], totalLines: number, matchedSet: Set<number>): Date | undefined {
    for (let i = line + 1; i < totalLines; i++) {
      if (!matchedSet.has(i)) { continue; }
      const date = this.parseLineTimestamp(lines[i]);
      if (date) { return date; }
    }
    return undefined;
  }

  /** 解析单行的时间戳，失败返回 null */
  /** 从行文本中提取时间戳（供 Timeline 等外部调用） */
  parseLineTimestamp(line: string): Date | null {
    for (const segments of this.formatSegmentLists) {
      const result = walkSegments(line, segments, 0);
      if (result) {
        const date = buildDate(result.values);
        if (date) { return date; }
      }
    }
    return null;
  }

  /**
   * 检测 ring buffer 日志的时间起点行。
   * 从第一行（或第一个可解析时间戳的行）开始作为时间原点，
   * 向下扫描，返回第一个时间戳小于上一可解析行时间戳的行号。
   * @param lines 文档所有行
   * @returns 起点行号（0-based），未识别返回 undefined
   */
  detectRingBufferStartLine(lines: string[]): number | undefined {
    if (!this.isConfigured() || lines.length === 0) { return undefined; }

    let previousTime: Date | null = null;
    let previousLine = -1;

    // Step 1: 确定默认时间原点（第一行或可解析时间戳的第一行）
    for (let i = 0; i < lines.length; i++) {
      const t = this.parseLineTimestamp(lines[i]);
      if (t) { previousTime = t; previousLine = i; break; }
    }
    if (!previousTime) { return undefined; }

    // Step 2: 从原点继续向下扫描，寻找第一个相对时间为负值的行
    for (let i = previousLine + 1; i < lines.length; i++) {
      const t = this.parseLineTimestamp(lines[i]);
      if (!t) { continue; }
      if (t.getTime() < previousTime.getTime()) {
        return i;
      }
      previousTime = t;
      previousLine = i;
    }

    return undefined;
  }

  // ===== 格式字符串解析 =====

  /** 解析格式字符串为结构化的 segment 树 */
  parseFormat(format: string): FormatSegment[] {
    const segments: FormatSegment[] = [];
    let i = 0;

    while (i < format.length) {
      if (format[i] === '{') {
        const end = findMatchingBrace(format, i);
        if (end === -1) {
          segments.push({ type: 'literal', value: format[i] });
          i++;
        } else {
          const inner = format.slice(i + 1, end);
          segments.push({ type: 'optional', segments: this.parseFormat(inner) });
          i = end + 1;
        }
        continue;
      }

      // 合并连续空格为灵活空白段（处理 linux kernel 等可变宽度填充）
      if (format[i] === ' ') {
        let j = i + 1;
        while (j < format.length && format[j] === ' ') { j++; }
        if (j - i >= 2) {
          segments.push({ type: 'whitespace' });
          i = j;
          continue;
        }
        // 单个空格保留为字面量
        segments.push({ type: 'literal', value: ' ' });
        i++;
        continue;
      }

      // 通配符：匹配任意字符直到下一个 token/literal
      if (format[i] === '*') {
        segments.push({ type: 'wildcard' });
        i++;
        continue;
      }

      const token = matchToken(format, i);
      if (token) {
        segments.push({ type: 'token', value: token });
        i += token.length;
        continue;
      }

      segments.push({ type: 'literal', value: format[i] });
      i++;
    }

    return segments;
  }

  /**
   * 解析时间字符串为 Date（字符串需完整匹配整个格式，用于测试）
   */
  parseDate(timeStr: string, segments: FormatSegment[]): Date | null {
    const result = walkSegments(timeStr, segments, 0);
    if (!result || result.endPos !== timeStr.length) { return null; }
    return buildDate(result.values);
  }
}

// ===== 纯函数 =====

/** 查找匹配的 } 括号 */
function findMatchingBrace(format: string, start: number): number {
  let depth = 0;
  for (let i = start; i < format.length; i++) {
    if (format[i] === '{') { depth++; }
    else if (format[i] === '}') {
      depth--;
      if (depth === 0) { return i; }
    }
  }
  return -1;
}

/** 尝试从指定位置匹配已知 token */
function matchToken(format: string, pos: number): string | null {
  const tokens = Object.keys(TOKEN_DIGITS).sort((a, b) => b.length - a.length);
  for (const token of tokens) {
    if (format.startsWith(token, pos)) {
      return token;
    }
  }
  return null;
}

/**
 * 从字符串指定位置开始，按 segment 树逐字符匹配。
 * 字面量直接比对；token 读取指定位数数字；可选组尝试匹配，失败则跳过。
 * 连续空格段（whitespace）跳过任意数量空格；token 前自动跳过空格以兼容可变填充。
 */
function walkSegments(str: string, segments: FormatSegment[], startPos: number): WalkResult | null {
  let pos = startPos;
  const values: Record<string, number> = {};

  for (let segIndex = 0; segIndex < segments.length; segIndex++) {
    const seg = segments[segIndex];
    if (str.length < pos) { return null; }

    if (seg.type === 'whitespace') {
      // 灵活空白：跳过任意数量的空格
      while (pos < str.length && str[pos] === ' ') { pos++; }
    } else if (seg.type === 'literal') {
      if (str.substring(pos, pos + seg.value.length) !== seg.value) {
        return null;
      }
      pos += seg.value.length;
    } else if (seg.type === 'token') {
      // token 前跳过空白（处理无固定空白的格式，如 linux kernel [ 123.456]）
      while (pos < str.length && str[pos] === ' ') { pos++; }
      if (seg.value === 's') {
        // 可变宽度秒数：贪婪读取连续数字
        let end = pos;
        while (end < str.length && /\d/.test(str[end])) { end++; }
        if (end === pos) { return null; }
        const val = parseInt(str.substring(pos, end), 10);
        if (isNaN(val)) { return null; }
        values['s'] = val;
        pos = end;
      } else {
        const digits = TOKEN_DIGITS[seg.value];
        if (pos + digits > str.length) { return null; }
        const val = parseInt(str.substring(pos, pos + digits), 10);
        if (isNaN(val)) { return null; }
        values[seg.value] = val;
        pos += digits;
      }
    } else if (seg.type === 'optional') {
      const optResult = walkSegments(str, seg.segments, pos);
      if (optResult) {
        Object.assign(values, optResult.values);
        pos = optResult.endPos;
      }
    } else if (seg.type === 'wildcard') {
      // 通配符：尝试从当前位置到字符串末尾的每个位置，找到第一个能让剩余 segment 匹配的位置
      const remainingSegments = segments.slice(segIndex + 1);
      let matched = false;
      for (let tryPos = pos; tryPos <= str.length; tryPos++) {
        const remainingResult = walkSegments(str, remainingSegments, tryPos);
        if (remainingResult) {
          Object.assign(values, remainingResult.values);
          pos = remainingResult.endPos;
          matched = true;
          break;
        }
      }
      if (!matched && remainingSegments.length > 0) { return null; }
      // 通配符已消耗剩余所有 segment，直接结束
      break;
    }
  }

  return { values, endPos: pos };
}

/** 从解析出的 token 数值构建 Date，并验证合法性 */
function buildDate(values: Record<string, number>): Date | null {
  const year = values['YYYY'] ?? (values['YY'] !== undefined ? 2000 + values['YY'] : 2000);
  const month = values['MM'] ?? 1;
  const day = values['DD'] ?? 1;
  const hour = values['HH'] ?? 0;
  const minute = values['mm'] ?? 0;
  const second = values['s'] ?? values['ss'] ?? 0;
  const micros = values['SSSSSS'];
  const ms = micros !== undefined ? Math.floor(micros / 1000) : (values['SSS'] ?? 0);

  const date = new Date(year, month - 1, day, hour, minute, second, ms);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

/** 从折叠区间集合构建匹配行号 Set（所有不在任何折叠区间内的行） */
function buildMatchedLineSet(
  ranges: Array<{ start: number; end: number }>,
  totalLines: number
): Set<number> {
  const set = new Set<number>();
  for (let i = 0; i < totalLines; i++) { set.add(i); }
  for (const r of ranges) {
    for (let i = r.start; i <= r.end; i++) { set.delete(i); }
  }
  return set;
}
