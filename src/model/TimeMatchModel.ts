// TimeMatchModel — 时间匹配引擎：直接从行文本开头逐字符解析时间戳
// 仅按需解析折叠边界行，不扫描全文
import { TimePatternConfig, FoldRange } from '../types';

/** 格式解析内部节点 */
type FormatSegment =
  | { type: 'token'; value: string }
  | { type: 'literal'; value: string }
  | { type: 'optional'; segments: FormatSegment[] };

/** 支持的格式 token → 数字位数 */
const TOKEN_DIGITS: Record<string, number> = {
  YYYY: 4, YY: 2, MM: 2, DD: 2,
  HH: 2, mm: 2, ss: 2, SSS: 3,
};

/** walk 返回值 */
interface WalkResult {
  values: Record<string, number>;
  endPos: number;
}

export class TimeMatchModel {
  private format: string = '';
  private formatSegments: FormatSegment[] = [];

  /** 设置时间匹配配置 */
  setConfig(config: TimePatternConfig): void {
    this.format = config.format;
    this.formatSegments = [];
    if (this.format) {
      this.formatSegments = this.parseFormat(this.format);
    }
  }

  /** 获取配置 */
  getConfig(): TimePatternConfig {
    return { format: this.format };
  }

  /** 是否已配置时间匹配 */
  isConfigured(): boolean {
    return this.formatSegments.length > 0;
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
    const firstMatchTime = this.findFirstMatchTime(lines);
    return ranges.map(r => {
      const timeFrom = this.findTimeBefore(r.start, lines);
      const timeTo = this.findTimeAfter(r.end, lines, totalLines);
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

  /** 从第 0 行开始查找第一个匹配行的时间 */
  private findFirstMatchTime(lines: string[]): Date | undefined {
    for (let i = 0; i < lines.length; i++) {
      const date = this.parseLineTimestamp(lines[i]);
      if (date) { return date; }
    }
    return undefined;
  }

  /** 从指定行向前查找最近的时间戳（按需解析） */
  private findTimeBefore(line: number, lines: string[]): Date | undefined {
    for (let i = line - 1; i >= 0; i--) {
      const date = this.parseLineTimestamp(lines[i]);
      if (date) { return date; }
    }
    return undefined;
  }

  /** 从指定行向后查找最近的时间戳（按需解析） */
  private findTimeAfter(line: number, lines: string[], totalLines: number): Date | undefined {
    for (let i = line + 1; i < totalLines; i++) {
      const date = this.parseLineTimestamp(lines[i]);
      if (date) { return date; }
    }
    return undefined;
  }

  /** 解析单行的时间戳，失败返回 null */
  private parseLineTimestamp(line: string): Date | null {
    const result = walkSegments(line, this.formatSegments, 0);
    if (!result) { return null; }
    return buildDate(result.values);
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
 */
function walkSegments(str: string, segments: FormatSegment[], startPos: number): WalkResult | null {
  let pos = startPos;
  const values: Record<string, number> = {};

  for (const seg of segments) {
    if (str.length < pos) { return null; }

    if (seg.type === 'literal') {
      if (str.substring(pos, pos + seg.value.length) !== seg.value) {
        return null;
      }
      pos += seg.value.length;
    } else if (seg.type === 'token') {
      const digits = TOKEN_DIGITS[seg.value];
      if (pos + digits > str.length) { return null; }
      const val = parseInt(str.substring(pos, pos + digits), 10);
      if (isNaN(val)) { return null; }
      values[seg.value] = val;
      pos += digits;
    } else if (seg.type === 'optional') {
      const optResult = walkSegments(str, seg.segments, pos);
      if (optResult) {
        Object.assign(values, optResult.values);
        pos = optResult.endPos;
      }
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
  const second = values['ss'] ?? 0;
  const ms = values['SSS'] ?? 0;

  const date = new Date(year, month - 1, day, hour, minute, second, ms);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}
