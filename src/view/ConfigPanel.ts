// ConfigPanel — 左侧边栏 WebviewView 配置面板
import * as vscode from 'vscode';
import { RegexGroup, RegexExpression, LogicOperator, TimePatternConfig, KeywordConfig, ConfigScope, WebviewMessage, ExtensionMessage } from '../types';

export class ConfigPanel implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private goCallback: ((groups: RegexGroup[], startPattern?: string, endPattern?: string, rangeDescription?: string, namedRanges?: import('../types').NamedRange[], activeRangeId?: string, timePattern?: TimePatternConfig, keywords?: KeywordConfig[]) => void) | undefined;
  private resetCallback: (() => void) | undefined;
  private clearCallback: (() => void) | undefined;
  private exportCallback: ((groups: RegexGroup[], startPattern?: string, endPattern?: string, rangeDescription?: string, namedRanges?: import('../types').NamedRange[], activeRangeId?: string, timePattern?: TimePatternConfig, keywords?: KeywordConfig[]) => void) | undefined;
  private importCallback: (() => void) | undefined;
  private saveCallback: ((name: string, scope: ConfigScope, groups: RegexGroup[], startPattern?: string, endPattern?: string, rangeDescription?: string, namedRanges?: import('../types').NamedRange[], activeRangeId?: string, timePattern?: TimePatternConfig, keywords?: KeywordConfig[]) => void) | undefined;
  private listSavedCallback: (() => void) | undefined;
  private applyCallback: ((name: string, scope: ConfigScope) => void) | undefined;
  private deleteCallback: ((name: string, scope: ConfigScope) => void) | undefined;
  /** 缓存最近一次 groups 和行范围用于 webview 尚未就绪时 */
  private pendingGroups: RegexGroup[] = [];
  private pendingStartPattern?: string;
  private pendingEndPattern?: string;
  private pendingRangeDescription?: string;
  private pendingNamedRanges?: import('../types').NamedRange[];
  private pendingActiveRangeId?: string;
  private pendingKeywords?: KeywordConfig[];

  /** WebviewViewProvider 接口：VS Code 创建/重建 webview 时调用 */
  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.buildHtml();

    webviewView.webview.onDidReceiveMessage((msg: WebviewMessage) => {
      switch (msg.type) {
        case 'go':
          this.goCallback?.(msg.groups, msg.startPattern, msg.endPattern, msg.rangeDescription, msg.namedRanges, msg.activeRangeId, msg.timePattern, msg.keywords);
          break;
        case 'reset':
          this.resetCallback?.();
          break;
        case 'clear':
          this.clearCallback?.();
          break;
        case 'exportConfig':
          this.exportCallback?.(msg.groups, msg.startPattern, msg.endPattern, msg.rangeDescription, msg.namedRanges, msg.activeRangeId, msg.timePattern, msg.keywords);
          break;
        case 'importConfig':
          this.importCallback?.();
          break;
        case 'saveConfig':
          this.saveCallback?.(msg.name, msg.scope, msg.groups, msg.startPattern, msg.endPattern, msg.rangeDescription, msg.namedRanges, msg.activeRangeId, msg.timePattern, msg.keywords);
          break;
        case 'listSavedConfigs':
          this.listSavedCallback?.();
          break;
        case 'applySavedConfig':
          this.applyCallback?.(msg.name, msg.scope);
          break;
        case 'deleteSavedConfig':
          this.deleteCallback?.(msg.name, msg.scope);
          break;
        case 'syncConfig':
          this.syncConfigCallback?.(msg.groups, msg.startPattern, msg.endPattern, msg.rangeDescription, msg.namedRanges, msg.activeRangeId, msg.timePattern, msg.keywords);
          break;
        case 'timelineClick':
          this.timelineClickCallback?.(msg.lineNumber);
          break;
      }
    });

    if (this.pendingGroups.length > 0 || this.pendingTimePattern || this.pendingKeywords) {
      this.sendUpdate(this.pendingGroups, this.pendingStartPattern, this.pendingEndPattern, this.pendingRangeDescription, this.pendingNamedRanges, this.pendingActiveRangeId, this.pendingTimePattern, this.pendingKeywords);
    }
  }

  private pendingTimePattern?: TimePatternConfig;

  render(groups: RegexGroup[], startPattern?: string, endPattern?: string, rangeDescription?: string, namedRanges?: import('../types').NamedRange[], activeRangeId?: string, timePattern?: TimePatternConfig, keywords?: KeywordConfig[]): void {
    this.pendingGroups = groups;
    this.pendingStartPattern = startPattern;
    this.pendingEndPattern = endPattern;
    this.pendingRangeDescription = rangeDescription;
    this.pendingNamedRanges = namedRanges;
    this.pendingActiveRangeId = activeRangeId;
    this.pendingTimePattern = timePattern;
    this.pendingKeywords = keywords;
    if (this.view) {
      this.sendUpdate(groups, startPattern, endPattern, rangeDescription, namedRanges, activeRangeId, timePattern, keywords);
    }
  }

  onGo(callback: (groups: RegexGroup[], startPattern?: string, endPattern?: string, rangeDescription?: string, namedRanges?: import('../types').NamedRange[], activeRangeId?: string, timePattern?: TimePatternConfig, keywords?: KeywordConfig[]) => void): void {
    this.goCallback = callback;
  }

  onReset(callback: () => void): void {
    this.resetCallback = callback;
  }

  onClear(callback: () => void): void {
    this.clearCallback = callback;
  }

  onExport(callback: (groups: RegexGroup[], startPattern?: string, endPattern?: string, rangeDescription?: string, namedRanges?: import('../types').NamedRange[], activeRangeId?: string, timePattern?: TimePatternConfig, keywords?: KeywordConfig[]) => void): void {
    this.exportCallback = callback;
  }

  onImport(callback: () => void): void {
    this.importCallback = callback;
  }

  onSave(callback: (name: string, scope: ConfigScope, groups: RegexGroup[], startPattern?: string, endPattern?: string, rangeDescription?: string, namedRanges?: import('../types').NamedRange[], activeRangeId?: string, timePattern?: TimePatternConfig, keywords?: KeywordConfig[]) => void): void {
    this.saveCallback = callback;
  }

  onListSaved(callback: () => void): void {
    this.listSavedCallback = callback;
  }

  onApply(callback: (name: string, scope: ConfigScope) => void): void {
    this.applyCallback = callback;
  }

  onDelete(callback: (name: string, scope: ConfigScope) => void): void {
    this.deleteCallback = callback;
  }

  onSyncConfig(callback: (groups: RegexGroup[], startPattern?: string, endPattern?: string, rangeDescription?: string, namedRanges?: import('../types').NamedRange[], activeRangeId?: string, timePattern?: TimePatternConfig, keywords?: KeywordConfig[]) => void): void {
    this.syncConfigCallback = callback;
  }

  onTimelineClick(callback: (lineNumber: number) => void): void {
    this.timelineClickCallback = callback;
  }

  sendMatchCounts(counts: import('../types').MatchCountsMessage): void {
    this.view?.webview.postMessage(counts);
  }

  sendTimelineData(data: import('../types').TimelineDataMessage): void {
    this.view?.webview.postMessage(data);
  }

  private syncConfigCallback: ((groups: RegexGroup[], startPattern?: string, endPattern?: string, rangeDescription?: string, namedRanges?: import('../types').NamedRange[], activeRangeId?: string, timePattern?: TimePatternConfig, keywords?: KeywordConfig[]) => void) | undefined;
  private timelineClickCallback: ((lineNumber: number) => void) | undefined;

  /** 向 webview 发送已保存配置列表 */
  sendSavedConfigsList(configs: { name: string; scope: ConfigScope }[]): void {
    this.view?.webview.postMessage({
      type: 'savedConfigsList' as const,
      configs,
    } satisfies ExtensionMessage);
  }

  /** 向 webview 发送指定配置数据（apply/import 结果） */
  sendConfigApplied(groups: RegexGroup[], startPattern?: string, endPattern?: string, rangeDescription?: string, namedRanges?: import('../types').NamedRange[], activeRangeId?: string, timePattern?: TimePatternConfig, keywords?: KeywordConfig[]): void {
    this.view?.webview.postMessage({
      type: 'configApplied' as const,
      groups,
      startPattern,
      endPattern,
      rangeDescription,
      namedRanges,
      activeRangeId,
      timePattern,
      keywords,
    } satisfies ExtensionMessage);
  }

  /** 向 webview 发送导入结果（含错误信息） */
  sendConfigImported(config?: { groups: RegexGroup[]; startPattern?: string; endPattern?: string; rangeDescription?: string; namedRanges?: import('../types').NamedRange[]; activeRangeId?: string; timePattern?: TimePatternConfig; keywords?: KeywordConfig[] }, error?: string): void {
    this.view?.webview.postMessage({
      type: 'configImported' as const,
      config: config ? { groups: config.groups, startPattern: config.startPattern, endPattern: config.endPattern, rangeDescription: config.rangeDescription, namedRanges: config.namedRanges, activeRangeId: config.activeRangeId, timePattern: config.timePattern, keywords: config.keywords } : undefined,
      error,
    } satisfies ExtensionMessage);
  }

  /** 向 webview 发送范围时间信息 */
  sendRangeTimeInfo(info?: { startTime?: Date; endTime?: Date; durationMs?: number }): void {
    if (!info) {
      this.view?.webview.postMessage({ type: 'rangeTimeInfo' as const } satisfies ExtensionMessage);
      return;
    }
    const pad = (n: number, len: number) => String(n).padStart(len, '0');
    const fmtTs = (d: Date) =>
      `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)} ` +
      `${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}:${pad(d.getSeconds(), 2)}` +
      (d.getMilliseconds() > 0 ? `.${pad(d.getMilliseconds(), 3)}` : '');
    const fmtDur = (ms: number): string => {
      if (ms < 0) { ms = -ms; }
      if (ms < 1000) { return `${ms}ms`; }
      if (ms < 60000) { return `${(ms / 1000).toFixed(1)}s`; }
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      const millis = ms % 1000;
      const parts: string[] = [];
      if (h > 0) { parts.push(`${h}h`); }
      if (m > 0) { parts.push(`${m}m`); }
      if (s > 0 || parts.length === 0) { parts.push(`${s}s`); }
      if (millis > 0 && h === 0) { parts[parts.length - 1] = `${s}.${String(millis).padStart(3, '0')}s`; }
      return parts.join(' ');
    };
    this.view?.webview.postMessage({
      type: 'rangeTimeInfo' as const,
      startTime: info.startTime ? fmtTs(info.startTime) : undefined,
      endTime: info.endTime ? fmtTs(info.endTime) : undefined,
      duration: info.durationMs !== undefined ? fmtDur(info.durationMs) : undefined,
    } satisfies ExtensionMessage);
  }

  private sendUpdate(groups: RegexGroup[], startPattern?: string, endPattern?: string, rangeDescription?: string, namedRanges?: import('../types').NamedRange[], activeRangeId?: string, timePattern?: TimePatternConfig, keywords?: KeywordConfig[]): void {
    this.view?.webview.postMessage({
      type: 'updateConfig' as const,
      groups,
      startPattern,
      endPattern,
      rangeDescription,
      namedRanges,
      activeRangeId,
      timePattern,
      keywords,
    } satisfies ExtensionMessage);
  }

  /** 构建 Webview HTML */
  private buildHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family, sans-serif); font-size: 12px;
         color: var(--vscode-foreground); background: var(--vscode-sideBar-background);
         padding: 4px; }
  .group-card { border: 1px solid var(--vscode-panel-border); border-radius: 3px;
                margin-bottom: 4px; padding: 4px; cursor: grab; }
  .group-card.dragging { opacity: 0.4; cursor: grabbing; }
  .group-card.drag-over { border-color: var(--vscode-focusBorder); border-style: dashed; }
  .group-header { display: flex; align-items: center; gap: 3px; margin-bottom: 2px; flex-wrap: wrap; }
  .group-header input[type="checkbox"] { margin: 0; cursor: pointer; flex-shrink: 0; }
  .group-header input[type="text"] { background: var(--vscode-input-background);
        color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);
        padding: 1px 3px; border-radius: 2px; font-size: 11px; }
  .group-header .group-name { flex: 0 1 60px; min-width: 40px; }
  .group-header .group-first-expr { flex: 1 1 60px; min-width: 40px; }
  .remove-btn { background: none; border: none; color: var(--vscode-errorForeground);
                cursor: pointer; font-size: 14px; line-height: 1; padding: 0 2px; flex-shrink: 0; }
  .move-btn { background: none; border: none; color: var(--vscode-descriptionForeground);
              cursor: pointer; font-size: 10px; line-height: 1; padding: 0 2px; }
  .move-btn:hover { color: var(--vscode-foreground); }
  .move-btn:disabled { opacity: 0.3; cursor: default; }
  .expr-row { display: flex; align-items: center; gap: 3px; margin-bottom: 3px;
              padding: 3px; background: var(--vscode-input-background); border-radius: 2px; }
  .expr-row input[type="checkbox"] { margin: 0; cursor: pointer; }
  .expr-row select { background: var(--vscode-dropdown-background);
        color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border);
        padding: 1px 2px; border-radius: 2px; font-size: 11px; }
  .expr-row input[type="text"] { flex: 1; background: transparent;
        color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);
        padding: 1px 4px; border-radius: 2px; font-size: 11px; }
  .expr-row input.pattern { min-width: 60px; }
  .add-btn, .action-btn { background: var(--vscode-button-background);
        color: var(--vscode-button-foreground); border: none; padding: 2px 8px;
        border-radius: 2px; cursor: pointer; font-size: 11px; }
  .add-btn:hover, .action-btn:hover { background: var(--vscode-button-hoverBackground); }
  .action-bar { display: flex; gap: 4px; justify-content: center; margin-top: 8px; }
  .reset-btn { background: var(--vscode-button-secondaryBackground);
               color: var(--vscode-button-secondaryForeground); }
  .reset-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }

  .section { margin-bottom: 4px; }
  .section-header { font-size: 11px; font-weight: 600; text-transform: uppercase;
                    color: var(--vscode-descriptionForeground); letter-spacing: 0.5px;
                    padding: 3px 6px; border: none; border-bottom: 1px solid var(--vscode-panel-border);
                    margin-bottom: 2px; cursor: pointer; user-select: none;
                    display: flex; align-items: center; gap: 4px; width: 100%;
                    background: none; font-family: inherit; }
  .section-header:hover { color: var(--vscode-foreground); }
  .section-toggle { font-size: 10px; transition: transform 0.15s; width: 10px; text-align: center; }
  .section-toggle.open { transform: rotate(90deg); }
  .section-body { padding: 0 2px; }
  .section-body.collapsed { display: none; }

  .section.collapsible .section-header { cursor: pointer; }
  .section.collapsible.auto-open .section-body { display: block; }
  .section.collapsible.auto-open .section-toggle { transform: rotate(90deg); }

  .line-range { display: flex; align-items: center; gap: 4px; padding: 4px; flex-wrap: wrap; }
  .line-range label { font-size: 11px; color: var(--vscode-descriptionForeground); }
  .line-range input[type="text"] { background: var(--vscode-input-background);
        color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);
        padding: 1px 4px; border-radius: 2px; font-size: 11px; flex: 1; min-width: 60px; }
  .line-range .hint { font-size: 10px; color: var(--vscode-descriptionForeground); }
  .range-time-info { font-size: 10px; color: var(--vscode-descriptionForeground);
                     padding: 2px 4px 4px 4px; font-style: italic; }
  .range-card { border: 1px solid var(--vscode-panel-border); border-radius: 3px;
                margin-bottom: 4px; padding: 3px 4px; }
  .range-card.active { border-color: var(--vscode-focusBorder); }
  .range-card-row { display: flex; align-items: center; gap: 3px; }
  .range-card-row input[type="radio"] { margin: 0; cursor: pointer; accent-color: var(--vscode-focusBorder); flex-shrink: 0; }
  .range-card-row .range-name { flex: 1; min-width: 50px; background: var(--vscode-input-background);
        color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);
        padding: 1px 3px; border-radius: 2px; font-size: 10px; }
  .range-card-row .range-from,
  .range-card-row .range-to { flex: 1; min-width: 55px; background: var(--vscode-input-background);
        color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);
        padding: 1px 4px; border-radius: 2px; font-size: 11px; }
  .range-card-row .range-lbl { font-size: 10px; color: var(--vscode-descriptionForeground); flex-shrink: 0; }

  .keyword-row { display: flex; align-items: center; gap: 3px; margin-bottom: 3px;
                 padding: 3px; background: var(--vscode-input-background); border-radius: 2px; }
  .keyword-row input[type="text"] { flex: 1; background: transparent;
        color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);
        padding: 1px 4px; border-radius: 2px; font-size: 11px; }
  .keyword-row input.pattern { min-width: 60px; }
  .keyword-row input.flags { width: 40px; }
  .keyword-row input.hint { min-width: 60px; }

  /* ── 颜色选择器（触发器 + 弹出面板）── */
  .color-picker-wrap { position: relative; display: inline-flex; align-items: center; }
  .color-trigger { width: 22px; height: 18px; border: 1px solid var(--vscode-input-border);
                   border-radius: 2px; cursor: pointer; display: inline-block;
                   flex-shrink: 0; vertical-align: middle; }
  .color-trigger:hover { border-color: var(--vscode-focusBorder); }
  .color-popover { display: none; position: fixed; z-index: 9999;
                   background: var(--vscode-dropdown-background);
                   border: 1px solid var(--vscode-dropdown-border);
                   border-radius: 4px; padding: 8px; min-width: 220px;
                   box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
  .color-popover.show { display: block; }
  .color-popover .native-color { width: 100%; height: 28px; border: 1px solid var(--vscode-input-border);
                                 cursor: pointer; margin-bottom: 8px; padding: 2px;
                                 border-radius: 2px; background: var(--vscode-input-background); }
  .color-popover .native-label { font-size: 10px; color: var(--vscode-descriptionForeground);
                                  margin-bottom: 2px; display: block; }
  .swatch-grid { display: flex; flex-direction: column; gap: 5px; }
  .swatch-row { display: flex; align-items: center; justify-content: space-between; }
  .swatch-dots { display: flex; gap: 4px; flex: 1; justify-content: space-evenly; }
  .swatch-label { font-size: 9px; color: var(--vscode-descriptionForeground);
                  width: 28px; text-align: right; flex-shrink: 0; margin-right: 2px; }
  .swatch { width: 16px; height: 16px; border-radius: 50%; cursor: pointer;
            border: 1px solid var(--vscode-panel-border); flex-shrink: 0;
            transition: transform 0.1s; }
  .count-badge { font-size: 9px; color: var(--vscode-badge-foreground);
    background: var(--vscode-badge-background);
    padding: 0 5px; border-radius: 8px; line-height: 16px;
    white-space: nowrap; flex-shrink: 0; }
  .count-badge.zero { opacity: 0.4; }

  /* ── Flags 选择器 ── */
  .flags-trigger { display: inline-flex; align-items: center; justify-content: center;
    min-width: 26px; height: 18px; padding: 0 4px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 2px; cursor: pointer; font-size: 10px;
    font-family: monospace; flex-shrink: 0; }
  .flags-trigger:hover { border-color: var(--vscode-focusBorder); }
  .flags-trigger.empty { color: var(--vscode-descriptionForeground);
    font-family: var(--vscode-font-family, sans-serif); }
  .flags-popover { display: none; position: fixed; z-index: 9999;
    background: var(--vscode-dropdown-background);
    border: 1px solid var(--vscode-dropdown-border);
    border-radius: 4px; padding: 6px; min-width: 180px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
  .flags-popover.show { display: block; }
  .flags-popover label { display: flex; align-items: center; gap: 4px;
    padding: 2px 4px; cursor: pointer; font-size: 11px; border-radius: 2px; }
  .flags-popover label:hover { background: var(--vscode-list-hoverBackground); }
  .flags-popover input[type="checkbox"] { margin: 0; cursor: pointer; }
  .flags-popover .flag-desc { color: var(--vscode-descriptionForeground);
    font-size: 10px; margin-left: auto; }
  .flag-sep { border-top: 1px solid var(--vscode-panel-border); margin: 3px 0; }

  /* ── Config Management ── */
  .cfg-mgmt-row { display: flex; align-items: center; gap: 3px; margin-bottom: 4px; }
  .cfg-mgmt-row label { font-size: 10px; color: var(--vscode-descriptionForeground);
                        white-space: nowrap; }
  .cfg-mgmt-row input[type="text"] { flex: 1; min-width: 0;
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);
        padding: 1px 4px; border-radius: 2px; font-size: 11px; }
  .cfg-mgmt-row select { background: var(--vscode-dropdown-background);
        color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border);
        padding: 1px 2px; border-radius: 2px; font-size: 10px; }
  .cfg-mgmt-row .cfg-btn { background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground); border: none;
        padding: 2px 6px; border-radius: 2px; cursor: pointer; font-size: 10px;
        white-space: nowrap; flex-shrink: 0; }
  .cfg-mgmt-row .cfg-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .cfg-mgmt-row .cfg-btn.danger { color: var(--vscode-errorForeground); }
  .cfg-mgmt-row .cfg-btn.danger:hover { background: var(--vscode-inputValidation-errorBackground); }
  .cfg-divider { border: none; border-top: 1px solid var(--vscode-panel-border);
                 margin: 4px 0; }
</style>
</head>
<body>
<div id="app"></div>
<script>
(function() {
  const vscode = acquireVsCodeApi();
  let state = vscode.getState() || { groups: [], startPattern: undefined, endPattern: undefined, rangeDescription: undefined, namedRanges: undefined, activeRangeId: undefined, timePattern: undefined, keywords: [] };
  let groups = state.groups;
  let startPattern = state.startPattern;
  let endPattern = state.endPattern;
  let rangeDescription = state.rangeDescription;
  let namedRanges = state.namedRanges || [];
  let activeRangeId = state.activeRangeId;
  let keywords = state.keywords || [];
  let timePattern = state.timePattern || { format: '' };
  var savedConfigsList = [];
  var rangeTimeInfoHtml = '';
  var matchCounts = null;  // { totalLines, totalMatched, groupCounts, keywordCounts }

  // 向后兼容：旧配置有 startLine/endLine（数字）或 startPattern/endPattern 是数字时自动迁移
  function migrateOldRanges() {
    if (namedRanges.length === 0 && (startPattern || endPattern)) {
      var r = {
        id: uuid(),
        name: rangeDescription || 'Range 1',
        startPattern: String(startPattern || ''),
        endPattern: String(endPattern || '')
      };
      namedRanges = [r];
      activeRangeId = r.id;
      startPattern = undefined;
      endPattern = undefined;
      rangeDescription = undefined;
    }
    // 兼容：旧 namedRanges 中 startLine/endLine 是数字
    for (var ri = 0; ri < namedRanges.length; ri++) {
      var nr = namedRanges[ri];
      if (nr.startLine !== undefined) { nr.startPattern = String(nr.startLine || ''); delete nr.startLine; }
      if (nr.endLine !== undefined) { nr.endPattern = String(nr.endLine || ''); delete nr.endLine; }
      if (!nr.startPattern && !nr.endPattern && nr.startLine !== undefined) {
        nr.startPattern = String(nr.startLine || '');
        delete nr.startLine;
      }
    }
  }
  migrateOldRanges();

  function ensureDefaultRange() {
    if (namedRanges.length === 0) {
      var r = { id: uuid(), name: 'All lines', startPattern: '', endPattern: '' };
      namedRanges = [r];
      activeRangeId = r.id;
    }
  }

  function saveState() { vscode.setState({ groups, startPattern, endPattern, rangeDescription, namedRanges, activeRangeId, keywords }); }

  var syncTimer = null;
  function syncToExtension() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function() {
      var tf = document.getElementById('time-format');
      vscode.postMessage({
        type: 'syncConfig',
        groups: groups,
        startPattern: startPattern,
        endPattern: endPattern,
        rangeDescription: rangeDescription,
        namedRanges: namedRanges,
        activeRangeId: activeRangeId,
        timePattern: timePattern,
        keywords: keywords
      });
    }, 300);
  }

  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  // 预设色板：每组 5 色，全部唯一，水平拉伸均匀分布
  var COLOR_SWATCHES = [
    { label: 'Cool', colors: [
      { hex: '#00BCD4', name: 'Cyan' },
      { hex: '#009688', name: 'Teal' },
      { hex: '#4CAF50', name: 'Green' },
      { hex: '#2196F3', name: 'Blue' },
      { hex: '#7C4DFF', name: 'Deep Purple' }
    ]},
    { label: 'Warm', colors: [
      { hex: '#FF9800', name: 'Orange' },
      { hex: '#FF5722', name: 'Deep Orange' },
      { hex: '#F44336', name: 'Red' },
      { hex: '#E91E63', name: 'Pink' },
      { hex: '#FFC107', name: 'Amber' }
    ]},
    { label: 'HiCon', colors: [
      { hex: '#FF1744', name: 'Bright Red' },
      { hex: '#00E676', name: 'Lime Green' },
      { hex: '#2979FF', name: 'Royal Blue' },
      { hex: '#FFEB3B', name: 'Yellow' },
      { hex: '#D500F9', name: 'Magenta' }
    ]}
  ];

  function swatchPopoverHtml(targetKind, targetIdx) {
    var h = '<div class="swatch-grid">';
    for (var s = 0; s < COLOR_SWATCHES.length; s++) {
      var grp = COLOR_SWATCHES[s];
      h += '<div class="swatch-row">';
      h += '<span class="swatch-label">' + grp.label + '</span>';
      h += '<span class="swatch-dots">';
      for (var c = 0; c < grp.colors.length; c++) {
        var sc = grp.colors[c];
        h += '<span class="swatch" style="background:' + sc.hex + '" data-swatch-color="' + sc.hex + '" data-swatch-' + targetKind + '="' + targetIdx + '" title="' + sc.name + '"></span>';
      }
      h += '</span>';
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  function colorPickerHtml(kind, idx, currentColor) {
    var h = '<span class="color-picker-wrap">';
    h += '<span class="color-trigger" style="background:' + currentColor + '" data-color-' + kind + '="' + idx + '"></span>';
    h += '<div class="color-popover" data-color-' + kind + '="' + idx + '">';
    h += '<span class="native-label">Pick a color</span>';
    h += '<input type="color" value="' + currentColor + '" class="native-color" data-color-' + kind + '="' + idx + '">';
    h += swatchPopoverHtml(kind, idx);
    h += '</div>';
    h += '</span>';
    return h;
  }

  // ── Flags 下拉选择器 ──
  var FLAG_OPTIONS = [
    { flag: 'i', desc: 'ignore case' },
    { flag: 'm', desc: 'multiline (^/$ match lines)' },
    { flag: 's', desc: 'dotAll (. matches newline)' }
  ];

  /** kind: 'expr' | 'kw'; idx: gi:ei or ki */
  function flagsPickerHtml(kind, gi, ei, ki, currentFlags) {
    var id = kind === 'expr' ? gi + ':' + ei : 'kw:' + ki;
    var display = currentFlags || '···';
    var isEmpty = !currentFlags;
    var h = '<span class="flags-picker-wrap">';
    h += '<span class="flags-trigger' + (isEmpty ? ' empty' : '') + '" data-flags-' + kind + '="' + id + '">' + esc(display) + '</span>';
    h += '<div class="flags-popover" data-flags-' + kind + '="' + id + '">';
    for (var f = 0; f < FLAG_OPTIONS.length; f++) {
      var fo = FLAG_OPTIONS[f];
      var checked = currentFlags.indexOf(fo.flag) !== -1 ? ' checked' : '';
      h += '<label>';
      h += '<input type="checkbox" data-flag="' + fo.flag + '" data-flags-' + kind + '="' + id + '"' + checked + '>';
      h += '<code>' + fo.flag + '</code>';
      h += '<span class="flag-desc">' + fo.desc + '</span>';
      h += '</label>';
    }
    // Keyword mode: matchScope option
    if (kind === 'kw') {
      h += '<div class="flag-sep"></div>';
      var kwScope = 'full';
      if (ki !== null && keywords[ki]) { kwScope = keywords[ki].matchScope || 'full'; }
      h += '<label>';
      h += '<input type="checkbox" data-flag="matched" data-flags-kw="' + id + '"' + (kwScope === 'matched' ? ' checked' : '') + '>';
      h += '<code>grp</code>';
      h += '<span class="flag-desc">only in group lines</span>';
      h += '</label>';
    }
    h += '</div>';
    h += '</span>';
    return h;
  }

  function setFlags(kind, gi, ei, ki) {
    var id = kind === 'expr' ? gi + ':' + ei : 'kw:' + ki;
    var flags = '';
    document.querySelectorAll('input[data-flag][data-flags-' + kind + '="' + id + '"]').forEach(function(cb) {
      if (cb.checked) { flags += cb.dataset.flag; }
    });
    // 更新数据模型
    if (kind === 'expr') {
      groups[gi].expressions[ei].flags = flags;
    } else {
      keywords[ki].flags = flags;
      syncToExtension();
    }
    // 更新触发器显示
    var trigger = document.querySelector('.flags-trigger[data-flags-' + kind + '="' + id + '"]');
    if (trigger) {
      trigger.textContent = flags || '···';
      if (flags) { trigger.classList.remove('empty'); }
      else { trigger.classList.add('empty'); }
    }
    saveState();
  }

  function render() {
    ensureDefaultRange();
    var html = '';

    // ── Section: Line Ranges (collapsible, default collapsed) ──
    html += '<div class="section collapsible" id="section-lineRanges">';
    html += '<button class="section-header" data-action="toggleSection" data-section="lineRanges">';
    html += '<span class="section-toggle">▶</span><span>Line Ranges</span></button>';
    html += '<div class="section-body collapsed">';
    for (var ri = 0; ri < namedRanges.length; ri++) {
      var rng = namedRanges[ri];
      var isActive = rng.id === activeRangeId;
      html += '<div class="range-card' + (isActive ? ' active' : '') + '">';
      html += '<div class="range-card-row">';
      html += '<input type="radio" name="active-range" value="' + rng.id + '"' + (isActive ? ' checked' : '') + ' data-action="activateRange" data-ri="' + ri + '" title="Select this range">';
      html += '<input type="text" class="range-name" value="' + esc(rng.name) + '" data-ri="' + ri + '" placeholder="Range name">';
      html += '<span class="range-lbl">From</span>';
      html += '<input type="text" class="range-from" value="' + esc(rng.startPattern || '') + '" data-ri="' + ri + '" placeholder="regex (start)">';
      html += '<span class="range-lbl">To</span>';
      html += '<input type="text" class="range-to" value="' + esc(rng.endPattern || '') + '" data-ri="' + ri + '" placeholder="regex (end)">';
      html += '<button class="remove-btn" data-action="removeRange" data-ri="' + ri + '">&times;</button>';
      html += '</div>';
      html += '</div>';
    }
    html += '<button class="add-btn" data-action="addRange" style="display:block;width:100%">+ Add Range</button>';
    html += '<div id="range-time-info" class="range-time-info">' + (rangeTimeInfoHtml || '') + '</div>';
    html += '</div></div>';  // close section-body and section for Line Ranges

    // ── Section: Time Pattern (collapsible, default collapsed) ──
    html += '<div class="section collapsible" id="section-timePattern">';
    html += '<button class="section-header" data-action="toggleSection" data-section="timePattern">';
    html += '<span class="section-toggle">▶</span><span>Time Pattern</span></button>';
    html += '<div class="section-body collapsed">';
    html += '<div class="time-pattern">';
    html += '<label style="font-size:11px;color:var(--vscode-descriptionForeground)">Format string</label>';
    html += '<input type="text" id="time-format" value="' + esc(timePattern?.format || '') + '" placeholder="e.g. [YYYY-MM-DD HH:mm:ss{.SSS}]" style="width:100%">';
    html += '<span style="font-size:10px;color:var(--vscode-descriptionForeground)">Write the timestamp exactly as it appears in your log.<br>Tokens: YYYY YY MM DD HH mm ss SSS. Optional parts: {...}.<br>Example: <code>[YYYY-MM-DD HH:mm:ss{.SSS}]</code></span>';
    html += '</div></div></div>';

    // ── Section: Pattern Groups ──
    html += '<div class="section">';
    html += '<div class="section-header">Pattern Groups</div>';
    html += '<div class="section-body">';

    for (var gi = 0; gi < groups.length; gi++) {
      var g = groups[gi];
      html += '<div class="group-card" draggable="true" data-gi="' + gi + '">';
      html += '<div class="group-header">';
      html += '<input type="checkbox" data-gi="' + gi + '" class="group-enabled"' + (g.enabled !== false ? ' checked' : '') + ' title="Enable/disable this group">';
      html += '<input type="text" value="' + esc(g.name) + '" data-gi="' + gi + '" class="group-name" placeholder="Name">';
      var gc = matchCounts && matchCounts.groupCounts ? (matchCounts.groupCounts[g.id] || 0) : -1;
      if (gc >= 0) {
        html += '<span class="count-badge' + (gc === 0 ? ' zero' : '') + '">' + gc + '</span>';
      }
      if (g.expressions.length > 0) {
        html += '<input type="text" class="group-first-expr" value="' + esc(g.expressions[0].pattern) + '" data-gi="' + gi + '" data-ei="0" placeholder="/regex/">';
        html += flagsPickerHtml('expr', gi, 0, null, g.expressions[0].flags);
      }
      html += colorPickerHtml('gi', gi, g.color);
      html += '<button class="remove-btn" data-action="removeGroup" data-gi="' + gi + '">&times;</button>';
      html += '<button class="add-btn" data-action="addExpr" data-gi="' + gi + '" style="font-size:10px;padding:1px 4px">+</button>';
      html += '</div>';

      // Expression rows (from e1 since e0 is inline in header)
      for (var ei = 1; ei < g.expressions.length; ei++) {
        var e = g.expressions[ei];
        html += '<div class="expr-row">';
        html += '<input type="checkbox" data-gi="' + gi + '" data-ei="' + ei + '" class="expr-enabled"' + (e.enabled !== false ? ' checked' : '') + ' title="Enable/disable">';
        html += '<select data-gi="' + gi + '" data-ei="' + ei + '" class="expr-op">';
        html += '<option value="and"' + (e.operator==='and'?' selected':'') + '>AND</option>';
        html += '<option value="or"' + (e.operator==='or'?' selected':'') + '>OR</option>';
        html += '<option value="not"' + (e.operator==='not'?' selected':'') + '>NOT</option>';
        html += '</select>';
        html += '<input type="text" class="pattern" value="' + esc(e.pattern) + '" data-gi="' + gi + '" data-ei="' + ei + '" placeholder="/regex/">';
        html += flagsPickerHtml('expr', gi, ei, null, e.flags);
        html += '<button class="remove-btn" data-action="removeExpr" data-gi="' + gi + '" data-ei="' + ei + '">&times;</button>';
        html += '</div>';
      }
      html += '</div>';
    }
    html += '<button class="add-btn" data-action="addGroup" style="display:block;width:100%">+ Add Group</button>';
    html += '</div></div>';

    // ── Section: Keyword Matching ──
    html += '<div class="section">';
    html += '<div class="section-header">Keyword Highlight</div>';
    html += '<div class="section-body">';
    for (var ki = 0; ki < keywords.length; ki++) {
      var kw = keywords[ki];
      html += '<div class="keyword-row">';
      html += '<input type="checkbox" data-ki="' + ki + '" class="keyword-enabled"' + (kw.enabled !== false ? ' checked' : '') + ' title="Enable/disable">';
      html += '<input type="text" class="pattern" value="' + esc(kw.pattern) + '" data-ki="' + ki + '" placeholder="regex">';
      html += flagsPickerHtml('kw', null, null, ki, kw.flags);
      html += colorPickerHtml('ki', ki, kw.color);
      html += '<input type="text" class="hint" value="' + esc(kw.hint || '') + '" data-ki="' + ki + '" placeholder="hint">';
      var kc = matchCounts && matchCounts.keywordCounts ? (matchCounts.keywordCounts[kw.id] || 0) : -1;
      if (kc >= 0) {
        html += '<span class="count-badge' + (kc === 0 ? ' zero' : '') + '">' + kc + '</span>';
      }
      html += '<button class="remove-btn" data-action="removeKeyword" data-ki="' + ki + '">&times;</button>';
      html += '</div>';
    }
    html += '<button class="add-btn" data-action="addKeyword" style="display:block;width:100%">+ Add Keyword</button>';
    // ── Keyword Timeline ──
    html += '<div id="tl-container" style="position:relative;width:100%;height:120px;margin:4px 0;border:1px solid var(--vscode-panel-border);border-radius:4px;overflow:hidden">';
    html += '<canvas id="tl-canvas" style="display:block;width:100%;height:100%;position:relative;z-index:1"></canvas>';
    html += '<div id="tl-empty" style="position:absolute;inset:0;z-index:0;display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--vscode-descriptionForeground);pointer-events:none">Click Go to see keyword timeline</div>';
    html += '<div id="tl-tooltip" style="position:absolute;display:none;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);border:1px solid var(--vscode-panel-border);padding:2px 6px;font-size:11px;pointer-events:none;white-space:nowrap;border-radius:2px;z-index:10"></div>';
    html += '<div id="tl-zoom" style="position:absolute;bottom:2px;right:4px;font-size:10px;color:var(--vscode-descriptionForeground);pointer-events:none"></div>';
    html += '</div>';

    // ── Section: Config Management (collapsible) ──
    html += '<div class="section collapsible" id="section-configMgmt">';
    html += '<button class="section-header" data-action="toggleSection" data-section="configMgmt">';
    html += '<span class="section-toggle">▶</span><span>Config Management</span></button>';
    html += '<div class="section-body collapsed">';

    // Save row
    html += '<div class="cfg-mgmt-row">';
    html += '<input type="text" id="cfg-save-name" placeholder="Config name" style="width:90px">';
    html += '<select id="cfg-save-scope"><option value="user">User</option><option value="workspace">Workspace</option></select>';
    html += '<button class="cfg-btn" id="cfg-save-btn">Save</button>';
    html += '</div>';

    // Apply + Delete row
    html += '<div class="cfg-mgmt-row">';
    html += '<select id="cfg-apply-select" style="flex:1;min-width:0"><option value="">-- Select saved --</option></select>';
    html += '<button class="cfg-btn" id="cfg-apply-btn">Apply</button>';
    html += '<button class="cfg-btn danger" id="cfg-delete-btn">Delete</button>';
    html += '</div>';

    // Export / Import row
    html += '<hr class="cfg-divider">';
    html += '<div class="cfg-mgmt-row">';
    html += '<button class="cfg-btn" id="cfg-export-btn" style="flex:1">Export to file</button>';
    html += '<button class="cfg-btn" id="cfg-import-btn" style="flex:1">Import from file</button>';
    html += '</div>';

    html += '</div></div>';

    var statsHtml = '';
    if (matchCounts) {
      statsHtml = '<span class="count-badge" style="margin-left:auto">'
        + matchCounts.totalMatched + '/' + matchCounts.totalLines + '</span>';
    }
    html += '<div class="action-bar">';
    html += '<button class="action-btn" id="go-btn">Go</button>';
    html += '<button class="action-btn reset-btn" id="clear-btn">Clear</button>';
    html += '<button class="action-btn reset-btn" id="reset-btn">Reset</button>';
    html += statsHtml;
    html += '</div>';
    document.getElementById('app').innerHTML = html;
    vscode.postMessage({ type: 'listSavedConfigs' });
    // 重绘 timeline（render 重建了 DOM）
    tlRefresh();
  }

  function collectStartEnd() {
    // 从 DOM 收集 namedRanges 数据并解析激活项
    collectRangeData();
    var active = null;
    for (var i = 0; i < namedRanges.length; i++) {
      if (namedRanges[i].id === activeRangeId) { active = namedRanges[i]; break; }
    }
    return {
      startPattern: active ? active.startPattern : undefined,
      endPattern: active ? active.endPattern : undefined,
      rangeDescription: active ? active.name : undefined,
      namedRanges: namedRanges,
      activeRangeId: activeRangeId
    };
  }

  function collectRangeData() {
    document.querySelectorAll('.range-name').forEach(function(el) {
      var ri = parseInt(el.dataset.ri);
      if (!isNaN(ri) && namedRanges[ri]) namedRanges[ri].name = el.value;
    });
    document.querySelectorAll('.range-from').forEach(function(el) {
      var ri = parseInt(el.dataset.ri);
      if (!isNaN(ri) && namedRanges[ri]) namedRanges[ri].startPattern = el.value;
    });
    document.querySelectorAll('.range-to').forEach(function(el) {
      var ri = parseInt(el.dataset.ri);
      if (!isNaN(ri) && namedRanges[ri]) namedRanges[ri].endPattern = el.value;
    });
  }

  // ── 关闭所有颜色弹出面板 ──
  function closeAllPopovers() {
    document.querySelectorAll('.color-popover.show, .flags-popover.show').forEach(function(p) { p.classList.remove('show'); });
  }

  // ── 更新颜色数据 ──
  function setColor(kind, idx, color) {
    var trigger = document.querySelector('.color-trigger[data-color-' + kind + '="' + idx + '"]');
    var native = document.querySelector('.native-color[data-color-' + kind + '="' + idx + '"]');
    if (trigger) trigger.style.background = color;
    if (native) native.value = color;
    if (kind === 'gi') { groups[idx].color = color; }
    else if (kind === 'ki') { keywords[idx].color = color; }
    saveState();
  }

  // ── Drag and Drop for Group Cards ──
  var dragFromGi = -1;
  document.getElementById('app').addEventListener('dragstart', function(e) {
    var card = e.target.closest('.group-card');
    if (!card) { return; }
    dragFromGi = parseInt(card.dataset.gi);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(dragFromGi));
    card.classList.add('dragging');
  });
  document.getElementById('app').addEventListener('dragend', function(e) {
    var card = e.target.closest('.group-card');
    if (card) { card.classList.remove('dragging'); }
    dragFromGi = -1;
    document.querySelectorAll('.group-card.drag-over').forEach(function(c) { c.classList.remove('drag-over'); });
  });
  document.getElementById('app').addEventListener('dragover', function(e) {
    e.preventDefault();
    var card = e.target.closest('.group-card');
    if (!card || dragFromGi < 0) { return; }
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.group-card.drag-over').forEach(function(c) { c.classList.remove('drag-over'); });
    card.classList.add('drag-over');
  });
  document.getElementById('app').addEventListener('drop', function(e) {
    e.preventDefault();
    var card = e.target.closest('.group-card');
    if (!card || dragFromGi < 0) { return; }
    card.classList.remove('drag-over');
    var toGi = parseInt(card.dataset.gi);
    if (dragFromGi !== toGi && !isNaN(dragFromGi) && !isNaN(toGi)) {
      var item = groups.splice(dragFromGi, 1)[0];
      groups.splice(toGi, 0, item);
      saveState(); render();
    }
    dragFromGi = -1;
  });

  // ── 事件委托 ──
  document.getElementById('app').addEventListener('click', function(e) {
    // ── 颜色触发器：切换弹出面板（fixed 定位 + 边界约束）──
    var trigger = e.target.closest('.color-trigger');
    if (trigger) {
      var kind = trigger.dataset.colorGi !== undefined ? 'gi' : 'ki';
      var idx = trigger.dataset.colorGi !== undefined ? trigger.dataset.colorGi : trigger.dataset.colorKi;
      var popover = document.querySelector('.color-popover[data-color-' + kind + '="' + idx + '"]');
      var wasOpen = popover && popover.classList.contains('show');
      closeAllPopovers();
      if (popover && !wasOpen) {
        var rect = trigger.getBoundingClientRect();
        // 水平：不超出 webview 右边界
        var pw = 226;
        var left = rect.left;
        if (left + pw > window.innerWidth - 4) {
          left = Math.max(2, window.innerWidth - pw - 4);
        }
        popover.style.left = left + 'px';
        // 垂直：下方空间不足时翻到上方
        var estH = 160;
        if (rect.bottom + estH + 8 > window.innerHeight && rect.top > estH + 8) {
          popover.style.top = (rect.top - estH - 4) + 'px';
        } else {
          popover.style.top = (rect.bottom + 4) + 'px';
        }
        popover.classList.add('show');
      }
      return;
    }

    // ── 色板点击：更新颜色并关闭面板 ──
    var swatch = e.target.closest('.swatch');
    if (swatch) {
      var color = swatch.dataset.swatchColor;
      var sk = swatch.dataset.swatchGi !== undefined ? 'gi' : 'ki';
      var sv = swatch.dataset.swatchGi !== undefined ? swatch.dataset.swatchGi : swatch.dataset.swatchKi;
      setColor(sk, sv, color);
      closeAllPopovers();
      return;
    }

    // ── 点击弹出面板内部（非色板）不关闭 ──
    if (e.target.closest('.color-popover')) { return; }

    // ── Flags 触发器：切换弹出面板 ──
    var fTrigger = e.target.closest('.flags-trigger');
    if (fTrigger) {
      var fKind = fTrigger.dataset.flagsExpr !== undefined ? 'expr' : 'kw';
      var fId = fTrigger.dataset.flagsExpr !== undefined ? fTrigger.dataset.flagsExpr : fTrigger.dataset.flagsKw;
      var fPopover = document.querySelector('.flags-popover[data-flags-' + fKind + '="' + fId + '"]');
      var fWasOpen = fPopover && fPopover.classList.contains('show');
      closeAllPopovers();
      if (fPopover && !fWasOpen) {
        var fRect = fTrigger.getBoundingClientRect();
        fPopover.style.left = Math.max(2, fRect.left) + 'px';
        if (fRect.bottom + 120 > window.innerHeight && fRect.top > 120) {
          fPopover.style.top = (fRect.top - 120) + 'px';
        } else {
          fPopover.style.top = (fRect.bottom + 4) + 'px';
        }
        fPopover.classList.add('show');
      }
      return;
    }

    // ── 点击 flags 弹出面板内部不关闭 ──
    if (e.target.closest('.flags-popover')) { return; }

    // ── 点击其他区域关闭所有面板 ──
    closeAllPopovers();

    var btn = e.target.closest('button, input[data-action]'); if (!btn) return;
    var action = btn.dataset.action;
    var gi = parseInt(btn.dataset.gi), ei = parseInt(btn.dataset.ei);
    if (btn.id === 'go-btn') {
      collectData(); var se = collectStartEnd();
      startPattern = se.startPattern; endPattern = se.endPattern;
      rangeDescription = se.rangeDescription;
      namedRanges = se.namedRanges; activeRangeId = se.activeRangeId;
      var tf = document.getElementById('time-format');
      timePattern = { format: tf ? tf.value : '' };
      saveState();
      vscode.postMessage({ type: 'go', groups: groups, startPattern: startPattern, endPattern: endPattern, rangeDescription: rangeDescription, namedRanges: namedRanges, activeRangeId: activeRangeId, timePattern: timePattern, keywords: keywords });
    } else if (btn.id === 'clear-btn') {
      vscode.postMessage({ type: 'clear' });
    } else if (btn.id === 'reset-btn') {
      groups = []; keywords = [];
      matchCounts = null;
      startPattern = undefined; endPattern = undefined;
      rangeDescription = undefined;
      namedRanges = []; activeRangeId = undefined;
      rangeTimeInfoHtml = '';
      timePattern = { format: '' }; saveState();
      vscode.postMessage({ type: 'reset' });
      render();
    } else if (btn.id === 'cfg-export-btn') {
      collectData(); var se2 = collectStartEnd();
      startPattern = se2.startPattern; endPattern = se2.endPattern;
      rangeDescription = se2.rangeDescription;
      namedRanges = se2.namedRanges; activeRangeId = se2.activeRangeId;
      var tf2 = document.getElementById('time-format');
      timePattern = { format: tf2 ? tf2.value : '' };
      saveState();
      vscode.postMessage({ type: 'exportConfig', groups: groups, startPattern: startPattern, endPattern: endPattern, rangeDescription: rangeDescription, namedRanges: namedRanges, activeRangeId: activeRangeId, timePattern: timePattern, keywords: keywords });
    } else if (btn.id === 'cfg-import-btn') {
      vscode.postMessage({ type: 'importConfig' });
    } else if (btn.id === 'cfg-save-btn') {
      collectData(); var se3 = collectStartEnd();
      startPattern = se3.startPattern; endPattern = se3.endPattern;
      rangeDescription = se3.rangeDescription;
      namedRanges = se3.namedRanges; activeRangeId = se3.activeRangeId;
      var tf3 = document.getElementById('time-format');
      timePattern = { format: tf3 ? tf3.value : '' };
      saveState();
      var saveName = document.getElementById('cfg-save-name').value.trim();
      var saveScope = document.getElementById('cfg-save-scope').value;
      if (!saveName) { alert('Please enter a config name.'); return; }
      vscode.postMessage({ type: 'saveConfig', name: saveName, scope: saveScope, groups: groups, startPattern: startPattern, endPattern: endPattern, rangeDescription: rangeDescription, namedRanges: namedRanges, activeRangeId: activeRangeId, timePattern: timePattern, keywords: keywords });
    } else if (btn.id === 'cfg-apply-btn') {
      var applySel = document.getElementById('cfg-apply-select');
      var applyVal = applySel ? applySel.value : '';
      if (applyVal === '') { alert('Please select a saved config.'); return; }
      var idx = parseInt(applyVal, 10);
      var item = savedConfigsList[idx];
      if (!item) { return; }
      vscode.postMessage({ type: 'applySavedConfig', name: item.name, scope: item.scope });
    } else if (btn.id === 'cfg-delete-btn') {
      var delSel = document.getElementById('cfg-apply-select');
      var delVal = delSel ? delSel.value : '';
      if (delVal === '') { alert('Please select a saved config to delete.'); return; }
      var didx = parseInt(delVal, 10);
      var ditem = savedConfigsList[didx];
      if (!ditem) { return; }
      vscode.postMessage({ type: 'deleteSavedConfig', name: ditem.name, scope: ditem.scope });
    } else if (action === 'addGroup') {
      groups.push({ id: uuid(), name: 'New Group', color: randomColor(), expressions: [{ id: uuid(), pattern: '', flags: '', operator: 'and', enabled: true }], enabled: true });
      saveState(); render();
    } else if (action === 'removeGroup') { groups.splice(gi, 1); saveState(); render(); }
    else if (action === 'addExpr') {
      groups[gi].expressions.push({ id: uuid(), pattern: '', flags: '', operator: 'and', enabled: true });
      saveState(); render();
    } else if (action === 'removeExpr') { groups[gi].expressions.splice(ei, 1); saveState(); render(); }
    else if (action === 'moveExprUp' && ei > 0) {
      var exprs = groups[gi].expressions;
      var tmp = exprs[ei]; exprs[ei] = exprs[ei - 1]; exprs[ei - 1] = tmp;
      saveState(); render();
    } else if (action === 'moveExprDown' && ei < groups[gi].expressions.length - 1) {
      var exprs = groups[gi].expressions;
      var tmp = exprs[ei]; exprs[ei] = exprs[ei + 1]; exprs[ei + 1] = tmp;
      saveState(); render();
    }
    else if (action === 'addKeyword') {
      keywords.push({ id: uuid(), pattern: '', flags: '', color: randomColor(), enabled: true, matchScope: 'matched' });
      saveState(); render();
    } else if (action === 'removeKeyword') {
      var ki = parseInt(btn.dataset.ki);
      keywords.splice(ki, 1); saveState(); render();
    }
    else if (action === 'addRange') {
      collectRangeData();
      var nr = { id: uuid(), name: 'Range ' + (namedRanges.length + 1), startPattern: '', endPattern: '' };
      namedRanges.push(nr);
      if (!activeRangeId) { activeRangeId = nr.id; }
      saveState(); render();
    } else if (action === 'removeRange') {
      var ri = parseInt(btn.dataset.ri);
      var removed = namedRanges[ri];
      namedRanges.splice(ri, 1);
      if (activeRangeId === removed.id) {
        activeRangeId = namedRanges.length > 0 ? namedRanges[0].id : undefined;
      }
      saveState(); render();
    } else if (action === 'activateRange') {
      var ri = parseInt(btn.dataset.ri);
      if (namedRanges[ri]) { activeRangeId = namedRanges[ri].id; saveState(); render(); }
    }
    else if (action === 'toggleSection') {
      var secId = btn.dataset.section;
      var body = document.querySelector('#section-' + secId + ' .section-body');
      var toggle = document.querySelector('#section-' + secId + ' .section-toggle');
      var section = document.getElementById('section-' + secId);
      if (body) {
        var isOpen = !body.classList.contains('collapsed');
        if (isOpen) {
          body.classList.add('collapsed');
          if (toggle) { toggle.classList.remove('open'); toggle.textContent = '▶'; }

        } else {
          body.classList.remove('collapsed');
          if (toggle) { toggle.classList.add('open'); toggle.textContent = '▼'; }
        }
      }
    }
  });

  document.getElementById('app').addEventListener('input', function(e) {
    var el = e.target, gi = parseInt(el.dataset.gi), ei = parseInt(el.dataset.ei);
    var ki = parseInt(el.dataset.ki);
    if (el.id === 'time-format') { timePattern.format = el.value; saveState(); return; }
    // Range inputs
    if (el.classList.contains('range-name') || el.classList.contains('range-from') || el.classList.contains('range-to')) {
      var ri = parseInt(el.dataset.ri);
      if (!isNaN(ri) && namedRanges[ri]) {
        if (el.classList.contains('range-name')) namedRanges[ri].name = el.value;
        else if (el.classList.contains('range-from')) namedRanges[ri].startPattern = el.value;
        else if (el.classList.contains('range-to')) namedRanges[ri].endPattern = el.value;
        saveState(); return;
      }
    }
    // Keyword inputs
    if (!isNaN(ki)) {
      if (el.classList.contains('pattern')) { keywords[ki].pattern = el.value; syncToExtension(); }
      else if (el.classList.contains('hint')) keywords[ki].hint = el.value || undefined;
      saveState(); return;
    }
    if (isNaN(gi)) return;
    if (el.classList.contains('group-name')) groups[gi].name = el.value;
    else if (el.classList.contains('group-first-expr') && !isNaN(ei)) groups[gi].expressions[ei].pattern = el.value;
    else if (el.classList.contains('pattern') && !isNaN(ei)) groups[gi].expressions[ei].pattern = el.value;
    saveState();
  });

  document.getElementById('app').addEventListener('change', function(e) {
    var el = e.target, gi = parseInt(el.dataset.gi), ei = parseInt(el.dataset.ei);
    var ki = parseInt(el.dataset.ki);
    // 原生颜色选择器变更
    if (el.classList.contains('native-color')) {
      var nk = el.dataset.colorGi !== undefined ? 'gi' : 'ki';
      var nv = el.dataset.colorGi !== undefined ? el.dataset.colorGi : el.dataset.colorKi;
      setColor(nk, nv, el.value);
      return;
    }
    if (el.classList.contains('expr-op')) {
      groups[gi].expressions[ei].operator = el.value; saveState();
    } else if (el.classList.contains('group-enabled')) {
      groups[gi].enabled = el.checked; saveState();
    } else if (el.classList.contains('expr-enabled')) {
      groups[gi].expressions[ei].enabled = el.checked; saveState();
    } else if (el.classList.contains('keyword-enabled')) {
      keywords[ki].enabled = el.checked; saveState();
    }
    // Flags 复选框变更
    if (el.dataset.flag) {
      if (el.dataset.flag === 'matched') {
        // matchScope toggle for keywords
        var fid = el.dataset.flagsKw;
        var parts = fid.split(':');
        var ki2 = parseInt(parts[1]);
        if (keywords[ki2]) {
          keywords[ki2].matchScope = el.checked ? 'matched' : 'full';
          saveState();
        }
      } else {
        var fk = el.dataset.flagsExpr !== undefined ? 'expr' : 'kw';
        var fid2 = el.dataset.flagsExpr !== undefined ? el.dataset.flagsExpr : el.dataset.flagsKw;
        var parts2 = fid2.split(':');
        if (fk === 'expr') {
          setFlags('expr', parseInt(parts2[0]), parseInt(parts2[1]), null);
        } else {
          setFlags('kw', null, null, parseInt(parts2[1]));
        }
      }
    }
  });

  function randomColor() {
    return '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6,'0');
  }

  function collectData() {
    document.querySelectorAll('.group-enabled').forEach(function(el) {
      groups[parseInt(el.dataset.gi)].enabled = el.checked;
    });
    document.querySelectorAll('.group-name').forEach(function(el) {
      groups[parseInt(el.dataset.gi)].name = el.value;
    });
    document.querySelectorAll('.expr-enabled').forEach(function(el) {
      var gii = parseInt(el.dataset.gi), eii = parseInt(el.dataset.ei);
      if (!isNaN(eii)) groups[gii].expressions[eii].enabled = el.checked;
    });
    document.querySelectorAll('.pattern, .group-first-expr').forEach(function(el) {
      var gii = parseInt(el.dataset.gi), eii = parseInt(el.dataset.ei);
      var kii = parseInt(el.dataset.ki);
      if (!isNaN(eii)) groups[gii].expressions[eii].pattern = el.value;
      else if (!isNaN(kii)) keywords[kii].pattern = el.value;
    });
    // 颜色从 trigger 读取
    document.querySelectorAll('.color-trigger[data-color-gi]').forEach(function(el) {
      groups[parseInt(el.dataset.colorGi)].color = rgbToHex(el.style.background);
    });
    document.querySelectorAll('.color-trigger[data-color-ki]').forEach(function(el) {
      keywords[parseInt(el.dataset.colorKi)].color = rgbToHex(el.style.background);
    });
    document.querySelectorAll('.keyword-enabled').forEach(function(el) {
      keywords[parseInt(el.dataset.ki)].enabled = el.checked;
    });
    document.querySelectorAll('.hint').forEach(function(el) {
      var kii = parseInt(el.dataset.ki);
      if (!isNaN(kii)) keywords[kii].hint = el.value || undefined;
    });
  }

  function rgbToHex(rgb) {
    if (!rgb || rgb === '') return '#000000';
    if (rgb.startsWith('#')) return rgb;
    var m = rgb.match(/\\d+/g);
    if (!m) return '#000000';
    return '#' + m.slice(0,3).map(function(x) {
      return parseInt(x).toString(16).padStart(2,'0');
    }).join('');
  }

  window.addEventListener('message', function(event) {
    var msg = event.data;
    if (msg.type === 'updateConfig') {
      groups = msg.groups;
      startPattern = msg.startPattern;
      endPattern = msg.endPattern;
      rangeDescription = msg.rangeDescription;
      namedRanges = msg.namedRanges || [];
      activeRangeId = msg.activeRangeId;
      keywords = msg.keywords || [];
      timePattern = msg.timePattern || { format: '' };
      rangeTimeInfoHtml = '';
      migrateOldRanges();
      saveState();
      render();
    } else if (msg.type === 'configApplied') {
      // Apply: load the saved config into the panel (user still needs to click Go)
      groups = msg.groups || [];
      startPattern = msg.startPattern;
      endPattern = msg.endPattern;
      rangeDescription = msg.rangeDescription;
      namedRanges = msg.namedRanges || [];
      activeRangeId = msg.activeRangeId;
      keywords = msg.keywords || [];
      timePattern = msg.timePattern || { format: '' };
      rangeTimeInfoHtml = '';
      migrateOldRanges();
      saveState();
      render();
    } else if (msg.type === 'configImported') {
      if (msg.error) {
        alert('Import failed: ' + msg.error);
      } else if (msg.config) {
        groups = msg.config.groups || [];
        startPattern = msg.config.startPattern;
        endPattern = msg.config.endPattern;
        rangeDescription = msg.config.rangeDescription;
        namedRanges = msg.config.namedRanges || [];
        activeRangeId = msg.config.activeRangeId;
        keywords = msg.config.keywords || [];
        timePattern = msg.config.timePattern || { format: '' };
        rangeTimeInfoHtml = '';
        migrateOldRanges();
        saveState();
        render();
      }
    } else if (msg.type === 'rangeTimeInfo') {
      var info = msg;
      if (info.startTime) {
        var parts = [];
        if (info.startTime) { parts.push('⏱ ' + info.startTime); }
        if (info.endTime && info.endTime !== info.startTime) { parts.push(' → ' + info.endTime); }
        if (info.duration) { parts.push('  (' + info.duration + ')'); }
        rangeTimeInfoHtml = parts.join('');
      } else {
        rangeTimeInfoHtml = '';
      }
      render();
    } else if (msg.type === 'timelineData') {
      tlData = msg;
      tlViewMin = null; tlViewMax = null;
      tlRefresh();
    } else if (msg.type === 'matchCounts') {
      matchCounts = msg;
      render();
      tlRefresh();
    } else if (msg.type === 'savedConfigsList') {
      // Update the saved configs dropdown
      savedConfigsList = msg.configs || [];
      var sel = document.getElementById('cfg-apply-select');
      if (sel) {
        var curIdx = sel.value;
        sel.innerHTML = '<option value="">-- Select saved --</option>';
        savedConfigsList.forEach(function(c, i) {
          var opt = document.createElement('option');
          opt.value = String(i);
          opt.textContent = '[' + c.scope + '] ' + c.name;
          sel.appendChild(opt);
        });
        // Restore previous selection if still valid
        if (curIdx !== '' && parseInt(curIdx, 10) < savedConfigsList.length) {
          sel.value = curIdx;
        }
      }
    }
  });

  render();

  // ── Keyword Timeline ──
  var tlData = null, tlViewMin = null, tlViewMax = null, tlDrawRAF = null;
  var tlPad = { top: 6, right: 40, bottom: 22, left: 80 };
  var tlDotR = 3, tlRowH = 13, tlRowGap = 2, tlMinZoom = 1000;
  var tlCtx = null;

  function formatOffset(ms) {
    if (ms < 0) return '0';
    if (ms < 1000) return Math.round(ms) + 'ms';
    var s = ms / 1000;
    if (s < 60) return s.toFixed(1) + 's';
    var m = Math.floor(s / 60);
    var rs = Math.round(s % 60);
    if (m < 60) return m + 'm ' + rs + 's';
    var h = Math.floor(m / 60);
    var rm = Math.round(m % 60);
    if (h < 24) return h + 'h ' + rm + 'm';
    var d = Math.floor(h / 24);
    return d + 'd ' + Math.round(h % 24) + 'h';
  }

  function tlInitCtx() {
    var cv = document.getElementById('tl-canvas');
    if (!cv) return;
    tlCtx = cv.getContext('2d');
    if (!tlCtx) return;
    var dpr = window.devicePixelRatio || 1;
    var rect = cv.parentElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    cv.width = rect.width * dpr;
    cv.height = rect.height * dpr;
    cv.style.width = rect.width + 'px';
    cv.style.height = rect.height + 'px';
    tlCtx.scale(dpr, dpr);
    return { w: rect.width, h: rect.height };
  }

  /** 刷新 timeline：管理可见性、初始化 canvas 并绘制 */
  function tlRefresh() {
    var emptyEl = document.getElementById('tl-empty');
    if (tlData && tlData.keywords && tlData.keywords.length) {
      if (emptyEl) emptyEl.style.display = 'none';
      // 部分 Linux 机器上布局延迟，dimensions 为 0 时延迟一帧重试
      if (!tlInitCtx()) {
        requestAnimationFrame(function() {
          if (tlInitCtx()) tlDraw();
        });
      } else {
        tlDraw();
      }
    } else {
      if (emptyEl) emptyEl.style.display = 'flex';
    }
  }

  function tlDraw() {
    if (!tlCtx || !tlData || !tlData.keywords.length) return;
    // 隐藏空状态提示，确保 canvas 可见
    var emptyEl = document.getElementById('tl-empty');
    if (emptyEl) emptyEl.style.display = 'none';
    var dim = tlInitCtx();
    if (!dim) return;
    var W = dim.w, H = dim.h;
    tlCtx.clearRect(0, 0, W, H);
    var pl = tlPad.left, pr = tlPad.right, pt = tlPad.top, pb = tlPad.bottom;
    var pw = W - pl - pr, ph = H - pt - pb;
    if (pw <= 0 || ph <= 0) return;
    var kws = tlData.keywords, n = kws.length;
    var rh = tlRowH + tlRowGap;
    var rowsH = n * rh;
    if (rowsH > ph) { rh = ph / n; }
    var tlMin = tlViewMin != null ? tlViewMin : tlData.timeMin;
    var tlMax = tlViewMax != null ? tlViewMax : tlData.timeMax;
    var tRange = tlMax - tlMin || 1;
    // grid lines
    tlCtx.strokeStyle = 'rgba(128,128,128,0.15)';
    tlCtx.lineWidth = 1;
    for (var i = 0; i <= n; i++) {
      var gy = pt + i * (rh || 1);
      tlCtx.beginPath(); tlCtx.moveTo(pl, gy); tlCtx.lineTo(W - pr, gy); tlCtx.stroke();
    }
    // dots
    for (var ki = 0; ki < n; ki++) {
      var kw = kws[ki];
      var yTop = pt + ki * (rh || 1);
      var yMid = yTop + (rh || 1) / 2;

      // Row background
      tlCtx.fillStyle = 'rgba(128,128,128,0.03)';
      tlCtx.fillRect(pl, yTop, pw, (rh || 1));

      // Keyword label on y-axis
      tlCtx.fillStyle = kw.color;
      tlCtx.textAlign = 'right';
      tlCtx.font = '10px sans-serif';
      var labelText = kw.name.length > 16 ? kw.name.slice(0, 15) + '…' : kw.name;
      tlCtx.fillText(labelText, pl - 6, yMid + 3);

      if (!kw.points) continue;
      tlCtx.fillStyle = kw.color;
      for (var pi = 0; pi < kw.points.length; pi++) {
        var p = kw.points[pi];
        var cx = pl + ((p.time - tlMin) / tRange) * pw;
        tlCtx.beginPath(); tlCtx.arc(cx, yMid, tlDotR, 0, Math.PI * 2); tlCtx.fill();
        tlCtx.strokeStyle = 'rgba(0,0,0,0.4)';
        tlCtx.lineWidth = 0.5;
        tlCtx.stroke();
        tlCtx.lineWidth = 1;
      }
    }
    // ruler — 相对时间差
    var chartBottom = pt + n * (rh || 1);
    var bodyStyle = getComputedStyle(document.body);
    var axisColor = bodyStyle.getPropertyValue('--vscode-descriptionForeground') || '#999999';
    tlCtx.fillStyle = axisColor;
    tlCtx.textAlign = 'center';
    tlCtx.font = '9px sans-serif';
    var steps = 5;
    for (var si = 0; si <= steps; si++) {
      var tx = pl + (si / steps) * pw;
      var elapsed = (si / steps) * tRange;
      tlCtx.fillText(formatOffset(elapsed), tx, chartBottom + 13);
    }
  }

  function tlPointAt(mx, my) {
    if (!tlCtx || !tlData || !tlData.keywords.length) return null;
    var cv = document.getElementById('tl-canvas');
    if (!cv) return null;
    var rect = cv.getBoundingClientRect();
    var pl = tlPad.left, pr = tlPad.right, pt = tlPad.top;
    var W = rect.width, pw = W - pl - pr;
    if (pw <= 0) return null;
    var tlMin = tlViewMin != null ? tlViewMin : tlData.timeMin;
    var tlMax = tlViewMax != null ? tlViewMax : tlData.timeMax;
    var tRange = tlMax - tlMin || 1;
    var kws = tlData.keywords, n = kws.length;
    var rh = tlRowH + tlRowGap;
    var rowsH = n * rh;
    var ch = rect.height;
    if (rowsH > ch - tlPad.top - tlPad.bottom) { rh = (ch - tlPad.top - tlPad.bottom) / n; }
    for (var ki = 0; ki < n; ki++) {
      var kw = kws[ki];
      if (!kw.points) continue;
      var cy = pt + ki * (rh || 1) + (rh || 1) / 2;
      for (var pi = 0; pi < kw.points.length; pi++) {
        var p = kw.points[pi];
        var cx = pl + ((p.time - tlMin) / tRange) * pw;
        var dx = mx - cx, dy = my - cy;
        if (dx * dx + dy * dy < (tlDotR + 6) * (tlDotR + 6)) {
          return { keyword: kw, point: p, cx: cx, cy: cy };
        }
      }
    }
    return null;
  }

  // ── Timeline 事件（委托到 #app，dom 重建后仍生效）──
  var tlEventsSetup = false;
  function tlSetupEvents() {
    if (tlEventsSetup) return;
    tlEventsSetup = true;
    var app = document.getElementById('app');
    if (!app) return;

    app.addEventListener('mousemove', function(e) {
      var cv = document.getElementById('tl-canvas');
      if (!cv || !tlData) return;
      var r = cv.getBoundingClientRect();
      var mx = e.clientX - r.left, my = e.clientY - r.top;
      if (mx < 0 || my < 0 || mx > r.width || my > r.height) return;
      var hit = tlPointAt(mx, my);
      var tip = document.getElementById('tl-tooltip');
      if (hit && tip) {
        tip.style.display = 'block';
        tip.style.left = (mx + 10) + 'px';
        tip.style.top = (my - 20) + 'px';
        var tMin = tlViewMin != null ? tlViewMin : tlData.timeMin;
        var relMs = hit.point.time - tMin;
        tip.textContent = hit.keyword.name + ' L' + (hit.point.lineNumber + 1) + ' +' + formatOffset(relMs);
      } else if (tip) {
        tip.style.display = 'none';
      }
    });
    app.addEventListener('click', function(e) {
      var cv = document.getElementById('tl-canvas');
      if (!cv || !tlData) return;
      var r = cv.getBoundingClientRect();
      var mx = e.clientX - r.left, my = e.clientY - r.top;
      if (mx < 0 || my < 0 || mx > r.width || my > r.height) return;
      var hit = tlPointAt(mx, my);
      if (hit) {
        vscode.postMessage({ type: 'timelineClick', lineNumber: hit.point.lineNumber });
      }
    });
    app.addEventListener('wheel', function(e) {
      var cv = document.getElementById('tl-canvas');
      if (!cv || !tlData) return;
      var r = cv.getBoundingClientRect();
      var mx = e.clientX - r.left, my = e.clientY - r.top;
      if (mx < 0 || my < 0 || mx > r.width || my > r.height) return;
      e.preventDefault();
      var cl = tlPad.left, cr2 = r.width - tlPad.right, cw = cr2 - cl;
      var frac = Math.max(0, Math.min(1, (mx - cl) / cw));
      var mt = (tlViewMin != null ? tlViewMin : tlData.timeMin) + frac * ((tlViewMax != null ? tlViewMax : tlData.timeMax) - (tlViewMin != null ? tlViewMin : tlData.timeMin));
      var factor = e.deltaY > 0 ? 1.5 : 0.67;
      var half = ((tlViewMax != null ? tlViewMax : tlData.timeMax) - (tlViewMin != null ? tlViewMin : tlData.timeMin)) * factor / 2;
      var nmin = mt - half, nmax = mt + half;
      if (nmax - nmin < tlMinZoom) { var mid = (nmin + nmax) / 2; nmin = mid - tlMinZoom / 2; nmax = mid + tlMinZoom / 2; }
      if (nmin < tlData.timeMin) { nmin = tlData.timeMin; nmax = nmin + (tlViewMax != null ? tlViewMax : tlData.timeMax) - (tlViewMin != null ? tlViewMin : tlData.timeMin); }
      if (nmax > tlData.timeMax) { nmax = tlData.timeMax; nmin = nmax - (tlViewMax != null ? tlViewMax : tlData.timeMax) + (tlViewMin != null ? tlViewMin : tlData.timeMin); }
      tlViewMin = nmin; tlViewMax = nmax;
      var zoomEl = document.getElementById('tl-zoom');
      if (zoomEl) zoomEl.textContent = ((nmax - nmin) / 1000).toFixed(1) + 's';
      tlDraw();
    }, { passive: false });
  }
  tlSetupEvents();
})();
</script>
</body>
</html>`;
  }
}
