// TimeMatchModel — 时间匹配引擎：直接从行文本开头逐字符解析时间戳
// 无需生成正则，直接用格式 segment 树 walk 匹配
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
  /** token → 解析出的数值 */
  values: Record<string, number>;
  /** 匹配结束后在字符串中的位置 */
  endPos: number;
}

export class TimeMatchModel {
  private format: string = '';
  private formatSegments: FormatSegment[] = [];
  private timestamps = new Map<number, Date>();

  /** 设置时间匹配配置 */
  setConfig(config: TimePatternConfig): void {
    this.format = config.format;
    this.formatSegments = [];
    this.timestamps.clear();

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
   * 解析所有行的时间戳（从行首直接 walk 匹配，无需正则）
   */
  parseTimestamps(lines: string[], startLine?: number, endLine?: number): void {
    this.timestamps.clear();
    if (this.formatSegments.length === 0) { return; }

    const scanStart = startLine !== undefined ? Math.max(0, startLine - 1) : 0;
    const scanEnd = endLine !== undefined ? Math.min(lines.length, endLine) : lines.length;

    for (let i = scanStart; i < scanEnd; i++) {
      const result = walkSegments(lines[i], this.formatSegments, 0);
      if (result) {
        const date = this.buildDate(result.values);
        if (date) {
          this.timestamps.set(i, date);
        }
      }
    }
  }

  /** 获取指定行的时间戳 */
  getTimestamp(lineNumber: number): Date | undefined {
    return this.timestamps.get(lineNumber);
  }

  /**
   * 为未匹配区间填充时间元数据
   */
  enrichFoldRanges(ranges: Array<{ start: number; end: number }>, totalLines: number): FoldRange[] {
    return ranges.map(r => {
      const timeFrom = this.findNearestBefore(r.start);
      const timeTo = this.findNearestAfter(r.end, totalLines);
      return {
        start: r.start,
        end: r.end,
        lineCount: r.end - r.start + 1,
        timeFrom,
        timeTo,
        durationMs: timeFrom && timeTo ? timeTo.getTime() - timeFrom.getTime() : undefined,
      };
    });
  }

  /** 从指定行向前查找最近的时间戳 */
  private findNearestBefore(line: number): Date | undefined {
    for (let i = line - 1; i >= 0; i--) {
      const ts = this.timestamps.get(i);
      if (ts) { return ts; }
    }
    return undefined;
  }

  /** 从指定行向后查找最近的时间戳 */
  private findNearestAfter(line: number, totalLines: number): Date | undefined {
    for (let i = line + 1; i < totalLines; i++) {
      const ts = this.timestamps.get(i);
      if (ts) { return ts; }
    }
    return undefined;
  }

  // ===== 格式字符串解析 =====

  /** 解析格式字符串为结构化的 segment 树 */
  parseFormat(format: string): FormatSegment[] {
    const segments: FormatSegment[] = [];
    let i = 0;

    while (i < format.length) {
      // 可选组 {...}
      if (format[i] === '{') {
        const end = this.findMatchingBrace(format, i);
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

      // 检查 token
      const token = this.matchToken(format, i);
      if (token) {
        segments.push({ type: 'token', value: token });
        i += token.length;
        continue;
      }

      // 普通字符
      segments.push({ type: 'literal', value: format[i] });
      i++;
    }

    return segments;
  }

  /** 查找匹配的 } 括号 */
  private findMatchingBrace(format: string, start: number): number {
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
  private matchToken(format: string, pos: number): string | null {
    const tokens = Object.keys(TOKEN_DIGITS).sort((a, b) => b.length - a.length);
    for (const token of tokens) {
      if (format.startsWith(token, pos)) {
        return token;
      }
    }
    return null;
  }

  // ===== 日期解析（基于 walk） =====

  /**
   * 解析时间字符串为 Date（字符串需完整匹配整个格式，用于测试）
   * @param timeStr 纯时间字符串（不含后续文本）
   * @param segments 格式 segment 树
   */
  parseDate(timeStr: string, segments: FormatSegment[]): Date | null {
    const result = walkSegments(timeStr, segments, 0);
    // 必须完整匹配整个字符串
    if (!result || result.endPos !== timeStr.length) { return null; }
    return this.buildDate(result.values);
  }

  /** 从解析出的 token 数值构建 Date，并验证合法性 */
  private buildDate(values: Record<string, number>): Date | null {
    const year = values['YYYY'] ?? (values['YY'] !== undefined ? 2000 + values['YY'] : 2000);
    const month = values['MM'] ?? 1;
    const day = values['DD'] ?? 1;
    const hour = values['HH'] ?? 0;
    const minute = values['mm'] ?? 0;
    const second = values['ss'] ?? 0;
    const ms = values['SSS'] ?? 0;

    const date = new Date(year, month - 1, day, hour, minute, second, ms);
    // 验证日期合法性（new Date 会溢出如 2月30日 → 3月2日）
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      return null;
    }
    return date;
  }
}

// ===== 核心 walk 函数（纯函数，不依赖实例） =====

/**
 * 从字符串指定位置开始，按 segment 树逐字符匹配。
 * 字面量直接比对；token 读取指定位数数字；可选组尝试匹配，失败则跳过。
 * @returns 匹配成功返回 { values, endPos }，失败返回 null
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
        // 可选组匹配成功，合并值并前进
        Object.assign(values, optResult.values);
        pos = optResult.endPos;
      }
      // 可选组匹配失败，跳过不推进 pos
    }
  }

  return { values, endPos: pos };
}
