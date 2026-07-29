// ConfigPanel — 左侧边栏 WebviewView 配置面板
import * as vscode from 'vscode';
import { RegexGroup, RegexExpression, LogicOperator, TimePatternConfig, KeywordConfig, ConfigScope, WebviewMessage, ExtensionMessage } from '../types';

export class ConfigPanel implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private goCallback: ((groups: RegexGroup[], timePattern?: TimePatternConfig, keywords?: KeywordConfig[]) => void) | undefined;
  private resetCallback: (() => void) | undefined;
  private clearCallback: (() => void) | undefined;
  private exportMatchedCallback: (() => void) | undefined;
  private gotoKeywordHitCallback: ((direction: 'next' | 'prev', keywordId: string) => void) | undefined;
  private gotoGroupHitCallback: ((direction: 'prev' | 'next', groupId: string) => void) | undefined;
  private keywordBadgeClickCallback: ((keywordId: string, targetIndex: number) => void) | undefined;
  private exportCallback: ((groups: RegexGroup[], timePattern?: TimePatternConfig, keywords?: KeywordConfig[]) => void) | undefined;
  private importCallback: (() => void) | undefined;
  private saveCallback: ((name: string, groups: RegexGroup[], timePattern?: TimePatternConfig, keywords?: KeywordConfig[]) => void) | undefined;
  private requestSaveCallback: ((groups: RegexGroup[], timePattern?: TimePatternConfig, keywords?: KeywordConfig[]) => void) | undefined;
  private listSavedCallback: (() => void) | undefined;
  private applyCallback: ((name: string, scope: ConfigScope) => void) | undefined;
  private deleteCallback: ((name: string, scope: ConfigScope) => void) | undefined;
  /** 缓存最近一次 groups 和行范围用于 webview 尚未就绪时 */
  private pendingGroups: RegexGroup[] = [];
  private pendingKeywords?: KeywordConfig[];

  /** WebviewViewProvider 接口：VS Code 创建/重建 webview 时调用 */
  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.buildHtml();

    webviewView.webview.onDidReceiveMessage((msg: WebviewMessage) => {
      try {
      switch (msg.type) {
        case 'go':
          this.goCallback?.(msg.groups, msg.timePattern, msg.keywords);
          break;
        case 'reset':
          this.resetCallback?.();
          break;
        case 'clear':
          this.clearCallback?.();
          break;
        case 'exportMatchedLines':
          this.exportMatchedCallback?.();
          break;
        case 'gotoKeywordMatch':
          this.gotoKeywordHitCallback?.(msg.direction, msg.keywordId || '');
          break;
        case 'gotoGroupMatch':
          this.gotoGroupHitCallback?.(msg.direction, msg.groupId || '');
          break;
        case 'keywordBadgeClick':
          this.keywordBadgeClickCallback?.(msg.keywordId || '', msg.targetIndex ?? 0);
          break;
        case 'exportConfig':
          this.exportCallback?.(msg.groups, msg.timePattern, msg.keywords);
          break;
        case 'importConfig':
          this.importCallback?.();
          break;
        case 'saveConfig':
          this.saveCallback?.(msg.name, msg.groups, msg.timePattern, msg.keywords);
          break;
        case 'requestSaveConfig':
          this.requestSaveCallback?.(msg.groups, msg.timePattern, msg.keywords);
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
          this.syncConfigCallback?.(msg.groups, msg.timePattern, msg.keywords);
          break;
        case 'timelineClick':
          this.timelineClickCallback?.(msg.lineNumber);
          break;
      }
      } catch (err: any) {
        console.error('Log--: Webview message handler error:', err.message || err);
      }
    });

    if (this.pendingGroups.length > 0 || this.pendingTimePattern || this.pendingKeywords) {
      this.sendUpdate(this.pendingGroups, this.pendingTimePattern, this.pendingKeywords);
    }
  }

  private pendingTimePattern?: TimePatternConfig;

  render(groups: RegexGroup[], timePattern?: TimePatternConfig, keywords?: KeywordConfig[]): void {
    this.pendingGroups = groups;
    this.pendingTimePattern = timePattern;
    this.pendingKeywords = keywords;
    if (this.view) {
      this.sendUpdate(groups, timePattern, keywords);
    }
  }

  onGo(callback: (groups: RegexGroup[], timePattern?: TimePatternConfig, keywords?: KeywordConfig[]) => void): void {
    this.goCallback = callback;
  }

  onReset(callback: () => void): void {
    this.resetCallback = callback;
  }

  onClear(callback: () => void): void {
    this.clearCallback = callback;
  }
  onExportMatchedLines(callback: () => void): void {
    this.exportMatchedCallback = callback;
  }
  onGotoKeywordHit(callback: (direction: 'next' | 'prev', keywordId: string) => void): void {
    this.gotoKeywordHitCallback = callback;
  }

  onGotoGroupHit(callback: (direction: 'prev' | 'next', groupId: string) => void): void {
    this.gotoGroupHitCallback = callback;
  }

  onKeywordBadgeClick(callback: (keywordId: string, targetIndex: number) => void): void {
    this.keywordBadgeClickCallback = callback;
  }

  sendKeywordCursorInfo(msg: { type: 'keywordCursorInfo'; infos: { keywordId: string; currentIndex: number }[] }): void {
    this.view?.webview.postMessage(msg);
  }

  onExport(callback: (groups: RegexGroup[], timePattern?: TimePatternConfig, keywords?: KeywordConfig[]) => void): void {
    this.exportCallback = callback;
  }

  onImport(callback: () => void): void {
    this.importCallback = callback;
  }

  onSave(callback: (name: string, groups: RegexGroup[], timePattern?: TimePatternConfig, keywords?: KeywordConfig[]) => void): void {
    this.saveCallback = callback;
  }

  onRequestSave(callback: (groups: RegexGroup[], timePattern?: TimePatternConfig, keywords?: KeywordConfig[]) => void): void {
    this.requestSaveCallback = callback;
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

  onSyncConfig(callback: (groups: RegexGroup[], timePattern?: TimePatternConfig, keywords?: KeywordConfig[]) => void): void {
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

  private syncConfigCallback: ((groups: RegexGroup[], timePattern?: TimePatternConfig, keywords?: KeywordConfig[]) => void) | undefined;
  private timelineClickCallback: ((lineNumber: number) => void) | undefined;

  /** 向 webview 发送已保存配置列表 */
  sendSavedConfigsList(configs: { name: string; scope: ConfigScope }[]): void {
    this.view?.webview.postMessage({
      type: 'savedConfigsList' as const,
      configs,
    } satisfies ExtensionMessage);
  }

  /** 向 webview 发送指定配置数据（apply/import 结果） */
  sendConfigApplied(groups: RegexGroup[], timePattern?: TimePatternConfig, keywords?: KeywordConfig[]): void {
    this.view?.webview.postMessage({
      type: 'configApplied' as const,
      groups,
      timePattern,
      keywords,
    } satisfies ExtensionMessage);
  }

  /** 向 webview 发送导入结果（含错误信息） */
  sendConfigImported(config?: { groups: RegexGroup[]; timePattern?: TimePatternConfig; keywords?: KeywordConfig[] }, error?: string): void {
    this.view?.webview.postMessage({
      type: 'configImported' as const,
      config: config ? { groups: config.groups, timePattern: config.timePattern, keywords: config.keywords } : undefined,
      error,
    } satisfies ExtensionMessage);
  }

  private sendUpdate(groups: RegexGroup[], timePattern?: TimePatternConfig, keywords?: KeywordConfig[]): void {
    this.view?.webview.postMessage({
      type: 'updateConfig' as const,
      groups,
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
  .group-card.drag-ready { cursor: grabbing; box-shadow: 0 0 4px var(--vscode-focusBorder); }
  .group-header { display: flex; align-items: center; gap: 3px; margin-bottom: 2px; flex-wrap: wrap; }
  .group-header input[type="checkbox"] { margin: 0; cursor: pointer; flex-shrink: 0; }
  .group-header input[type="text"] { background: var(--vscode-input-background);
        color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);
        padding: 1px 3px; border-radius: 2px; font-size: 11px; }
  .group-header .group-name { flex: 0 1 60px; min-width: 40px; }
  .group-header .group-first-expr { flex: 1 1 60px; min-width: 40px; }
  .remove-btn { background: none; border: none; color: var(--vscode-errorForeground);
                cursor: pointer; font-size: 14px; line-height: 1; padding: 0 2px; flex-shrink: 0; }
  .kw-nav-btn { background: none; border: none; color: var(--vscode-descriptionForeground);
                cursor: pointer; font-size: 12px; line-height: 1; padding: 0 2px; flex-shrink: 0; }
  .kw-nav-btn:hover { color: var(--vscode-foreground); }
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

  .keyword-row { display: flex; align-items: center; gap: 3px; margin-bottom: 3px;
                 padding: 3px; background: var(--vscode-input-background); border-radius: 2px; }
  .keyword-row input[type="text"] { flex: 1; background: transparent;
        color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);
        padding: 1px 4px; border-radius: 2px; font-size: 11px; }
  .keyword-row input.pattern { min-width: 40px; width: 90px; flex: 0 0 90px; }
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
  .kw-count-badge[data-kw-clickable] { cursor: pointer; }
  .kw-count-badge[data-kw-clickable]:hover { filter: brightness(1.3); }

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

  /* ── Advance section ── */
  .advance-sub-item { margin-bottom: 6px; }
  .advance-sub-item:last-child { margin-bottom: 0; }
  .advance-label { font-size: 11px; color: var(--vscode-descriptionForeground);
    white-space: nowrap; width: 58px; text-align: right; flex-shrink: 0; }
  .cfg-mgmt-row { display: flex; align-items: center; gap: 3px; margin-bottom: 4px; }
  .cfg-mgmt-row label { font-size: 10px; color: var(--vscode-descriptionForeground);
                        white-space: nowrap; }
  .cfg-mgmt-row input[type="text"] { flex: 1; min-width: 0;
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);
        padding: 1px 2px; border-radius: 2px; font-size: 10px; height: 18px; box-sizing: border-box; }
  .cfg-mgmt-row select { background: var(--vscode-dropdown-background);
        color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border);
        padding: 1px 2px; border-radius: 2px; font-size: 10px; height: 18px; box-sizing: border-box; }
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
  let state = vscode.getState() || { groups: [], timePattern: undefined, keywords: [], sectionState: {} };
  let groups = state.groups || [];
  let keywords = state.keywords || [];
  let timePattern = state.timePattern || { format: '' };
  let sectionState = state.sectionState || { advance: false };
  var savedConfigsList = [];
  var selectedSavedConfigName = '';  // 记住用户在下拉框中选择的配置名
  var matchCounts = null;  // { totalLines, totalMatched, groupCounts, keywordCounts }
  var kwLineNums = {};  // keywordId → lineNumber[]

  function saveState() { vscode.setState({ groups, timePattern, keywords, sectionState }); }

  var syncTimer = null;
  function syncToExtension() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function() {
      vscode.postMessage({
        type: 'syncConfig',
        groups: groups,
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
    var html = '';

    // ── Time Fmt + Solution（顶层，不再折叠） ──
    html += '<div class="section">';
    html += '<div class="cfg-mgmt-row">';
    html += '<span class="advance-label">Time Fmt:</span>';
    html += '<input type="text" id="time-format" value="' + esc(timePattern?.format || '') + '" placeholder="" style="flex:1;min-width:0" title="Write the timestamp exactly as it appears. Tokens: YYYY YY MM DD HH mm ss SSS. Optional parts: {...}. Example: [YYYY-MM-DD HH:mm:ss{.SSS}]">';
    html += '</div>';
    html += '<div class="cfg-mgmt-row" style="margin-top:4px">';
    html += '<span class="advance-label">Solution:</span>';
    html += '<select id="cfg-apply-select" style="flex:1;min-width:0"><option value="">-- Select saved --</option></select>';
    html += '<button class="cfg-btn" id="cfg-apply-btn" title="Apply">▶</button>';
    html += '<button class="cfg-btn danger" id="cfg-delete-btn" title="Delete">✕</button>';
    html += '<button class="cfg-btn" id="cfg-save-btn" title="Save">💾</button>';
    html += '<button class="cfg-btn" id="cfg-export-btn" title="Export">⬆</button>';
    html += '<button class="cfg-btn" id="cfg-import-btn" title="Import">⬇</button>';
    html += '</div>';
    html += '</div>';

    // ── Section: Pattern Groups ──
    html += '<div class="section">';
    html += '<div class="section-header">Pattern Groups</div>';
    html += '<div class="section-body">';

    for (var gi = 0; gi < groups.length; gi++) {
      var g = groups[gi];
      html += '<div class="group-card" draggable="true" data-gi="' + gi + '" data-drag-ready="false">';
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
      html += '<button class="kw-nav-btn" data-action="groupGotoPrev" data-group-id="' + g.id + '" title="Previous group hit">\u2191</button>';
      html += '<button class="kw-nav-btn" data-action="groupGotoNext" data-group-id="' + g.id + '" title="Next group hit">\u2193</button>';
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
        html += '<span class="count-badge kw-count-badge' + (kc === 0 ? ' zero' : '') + '" data-kw-id="' + kw.id + '" data-kw-total="' + kc + '"' + (kc === 0 ? '' : ' data-kw-clickable="1"') + '>' + kc + '</span>';
      }
      html += '<button class="kw-nav-btn" data-action="kwGotoPrev" data-kw-id="' + kw.id + '" title="Previous hit">\u2191</button>';
      html += '<button class="kw-nav-btn" data-action="kwGotoNext" data-kw-id="' + kw.id + '" title="Next hit">\u2193</button>';
      html += '<button class="remove-btn" data-action="removeKeyword" data-ki="' + ki + '">&times;</button>';
      html += '</div>';
    }
    html += '<button class="add-btn" data-action="addKeyword" style="display:block;width:100%">+ Add Keyword</button>';
    // ── Keyword Timeline (canvas, 使用 KeywordTimeline 的改进实现) ──
    var tlHeight = Math.max(80, Math.min(300, keywords.length * 28 + 60));
    html += '<div id="tl-wrap" style="position:relative;width:100%;height:' + tlHeight + 'px;margin:4px 0;border:1px solid var(--vscode-panel-border);border-radius:4px;overflow:hidden">';
    html += '<canvas id="tl-canvas" style="display:block;width:100%;height:100%;cursor:crosshair"></canvas>';
    html += '<div id="tl-tooltip" style="position:fixed;display:none;z-index:9999;background:var(--vscode-editorHoverWidget-background);color:var(--vscode-editorHoverWidget-foreground);border:1px solid var(--vscode-editorHoverWidget-border);padding:2px 5px;border-radius:3px;font-size:11px;pointer-events:none;white-space:nowrap"></div>';
    html += '<div id="tl-zoom" style="position:absolute;bottom:2px;right:4px;font-size:10px;color:var(--vscode-descriptionForeground);pointer-events:none"></div>';
    html += '<div id="tl-empty" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--vscode-descriptionForeground);pointer-events:none">Click Go with Keywords to see timeline</div>';
    html += '</div>';
    var statsHtml = '';
    if (matchCounts) {
      statsHtml = '<span class="count-badge" style="margin-left:auto">'
        + matchCounts.totalMatched + '/' + matchCounts.totalLines + '</span>';
    }
    html += '<div class="action-bar">';
    html += '<button class="action-btn" id="go-btn">Go</button>';
    html += '<button class="action-btn reset-btn" id="clear-btn">Clear</button>';
    html += '<button class="action-btn reset-btn" id="reset-btn">Reset</button>';
    html += '<button class="action-btn reset-btn" id="export-matched-btn">Export</button>';
    html += statsHtml;
    html += '</div>';
    document.getElementById('app').innerHTML = html;
    vscode.postMessage({ type: 'listSavedConfigs' });
    // render 重建 DOM 后重新初始化 timeline canvas 并重绘
    tlCanvas = document.getElementById('tl-canvas');
    tlEventsBound = false;
    tlTooltip = document.getElementById('tl-tooltip');
    tlEmpty = document.getElementById('tl-empty');
    tlZoomEl = document.getElementById('tl-zoom');
    tlCtx = tlCanvas ? tlCanvas.getContext('2d') : null;
    tlRefresh();
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
    syncToExtension();
  }

  // ── Drag and Drop for Group Cards (long-press 2s) ──
  var dragFromGi = -1;
  var dragTimer = null, dragTimerCard = null;

  document.getElementById('app').addEventListener('mousedown', function(e) {
    var card = e.target.closest('.group-card');
    if (!card) { return; }
    // 仅左键触发长按计时
    if (e.button !== 0) { return; }
    dragTimerCard = card;
    dragTimer = setTimeout(function() {
      if (dragTimerCard) {
        dragTimerCard.dataset.dragReady = 'true';
        dragTimerCard.classList.add('drag-ready');
      }
    }, 2000);
  });
  document.getElementById('app').addEventListener('mouseup', function(e) {
    clearDragTimer();
  });
  document.getElementById('app').addEventListener('mouseleave', function(e) {
    // 只有离开 app 容器时才清理（避免在子元素间移动时误清除）
    if (e.target === document.getElementById('app')) { clearDragTimer(); }
  });
  function clearDragTimer() {
    if (dragTimer) { clearTimeout(dragTimer); dragTimer = null; }
    if (dragTimerCard) { dragTimerCard.dataset.dragReady = 'false'; dragTimerCard.classList.remove('drag-ready'); dragTimerCard = null; }
  }

  document.getElementById('app').addEventListener('dragstart', function(e) {
    var card = e.target.closest('.group-card');
    if (!card) { return; }
    if (card.dataset.dragReady !== 'true') { e.preventDefault(); return; }
    dragFromGi = parseInt(card.dataset.gi);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(dragFromGi));
    card.classList.add('dragging');
  });
  document.getElementById('app').addEventListener('dragend', function(e) {
    var card = e.target.closest('.group-card');
    if (card) { card.classList.remove('dragging'); }
    clearDragTimer();
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

    // ── Keyword 计数 badge 点击：跳转到该 keyword 指定匹配行 ──
    var badge = e.target.closest('.kw-count-badge[data-kw-clickable]');
    if (badge) {
      var bkId = badge.dataset.kwId;
      var bkIdx = parseInt(badge.dataset.kwIdx || '0', 10);
      if (bkId) {
        vscode.postMessage({ type: 'keywordBadgeClick', keywordId: bkId, targetIndex: bkIdx });
        // 同时滚动 timeline 到对应行
        var lineNum = kwLineNums[bkId] ? kwLineNums[bkId][bkIdx] : undefined;
        if (lineNum !== undefined) { tlCenterOnLine(lineNum); }
      }
      return;
    }

    var btn = e.target.closest('button, input[data-action]'); if (!btn) return;
    var action = btn.dataset.action;
    var gi = parseInt(btn.dataset.gi), ei = parseInt(btn.dataset.ei);
    if (btn.id === 'go-btn') {
      collectData();
      var tf = document.getElementById('time-format');
      timePattern = { format: tf ? tf.value : '' };
      saveState();
      vscode.postMessage({ type: 'go', groups: groups, timePattern: timePattern, keywords: keywords });
    } else if (btn.id === 'clear-btn') {
      vscode.postMessage({ type: 'clear' });
    } else if (btn.id === 'reset-btn') {
      groups = []; keywords = [];
      matchCounts = null;
      timePattern = { format: '' }; saveState();
      vscode.postMessage({ type: 'reset' });
      render();
    } else if (btn.id === 'export-matched-btn') {
      vscode.postMessage({ type: 'exportMatchedLines' });
    } else if (btn.id === 'cfg-export-btn') {
      collectData();
      var tf2 = document.getElementById('time-format');
      timePattern = { format: tf2 ? tf2.value : '' };
      saveState();
      vscode.postMessage({ type: 'exportConfig', groups: groups, timePattern: timePattern, keywords: keywords });
    } else if (btn.id === 'cfg-import-btn') {
      vscode.postMessage({ type: 'importConfig' });
    } else if (btn.id === 'cfg-save-btn') {
      collectData();
      var tf3 = document.getElementById('time-format');
      timePattern = { format: tf3 ? tf3.value : '' };
      saveState();
      vscode.postMessage({ type: 'requestSaveConfig', groups: groups, timePattern: timePattern, keywords: keywords });
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
    } else if (action === 'kwGotoPrev' || action === 'kwGotoNext') {
      var kwId = btn.dataset.kwId;
      var dir = action === 'kwGotoPrev' ? 'prev' : 'next';
      vscode.postMessage({ type: 'gotoKeywordMatch', direction: dir, keywordId: kwId });
    } else if (action === 'groupGotoPrev' || action === 'groupGotoNext') {
      var gId = btn.dataset.groupId;
      var gDir = action === 'groupGotoPrev' ? 'prev' : 'next';
      vscode.postMessage({ type: 'gotoGroupMatch', direction: gDir, groupId: gId });
    }
    else if (action === 'toggleSection') {
      var secId = btn.dataset.section;
      var body = document.querySelector('#section-' + secId + ' .section-body');
      var toggle = document.querySelector('#section-' + secId + ' .section-toggle');
      if (body) {
        var isOpen = !body.classList.contains('collapsed');
        sectionState[secId] = !isOpen;
        saveState();
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
    // 记住用户选择的已保存配置名
    if (el.id === 'cfg-apply-select') {
      var idx = parseInt(el.value, 10);
      var item = savedConfigsList[idx];
      selectedSavedConfigName = item ? item.name : '';
      return;
    }
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
      keywords = msg.keywords || [];
      timePattern = msg.timePattern || { format: '' };
      saveState();
      render();
    } else if (msg.type === 'configApplied') {
      // Apply: load the saved config into the panel (user still needs to click Go)
      groups = msg.groups || [];
      keywords = msg.keywords || [];
      timePattern = msg.timePattern || { format: '' };
      saveState();
      render();
    } else if (msg.type === 'configImported') {
      if (msg.error) {
        alert('Import failed: ' + msg.error);
      } else if (msg.config) {
        groups = msg.config.groups || [];
        keywords = msg.config.keywords || [];
        timePattern = msg.config.timePattern || { format: '' };
        saveState();
        render();
      }
    } else if (msg.type === 'matchCounts') {
      matchCounts = msg;
      if (msg.keywordLineNumbers) { kwLineNums = msg.keywordLineNumbers; }
      render();
    } else if (msg.type === 'keywordCursorInfo') {
      if (msg.infos) {
        msg.infos.forEach(function(info) {
          var total = kwLineNums[info.keywordId] ? kwLineNums[info.keywordId].length : 0;
          if (total === 0) { return; }
          var displayIdx = info.currentIndex + 1;  // 1-based display
          var badge = document.querySelector('.kw-count-badge[data-kw-id="' + info.keywordId + '"]');
          if (badge) {
            badge.textContent = displayIdx + '/' + total;
            badge.setAttribute('data-kw-idx', String(info.currentIndex));
          }
        });
      }
    } else if (msg.type === 'timelineData') {
      tlData = msg;
      tlViewMin = null; tlViewMax = null;
      tlRefresh();
    } else if (msg.type === 'savedConfigsList') {
      // Update the saved configs dropdown
      savedConfigsList = msg.configs || [];
      var sel = document.getElementById('cfg-apply-select');
      if (sel) {
        sel.innerHTML = '<option value="">-- Select saved --</option>';
        var restoredIdx = '';
        savedConfigsList.forEach(function(c, i) {
          var opt = document.createElement('option');
          opt.value = String(i);
          opt.textContent = c.name;
          sel.appendChild(opt);
          if (c.name === selectedSavedConfigName) { restoredIdx = String(i); }
        });
        // Restore previous selection by config name if it still exists
        if (restoredIdx !== '') {
          sel.value = restoredIdx;
        }
      }
    }
  });

  // ════════════════════════════════════════════════════════
  // ── Keyword Timeline (改进版：CSS 驱动尺寸 + 轮询 + 正确缩放坐标) ──
  // ════════════════════════════════════════════════════════
  var tlData = null, tlViewMin = null, tlViewMax = null;
  var tlCanvas = document.getElementById('tl-canvas');
  var tlTooltip = document.getElementById('tl-tooltip');
  var tlEmpty = document.getElementById('tl-empty');
  var tlZoomEl = document.getElementById('tl-zoom');
  var tlCtx = tlCanvas ? tlCanvas.getContext('2d') : null;
  var tlLastW = 0, tlLastH = 0;
  var tlRAF = null;
  var tlPad = { top: 4, right: 50, bottom: 20, left: 105 };
  var tlDotR = 3.5, tlRowH = 14, tlRowGap = 1;
  var tlMinZoom = 1000;

  function tlGetFont(size, fallback) {
    var family = getComputedStyle(document.body).getPropertyValue('--vscode-font-family').trim() || fallback || 'monospace';
    return size + ' ' + family;
  }

  function tlResize() {
    if (!tlCanvas) return;
    var dpr = window.devicePixelRatio || 1;
    var w = Math.max(1, tlCanvas.clientWidth || (tlCanvas.parentElement ? tlCanvas.parentElement.clientWidth : 0) || 200);
    var h = Math.max(1, tlCanvas.clientHeight || (tlCanvas.parentElement ? tlCanvas.parentElement.clientHeight : 0) || 120);
    tlLastW = w; tlLastH = h;
    tlCanvas.width = Math.floor(w * dpr);
    tlCanvas.height = Math.floor(h * dpr);
    if (tlCtx) tlCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (tlData && tlData.keywords && tlData.keywords.length > 0) { tlScheduleDraw(); }
  }

  function tlPollSize() {
    if (!tlCanvas) return;
    var w = tlCanvas.clientWidth || (tlCanvas.parentElement ? tlCanvas.parentElement.clientWidth : 0);
    var h = tlCanvas.clientHeight || (tlCanvas.parentElement ? tlCanvas.parentElement.clientHeight : 0);
    if (w !== tlLastW || h !== tlLastH) { tlResize(); }
  }
  setInterval(tlPollSize, 100);

  function tlUpdateLabelWidth() {
    if (!tlData || !tlData.keywords || tlData.keywords.length === 0) return;
    if (!tlCtx) return;
    tlCtx.font = tlGetFont('9px', 'monospace');
    var maxW = 0;
    for (var i = 0; i < tlData.keywords.length; i++) {
      var label = tlData.keywords[i].name || '';
      if (label.length > 16) label = label.slice(0, 15) + '\u2026';
      var tw = tlCtx.measureText(label).width;
      if (tw > maxW) maxW = tw;
    }
    tlPad.left = Math.max(50, Math.ceil(maxW) + 12);
  }

  function tlScheduleDraw() {
    if (tlRAF) return;
    tlRAF = requestAnimationFrame(function() { tlRAF = null; tlDraw(); });
  }

  function tlFmtDur(ms) {
    if (ms < 0) ms = -ms;
    if (ms < 1000) return Math.round(ms) + 'ms';
    return (ms / 1000).toFixed(1) + 's';
  }

  function tlSmartTicks(chartW) {
    var maxTicks = Math.max(2, Math.floor(chartW / 30));
    return Math.max(2, Math.min(10, maxTicks));
  }

  function tlDraw() {
    if (!tlCtx || !tlData || !tlData.keywords || tlData.keywords.length === 0) return;
    if (tlEmpty) tlEmpty.style.display = 'none';
    if (tlCanvas) tlCanvas.style.display = 'block';
    tlUpdateLabelWidth();
    var W = tlLastW, H = tlLastH;
    if (!W || !H) { tlResize(); W = tlLastW; H = tlLastH; }
    tlCtx.clearRect(0, 0, W, H);
    var pl = tlPad.left, pr = tlPad.right, pt = tlPad.top;
    var pw = W - pl - pr;
    var kws = tlData.keywords, n = kws.length;
    var rh = tlRowH;
    // chartBottom 货在最后一个 keyword 行下方，时间轴贴近图表而非 frame 底部
    var chartBottom = pt + n * (rh + tlRowGap) - tlRowGap;
    var vmin = tlViewMin != null ? tlViewMin : tlData.timeMin;
    var vmax = tlViewMax != null ? tlViewMax : tlData.timeMax;
    var trange = vmax - vmin || 1;
    // 背景填充
    var bodyStyle = getComputedStyle(document.body);
    tlCtx.fillStyle = bodyStyle.backgroundColor || '#1e1e1e';
    tlCtx.fillRect(0, 0, W, H);
    var axisColor = bodyStyle.getPropertyValue('--vscode-descriptionForeground') || '#999999';
    var gridColor = 'rgba(128,128,128,0.35)';
    // 时间轴 grid + 标签（贴近 chartBottom）
    var tickCount = tlSmartTicks(pw);
    tlCtx.font = tlGetFont('8px', 'monospace');
    tlCtx.textAlign = 'center'; tlCtx.textBaseline = 'top';
    for (var t = 0; t <= tickCount; t++) {
      var frac = t / tickCount;
      var gx = pl + frac * pw;
      // 主网格线
      tlCtx.beginPath(); tlCtx.moveTo(gx, pt); tlCtx.lineTo(gx, chartBottom);
      tlCtx.strokeStyle = gridColor; tlCtx.lineWidth = 1; tlCtx.stroke();
      // 子网格线
      if (t < tickCount && pw / tickCount > 40) {
        for (var s = 1; s <= 4; s++) {
          var sx = gx + (s / 5) * (pw / tickCount);
          tlCtx.beginPath(); tlCtx.moveTo(sx, pt); tlCtx.lineTo(sx, chartBottom);
          tlCtx.strokeStyle = 'rgba(128,128,128,0.12)'; tlCtx.stroke();
        }
      }
      // 时间标签，贴近图表底部
      var tms = vmin + frac * trange;
      tlCtx.fillStyle = axisColor;
      tlCtx.fillText(tlFmtDur(tms - tlData.timeMin), gx, chartBottom + 4);
    }
    // keyword 行
    tlCtx.font = tlGetFont('9px', 'monospace');
    tlCtx.textAlign = 'right'; tlCtx.textBaseline = 'middle';
    for (var k = 0; k < n; k++) {
      var yMid = pt + k * (rh + tlRowGap) + rh / 2;
      // 行底线
      tlCtx.strokeStyle = 'rgba(128,128,128,0.15)'; tlCtx.lineWidth = 1;
      tlCtx.beginPath(); tlCtx.moveTo(pl, yMid); tlCtx.lineTo(W - pr, yMid); tlCtx.stroke();
      // 交替背景
      if (k % 2 === 0) { tlCtx.fillStyle = 'rgba(128,128,128,0.03)'; tlCtx.fillRect(pl, yMid - rh/2, pw, rh); }
      // 标签
      var labelText = kws[k].name || '';
      if (labelText.length > 16) labelText = labelText.slice(0, 15) + '\u2026';
      tlCtx.fillStyle = kws[k].color;
      tlCtx.fillText(labelText, pl - 6, yMid);
      // 点
      tlCtx.fillStyle = kws[k].color;
      for (var j = 0; j < kws[k].points.length; j++) {
        var p = kws[k].points[j];
        if (p.time < vmin || p.time > vmax) continue;
        var pfrac = (p.time - vmin) / trange;
        var px = pl + pfrac * pw;
        tlCtx.beginPath(); tlCtx.arc(px, yMid, tlDotR, 0, 2 * Math.PI); tlCtx.fill();
      }
    }
    // zoom 指示
    if (tlZoomEl) {
      var totalMs = tlData.timeMax - tlData.timeMin;
      var viewMs = vmax - vmin;
      if (viewMs < totalMs) { tlZoomEl.style.display = 'block'; tlZoomEl.textContent = tlFmtDur(viewMs); }
      else { tlZoomEl.style.display = 'none'; }
    }
  }

  function tlPointAt(px, py) {
    if (!tlData) return null;
    var W = tlLastW;
    var pl = tlPad.left, pr = tlPad.right, pt = tlPad.top;
    var pw = W - pl - pr;
    var kws = tlData.keywords, n = kws.length;
    var rh = tlRowH;
    var vmin = tlViewMin != null ? tlViewMin : tlData.timeMin;
    var vmax = tlViewMax != null ? tlViewMax : tlData.timeMax;
    var trange = vmax - vmin || 1;
    for (var k = 0; k < n; k++) {
      var yMid = pt + k * (rh + tlRowGap) + rh / 2;
      for (var j = 0; j < kws[k].points.length; j++) {
        var p = kws[k].points[j];
        if (p.time < vmin || p.time > vmax) continue;
        var frac = (p.time - vmin) / trange;
        var x = pl + frac * pw;
        var dx = px - x, dy = py - yMid;
        if (dx * dx + dy * dy <= tlDotR * tlDotR + 16) return { point: p, keyword: kws[k] };
      }
    }
    return null;
  }

  function tlZoomAt(mouseX, factor) {
    if (!tlData) return;
    var pl = tlPad.left, pr = tlPad.right;
    var cw = tlLastW - pl - pr;
    var frac = Math.max(0, Math.min(1, (mouseX - pl) / cw));
    var vmin = tlViewMin != null ? tlViewMin : tlData.timeMin;
    var vmax = tlViewMax != null ? tlViewMax : tlData.timeMax;
    var mt = vmin + frac * (vmax - vmin);
    var half = (vmax - vmin) * factor / 2;
    var nmin = mt - half, nmax = mt + half;
    var span = nmax - nmin;
    if (span < tlMinZoom) { var mid = (nmin + nmax) / 2; nmin = mid - tlMinZoom / 2; nmax = mid + tlMinZoom / 2; span = tlMinZoom; }
    if (nmin < tlData.timeMin) { nmin = tlData.timeMin; nmax = nmin + span; }
    if (nmax > tlData.timeMax) { nmax = tlData.timeMax; nmin = nmax - span; }
    tlViewMin = Math.max(tlData.timeMin, nmin);
    tlViewMax = Math.min(tlData.timeMax, Math.max(tlViewMin + tlMinZoom, nmax));
    tlScheduleDraw();
  }

  var tlEventsBound = false;
  // 将 timeline 视图居中到指定行号对应的时间点
  function tlCenterOnLine(lineNum) {
    if (!tlData || !tlData.keywords) return;
    var foundTime = null;
    for (var k = 0; k < tlData.keywords.length; k++) {
      var pts = tlData.keywords[k].points;
      for (var p = 0; p < pts.length; p++) {
        if (pts[p].lineNumber === lineNum) { foundTime = pts[p].time; break; }
      }
      if (foundTime !== null) break;
    }
    if (foundTime === null) return;
    var halfRange = (tlData.timeMax - tlData.timeMin) * 0.1;
    if (halfRange < 1000) halfRange = 1000;  // 最小 1 秒范围
    tlViewMin = Math.max(tlData.timeMin, foundTime - halfRange);
    tlViewMax = Math.min(tlData.timeMax, foundTime + halfRange);
    tlDraw();
  }

  function tlRefresh() {
    if (tlData && tlData.keywords && tlData.keywords.length > 0) {
      if (tlEmpty) tlEmpty.style.display = 'none';
      if (tlCanvas) tlCanvas.style.display = 'block';
      tlResize();
      tlDraw();
    } else {
      if (tlEmpty) tlEmpty.style.display = 'flex';
      if (tlCanvas) tlCanvas.style.display = 'none';
    }
    // canvas 元素在 render 后重建，需要重新绑定事件
    if (tlCanvas && !tlEventsBound) {
      tlCanvas.addEventListener('mousemove', function(e) {
        if (!tlData) return;
        var r = tlCanvas.getBoundingClientRect();
        var mx = e.clientX - r.left, my = e.clientY - r.top;
        if (mx < 0 || my < 0 || mx > r.width || my > r.height) { if (tlTooltip) tlTooltip.style.display = 'none'; return; }
        var hit = tlPointAt(mx, my);
        if (hit) {
          if (tlTooltip) {
            tlTooltip.style.display = 'block';
            tlTooltip.style.left = (e.clientX + 12) + 'px';
            tlTooltip.style.top = (e.clientY + 12) + 'px';
            tlTooltip.textContent = hit.keyword.name + '  +' + tlFmtDur(hit.point.time - tlData.timeMin) + '  L' + hit.point.lineNumber + (hit.point.text ? '  ' + hit.point.text : '');
          }
        } else { if (tlTooltip) tlTooltip.style.display = 'none'; }
      });
      tlCanvas.addEventListener('click', function(e) {
        if (!tlData) return;
        var r = tlCanvas.getBoundingClientRect();
        var mx = e.clientX - r.left, my = e.clientY - r.top;
        var hit = tlPointAt(mx, my);
        if (hit) { vscode.postMessage({ type: 'timelineClick', lineNumber: hit.point.lineNumber }); }
      });
      tlCanvas.addEventListener('wheel', function(e) {
        if (!tlData) return;
        var r = tlCanvas.getBoundingClientRect();
        var mx = e.clientX - r.left, my = e.clientY - r.top;
        if (mx < 0 || my < 0 || mx > r.width || my > r.height) return;
        e.preventDefault();
        var factor = e.deltaY > 0 ? 1.5 : 0.67;
        tlZoomAt(mx, factor);
      }, { passive: false });
      tlEventsBound = true;
    }
  }
  if (typeof ResizeObserver !== 'undefined' && tlCanvas) {
    new ResizeObserver(function() { tlResize(); }).observe(tlCanvas);
  }

  render();

})();
</script>
</body>
</html>`;
  }
}
