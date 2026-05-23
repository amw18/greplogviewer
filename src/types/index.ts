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
}

/** 正则组：一组正则表达式 + 显示颜色 */
export interface RegexGroup {
  id: string;
  name: string;
  color: string;
  expressions: RegexExpression[];
}

/** 过滤结果：每行的匹配信息 */
export interface FilterResult {
  lineNumber: number;
  /** 匹配的正则组 ID，null = 未匹配（将被折叠） */
  groupId: string | null;
  color: string | undefined;
}

/** 编辑器级别的配置（正则组 + 行范围） */
export interface EditorConfig {
  groups: RegexGroup[];
  /** 开始匹配的行号（1-based），用户可见行号。未配置时为 undefined */
  startLine?: number;
  /** 结束匹配的行号（1-based），用户可见行号。未配置时为 undefined */
  endLine?: number;
}

// ===== Webview ↔ Extension 消息协议 =====

export interface UpdateConfigMessage {
  type: 'updateConfig';
  groups: RegexGroup[];
  startLine?: number;
  endLine?: number;
}

export interface GoMessage {
  type: 'go';
  groups: RegexGroup[];
  startLine?: number;
  endLine?: number;
}

export interface ResetMessage {
  type: 'reset';
}

export interface ClearMessage {
  type: 'clear';
}

export type WebviewMessage = GoMessage | ResetMessage | ClearMessage;
export type ExtensionMessage = UpdateConfigMessage;
