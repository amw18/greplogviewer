// TimeMatchModel — 时间匹配引擎：从行文本开头提取时间戳
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

export class TimeMatchModel {
  private format: string = '';
  /** 行匹配正则：匹配整行开头的完整时间戳，捕获组 1 = 时间戳字符串 */
  private lineRegex: RegExp | null = null;
  private formatSegments: FormatSegment[] = [];
  private timestamps = new Map<number, Date>();

  /** 设置时间匹配配置 */
  setConfig(config: TimePatternConfig): void {
    this.format = config.format;
    this.lineRegex = null;
    this.formatSegments = [];
    this.timestamps.clear();

    if (this.format) {
      this.formatSegments = this.parseFormat(this.format);
      try {
        this.lineRegex = this.buildLineRegex(this.formatSegments);
      } catch {
        this.lineRegex = null;
      }
    }
  }

  /** 获取配置 */
  getConfig(): TimePatternConfig {
    return { format: this.format };
  }

  /** 是否已配置时间匹配 */
  isConfigured(): boolean {
    return this.format !== '' && this.lineRegex !== null;
  }

  /**
   * 解析所有行的时间戳
   * @param lines 所有行文本
   * @param startLine 扫描起始行（1-based）
   * @param endLine 扫描结束行（1-based）
   */
  parseTimestamps(lines: string[], startLine?: number, endLine?: number): void {
    this.timestamps.clear();
    if (!this.isConfigured() || !this.lineRegex) { return; }

    const scanStart = startLine !== undefined ? Math.max(0, startLine - 1) : 0;
    const scanEnd = endLine !== undefined ? Math.min(lines.length, endLine) : lines.length;

    for (let i = scanStart; i < scanEnd; i++) {
      const match = lines[i].match(this.lineRegex);
      if (match) {
        const date = this.parseDate(match[1], this.formatSegments);
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
   * timeFrom: 区间前最近一个匹配行的时间
   * timeTo:   区间后最近一个匹配行的时间
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
          // 括号不匹配，当作普通字符
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

  /** 从格式 segment 树构建行匹配正则（用于从行开头匹配并提取时间戳字符串） */
  buildLineRegex(segments: FormatSegment[]): RegExp {
    const pattern = this.buildLinePattern(segments);
    // 整个时间戳是一个捕获组，锚定在行首
    return new RegExp('^(' + pattern + ')');
  }

  /** 从 segment 树构建行匹配模式（不含捕获组和锚定） */
  private buildLinePattern(segments: FormatSegment[]): string {
    const parts: string[] = [];

    const walk = (segs: FormatSegment[]): void => {
      for (const seg of segs) {
        if (seg.type === 'token') {
          parts.push(`\\d{${TOKEN_DIGITS[seg.value]}}`);
        } else if (seg.type === 'literal') {
          parts.push(this.escapeRegex(seg.value));
        } else if (seg.type === 'optional') {
          parts.push('(?:' + this.buildLinePattern(seg.segments) + ')?');
        }
      }
    };

    walk(segments);
    return parts.join('');
  }

  // ===== 日期解析 =====

  /**
   * 根据格式 segment 树解析时间字符串为 Date
   * @returns 解析成功返回 Date，失败返回 null
   */
  parseDate(timeStr: string, segments: FormatSegment[]): Date | null {
    const { regex, tokens } = this.buildMatchRegex(segments);
    const match = timeStr.match(regex);
    if (!match) { return null; }

    let year = 2000, month = 1, day = 1, hour = 0, minute = 0, second = 0, ms = 0;
    let captureIdx = 1;

    for (const token of tokens) {
      const value = match[captureIdx];
      // undefined = 可选组未匹配
      if (value !== undefined) {
        const num = parseInt(value, 10);
        switch (token) {
          case 'YYYY': year = num; break;
          case 'YY': year = 2000 + num; break;
          case 'MM': month = num; break;
          case 'DD': day = num; break;
          case 'HH': hour = num; break;
          case 'mm': minute = num; break;
          case 'ss': second = num; break;
          case 'SSS': ms = num; break;
        }
      }
      captureIdx++;
    }

    const date = new Date(year, month - 1, day, hour, minute, second, ms);
    // 验证日期合法性（new Date 会溢出如 2月30日 → 3月2日）
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      return null;
    }
    return date;
  }

  /** 从 segment 树构建解析正则（每个 token 一个独立捕获组）和 token 顺序列表 */
  buildMatchRegex(segments: FormatSegment[]): { regex: RegExp; tokens: string[] } {
    const parts: string[] = [];
    const tokens: string[] = [];

    const walk = (segs: FormatSegment[]): void => {
      for (const seg of segs) {
        if (seg.type === 'token') {
          const dig = TOKEN_DIGITS[seg.value];
          parts.push(`(\\d{${dig}})`);
          tokens.push(seg.value);
        } else if (seg.type === 'literal') {
          parts.push(this.escapeRegex(seg.value));
        } else if (seg.type === 'optional') {
          const innerParts: string[] = [];
          const innerTokens: string[] = [];
          for (const s of seg.segments) {
            if (s.type === 'token') {
              const dig = TOKEN_DIGITS[s.value];
              innerParts.push(`(\\d{${dig}})`);
              innerTokens.push(s.value);
            } else if (s.type === 'literal') {
              innerParts.push(this.escapeRegex(s.value));
            }
          }
          parts.push(`(?:${innerParts.join('')})?`);
          tokens.push(...innerTokens);
        }
      }
    };

    walk(segments);
    return { regex: new RegExp('^' + parts.join('') + '$'), tokens };
  }

  /** 转义正则特殊字符 */
  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
