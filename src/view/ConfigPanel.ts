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

  sendMatchCounts(counts: import('../types').MatchCountsMessage): void {
    this.view?.webview.postMessage(counts);
  }

  private syncConfigCallback: ((groups: RegexGroup[], timePattern?: TimePatternConfig, keywords?: KeywordConfig[]) => void) | undefined;

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

    // ── Section: Advance (collapsible, default collapsed) ──
    var advanceOpen = sectionState['advance'] || false;
    html += '<div class="section collapsible" id="section-advance">';
    html += '<button class="section-header" data-action="toggleSection" data-section="advance">';
    html += '<span class="section-toggle ' + (advanceOpen ? 'open' : '') + '">' + (advanceOpen ? '▼' : '▶') + '</span><span>Advance</span></button>';
    html += '<div class="section-body ' + (advanceOpen ? '' : 'collapsed') + '">';

    // Time Fmt sub-item (single row, input matches Solution dropdown style)
    html += '<div class="advance-sub-item">';
    html += '<div class="cfg-mgmt-row">';
    html += '<span class="advance-label">Time Fmt:</span>';
    html += '<input type="text" id="time-format" value="' + esc(timePattern?.format || '') + '" placeholder="" title="Write the timestamp exactly as it appears. Tokens: YYYY YY MM DD HH mm ss SSS. Optional parts: {...}. Example: [YYYY-MM-DD HH:mm:ss{.SSS}]">';
    html += '</div>';
    html += '</div>';

    // Solution sub-item
    html += '<div class="advance-sub-item">';
    html += '<div class="cfg-mgmt-row">';
    html += '<span class="advance-label">Solution:</span>';
    html += '<select id="cfg-apply-select" style="flex:1;min-width:0"><option value="">-- Select saved --</option></select>';
    html += '<button class="cfg-btn" id="cfg-apply-btn" title="Apply">▶</button>';
    html += '<button class="cfg-btn danger" id="cfg-delete-btn" title="Delete">✕</button>';
    html += '<button class="cfg-btn" id="cfg-save-btn" title="Save">💾</button>';
    html += '<button class="cfg-btn" id="cfg-export-btn" title="Export">⬆</button>';
    html += '<button class="cfg-btn" id="cfg-import-btn" title="Import">⬇</button>';
    html += '</div>';
    html += '</div>';

    html += '</div></div>';

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
      html += '<button class="kw-nav-btn" data-action="kwGotoPrev" data-kw-id="' + kw.id + '" title="Previous hit">\u2191</button>';
      html += '<button class="kw-nav-btn" data-action="kwGotoNext" data-kw-id="' + kw.id + '" title="Next hit">\u2193</button>';
      html += '<button class="remove-btn" data-action="removeKeyword" data-ki="' + ki + '">&times;</button>';
      html += '</div>';
    }
    html += '<button class="add-btn" data-action="addKeyword" style="display:block;width:100%">+ Add Keyword</button>';
})();
</script>
</body>
</html>`;
  }
}
