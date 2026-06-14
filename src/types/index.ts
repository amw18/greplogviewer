// 类型定义 — GrepLogViewer
// 所有核心接口和类型，供 Model/Controller/View 层共享

/** 逻辑操作符：表达式之间的逻辑关系 */
export enum LogicOperator {
  AND = 'and',
  OR = 'or',
  NOT = 'not',
}

/** 单个正则表达式 */
export interface RegexExpression {
  id: string;
  pattern: string;
  flags: string;
  /** 与前一表达式的逻辑关系（组内首表达式忽略此字段） */
  operator: LogicOperator;
  /** 是否启用，默认 true。false 时该表达式在匹配时被跳过 */
  enabled?: boolean;
}

/** 正则组：一组正则表达式 + 显示颜色 */
export interface RegexGroup {
  id: string;
  name: string;
  color: string;
  expressions: RegexExpression[];
  /** 是否启用，默认 true。false 时整组在过滤时被跳过 */
  enabled?: boolean;
}

/** 过滤结果：每行的匹配信息 */
export interface FilterResult {
  lineNumber: number;
  /** 匹配的正则组 ID，null = 未匹配（将被折叠） */
  groupId: string | null;
  color: string | undefined;
}

/** 时间匹配配置：仅需一个格式字符串，描述时间戳在日志中的完整形态 */
export interface TimePatternConfig {
  /**
   * 时间格式字符串，需与日志中的时间戳形态完全一致。
   * 系统会根据 token 自动生成匹配正则。
   * 示例："[YYYY-MM-DD HH:mm:ss]" 匹配 "[2023-01-01 10:00:05]"
   * "YYYY-MM-DD HH:mm:ss{.SSS}" 匹配 "2023-01-01 10:00:05.123"
   * "{.SSS}" 表示毫秒可选
   */
  format: string;
}

/** 带时间元数据的折叠区间 */
export interface FoldRange {
  /** 未匹配起始行 (0-based) */
  start: number;
  /** 未匹配结束行 (0-based) */
  end: number;
  /** 折叠行数 */
  lineCount: number;
  /** 折叠区间前最后一个匹配行的时间 */
  timeFrom?: Date;
  /** 折叠区间后第一个匹配行的时间 */
  timeTo?: Date;
  /** 时间跨度（毫秒），仅 timeFrom 和 timeTo 都存在时有值 */
  durationMs?: number;
  /** 整个文件中第一个匹配行的时间 */
  firstMatchTime?: Date;
  /** 折叠区间内各关键字的匹配行数统计（无 Time Pattern 时也展示） */
  keywordHits?: Array<{ hint: string; count: number }>;
}

/** 关键字匹配配置：文本中匹配的子串高亮为指定颜色 */
export interface KeywordConfig {
  id: string;
  pattern: string;
  flags: string;
  color: string;
  /** 是否启用，默认 true。false 时该关键字在过滤时被跳过 */
  enabled?: boolean;
  /** 匹配行末尾显示的提示文本（after 装饰） */
  hint?: string;
  /** 匹配范围：'matched' 仅在已匹配行中匹配 | 'full' 全文扫描。默认 'full'（向后兼容旧数据） */
  matchScope?: 'matched' | 'full';
}

/** 命名的行范围 */
export interface NamedRange {
  id: string;
  name: string;
  description?: string;
  /** 开始行匹配的正则表达式，第一个匹配行作为范围起始 */
  startPattern: string;
  /** 结束行匹配的正则表达式，第一个匹配行作为范围结束 */
  endPattern: string;
}

/** 编辑器级别的配置（正则组 + 行范围 + 时间模式 + 关键字） */
export interface EditorConfig {
  groups: RegexGroup[];
  /** 开始行正则匹配模式，第一个匹配行作为范围起始。
   * @deprecated 推荐使用 namedRanges + activeRangeId */
  startPattern?: string;
  /** 结束行正则匹配模式，第一个匹配行作为范围结束。
   * @deprecated 推荐使用 namedRanges + activeRangeId */
  endPattern?: string;
  /** 用户对当前行范围的备注描述。
   * @deprecated 推荐使用 namedRanges */
  rangeDescription?: string;
  /** 多个命名的行范围配置（新格式） */
  namedRanges?: NamedRange[];
  /** 当前激活的行范围 ID（单选），为空时回退到 startPattern/endPattern */
  activeRangeId?: string;
  /** 时间匹配模式，未配置时不提取时间信息 */
  timePattern?: TimePatternConfig;
  /** 关键字高亮配置，未配置时不启用 */
  keywords?: KeywordConfig[];
}

// ===== Config Storage =====

/** 持久化储存的命名配置 */
export interface SavedConfigEntry {
  name: string;
  config: EditorConfig;
}

/** 储存范围 */
export type ConfigScope = 'workspace' | 'user';

// ===== Webview ↔ Extension 消息协议 =====

export interface UpdateConfigMessage {
  type: 'updateConfig';
  groups: RegexGroup[];
  startPattern?: string;
  endPattern?: string;
  rangeDescription?: string;
  namedRanges?: NamedRange[];
  activeRangeId?: string;
  timePattern?: TimePatternConfig;
  keywords?: KeywordConfig[];
}

export interface GoMessage {
  type: 'go';
  groups: RegexGroup[];
  startPattern?: string;
  endPattern?: string;
  rangeDescription?: string;
  namedRanges?: NamedRange[];
  activeRangeId?: string;
  timePattern?: TimePatternConfig;
  keywords?: KeywordConfig[];
}

export interface ResetMessage {
  type: 'reset';
}

export interface ClearMessage {
  type: 'clear';
}

// ── Config Management Messages (Webview → Extension) ──

export interface ExportConfigMessage {
  type: 'exportConfig';
  groups: RegexGroup[];
  startPattern?: string;
  endPattern?: string;
  rangeDescription?: string;
  namedRanges?: NamedRange[];
  activeRangeId?: string;
  timePattern?: TimePatternConfig;
  keywords?: KeywordConfig[];
}

export interface ImportConfigMessage {
  type: 'importConfig';
}

export interface SaveConfigMessage {
  type: 'saveConfig';
  name: string;
  scope: ConfigScope;
  groups: RegexGroup[];
  startPattern?: string;
  endPattern?: string;
  rangeDescription?: string;
  namedRanges?: NamedRange[];
  activeRangeId?: string;
  timePattern?: TimePatternConfig;
  keywords?: KeywordConfig[];
}

export interface ListSavedConfigsMessage {
  type: 'listSavedConfigs';
}

export interface ApplySavedConfigMessage {
  type: 'applySavedConfig';
  name: string;
  scope: ConfigScope;
}

export interface DeleteSavedConfigMessage {
  type: 'deleteSavedConfig';
  name: string;
  scope: ConfigScope;
}

// ── Config Management Messages (Extension → Webview) ──

export interface ConfigImportedMessage {
  type: 'configImported';
  config?: { groups: RegexGroup[]; startPattern?: string; endPattern?: string; rangeDescription?: string; namedRanges?: NamedRange[]; activeRangeId?: string; timePattern?: TimePatternConfig; keywords?: KeywordConfig[] };
  error?: string;
}

export interface SavedConfigsListMessage {
  type: 'savedConfigsList';
  configs: { name: string; scope: ConfigScope }[];
}

export interface ConfigAppliedMessage {
  type: 'configApplied';
  groups: RegexGroup[];
  startPattern?: string;
  endPattern?: string;
  rangeDescription?: string;
  namedRanges?: NamedRange[];
  activeRangeId?: string;
  timePattern?: TimePatternConfig;
  keywords?: KeywordConfig[];
}

/** 范围时间信息（Extension → Webview，Go 后发回） */
export interface RangeTimeInfoMessage {
  type: 'rangeTimeInfo';
  /** 范围内首个匹配行的时间（格式化字符串） */
  startTime?: string;
  /** 范围内最后一个匹配行的时间（格式化字符串） */
  endTime?: string;
  /** 范围时间跨度（格式化字符串，如 "5m 30s"） */
  duration?: string;
}

export interface GotoKeywordMatchMessage {
  type: 'gotoKeywordMatch';
  direction: 'next' | 'prev';
}

/** 时间线图表的单个数据点 */
export interface TimelinePoint {
  /** 0-based 行号 */
  lineNumber: number;
  /** epoch 毫秒时间戳 */
  time: number;
}

/** 时间线图表中一个 keyword 的数据 */
export interface TimelineKeyword {
  name: string;
  color: string;
  points: TimelinePoint[];
}

/** Extension → Webview：时间线图表数据 */
export interface TimelineDataMessage {
  type: 'timelineData';
  timeMin: number;
  timeMax: number;
  keywords: TimelineKeyword[];
}

/** Webview → Extension：点击时间线数据点 */
export interface TimelineClickMessage {
  type: 'timelineClick';
  lineNumber: number;
}

export interface SyncConfigMessage {
  type: 'syncConfig';
  groups: RegexGroup[];
  startPattern?: string;
  endPattern?: string;
  rangeDescription?: string;
  namedRanges?: NamedRange[];
  activeRangeId?: string;
  timePattern?: TimePatternConfig;
  keywords?: KeywordConfig[];
}

/** Extension → Webview：匹配行数统计 */
export interface MatchCountsMessage {
  type: 'matchCounts';
  totalLines: number;
  totalMatched: number;
  groupCounts: Record<string, number>;
  keywordCounts: Record<string, number>;
}

export interface GotoGroupMatchMessage {
  type: 'gotoGroupMatch';
  direction: 'prev' | 'next';
}

export type WebviewMessage = GoMessage | ResetMessage | ClearMessage
  | ExportConfigMessage | ImportConfigMessage | SaveConfigMessage
  | ListSavedConfigsMessage | ApplySavedConfigMessage | DeleteSavedConfigMessage
  | GotoKeywordMatchMessage | GotoGroupMatchMessage
  | TimelineClickMessage | SyncConfigMessage;

export type ExtensionMessage = UpdateConfigMessage
  | ConfigImportedMessage | SavedConfigsListMessage | ConfigAppliedMessage
  | RangeTimeInfoMessage | TimelineDataMessage | MatchCountsMessage;
