// ConfigPanel — 左侧边栏 WebviewView 配置面板
import * as vscode from 'vscode';
import { RegexGroup, RegexExpression, LogicOperator, TimePatternConfig, KeywordConfig, WebviewMessage, ExtensionMessage } from '../types';

export class ConfigPanel implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private goCallback: ((groups: RegexGroup[], startLine?: number, endLine?: number, timePattern?: TimePatternConfig, keywords?: KeywordConfig[]) => void) | undefined;
  private resetCallback: (() => void) | undefined;
  private clearCallback: (() => void) | undefined;
  /** 缓存最近一次 groups 和行范围用于 webview 尚未就绪时 */
  private pendingGroups: RegexGroup[] = [];
  private pendingStartLine?: number;
  private pendingEndLine?: number;
  private pendingKeywords?: KeywordConfig[];

  /** WebviewViewProvider 接口：VS Code 创建/重建 webview 时调用 */
  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.buildHtml();

    webviewView.webview.onDidReceiveMessage((msg: WebviewMessage) => {
      switch (msg.type) {
        case 'go':
          this.goCallback?.(msg.groups, msg.startLine, msg.endLine, msg.timePattern, msg.keywords);
          break;
        case 'reset':
          this.resetCallback?.();
          break;
        case 'clear':
          this.clearCallback?.();
          break;
      }
    });

    // 如果之前已经有数据，发送过去
    if (this.pendingGroups.length > 0 || this.pendingTimePattern || this.pendingKeywords) {
      this.sendUpdate(this.pendingGroups, this.pendingStartLine, this.pendingEndLine, this.pendingTimePattern, this.pendingKeywords);
    }
  }

  private pendingTimePattern?: TimePatternConfig;

  /** 发送最新配置到 webview */
  render(groups: RegexGroup[], startLine?: number, endLine?: number, timePattern?: TimePatternConfig, keywords?: KeywordConfig[]): void {
    this.pendingGroups = groups;
    this.pendingStartLine = startLine;
    this.pendingEndLine = endLine;
    this.pendingTimePattern = timePattern;
    this.pendingKeywords = keywords;
    if (this.view) {
      this.sendUpdate(groups, startLine, endLine, timePattern, keywords);
    }
  }

  /** 设置 Go 回调 */
  onGo(callback: (groups: RegexGroup[], startLine?: number, endLine?: number, timePattern?: TimePatternConfig, keywords?: KeywordConfig[]) => void): void {
    this.goCallback = callback;
  }

  /** 设置 Reset 回调 */
  onReset(callback: () => void): void {
    this.resetCallback = callback;
  }

  /** 设置 Clear 回调 */
  onClear(callback: () => void): void {
    this.clearCallback = callback;
  }

  private sendUpdate(groups: RegexGroup[], startLine?: number, endLine?: number, timePattern?: TimePatternConfig, keywords?: KeywordConfig[]): void {
    this.view?.webview.postMessage({
      type: 'updateConfig' as const,
      groups,
      startLine,
      endLine,
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
                margin-bottom: 6px; padding: 6px; }
  .group-header { display: flex; align-items: center; gap: 4px; margin-bottom: 4px; }
  .group-header input[type="checkbox"] { margin: 0; cursor: pointer; }
  .group-header input[type="text"] { flex: 1; background: var(--vscode-input-background);
        color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);
        padding: 1px 4px; border-radius: 2px; font-size: 12px; }
  .group-header input[type="color"] { width: 22px; height: 18px; border: none; cursor: pointer; }
  .remove-btn { background: none; border: none; color: var(--vscode-errorForeground);
                cursor: pointer; font-size: 14px; line-height: 1; padding: 0 2px; }
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
  .expr-row input.flags { width: 40px; }
  .add-btn, .action-btn { background: var(--vscode-button-background);
        color: var(--vscode-button-foreground); border: none; padding: 2px 8px;
        border-radius: 2px; cursor: pointer; font-size: 11px; }
  .add-btn:hover, .action-btn:hover { background: var(--vscode-button-hoverBackground); }
  .action-bar { display: flex; gap: 4px; justify-content: center; margin-top: 8px; }
  .reset-btn { background: var(--vscode-button-secondaryBackground);
               color: var(--vscode-button-secondaryForeground); }
  .reset-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }

  .section { margin-bottom: 8px; }
  .section-header { font-size: 11px; font-weight: 600; text-transform: uppercase;
                    color: var(--vscode-descriptionForeground); letter-spacing: 0.5px;
                    padding: 4px 6px; border-bottom: 1px solid var(--vscode-panel-border);
                    margin-bottom: 4px; }
  .section-body { padding: 0 2px; }

  .line-range { display: flex; align-items: center; gap: 4px;
                padding: 4px; }
  .line-range label { font-size: 11px; color: var(--vscode-descriptionForeground); }
  .line-range input[type="number"] { width: 55px; background: var(--vscode-input-background);
        color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);
        padding: 1px 4px; border-radius: 2px; font-size: 11px; }
  .line-range .hint { font-size: 10px; color: var(--vscode-descriptionForeground); }

  .keyword-row { display: flex; align-items: center; gap: 3px; margin-bottom: 3px;
                 padding: 3px; background: var(--vscode-input-background); border-radius: 2px; }
  .keyword-row input[type="text"] { flex: 1; background: transparent;
        color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);
        padding: 1px 4px; border-radius: 2px; font-size: 11px; }
  .keyword-row input.pattern { min-width: 60px; }
  .keyword-row input.flags { width: 40px; }
  .keyword-row input[type="color"] { width: 22px; height: 18px; border: none; cursor: pointer; }

  .swatch-bar { display: flex; align-items: center; gap: 2px; margin-top: 3px; flex-wrap: wrap; }
  .swatch-group { display: flex; align-items: center; gap: 2px; margin-right: 6px; }
  .swatch-label { font-size: 9px; color: var(--vscode-descriptionForeground); line-height: 1; }
  .swatch { width: 13px; height: 13px; border-radius: 50%; border: 1px solid var(--vscode-panel-border); cursor: pointer; flex-shrink: 0; transition: transform 0.1s; }
  .swatch:hover { transform: scale(1.4); border-color: var(--vscode-focusBorder); z-index: 1; }
</style>
</head>
<body>
<div id="app"></div>
<script>
(function() {
  const vscode = acquireVsCodeApi();
  let state = vscode.getState() || { groups: [], startLine: undefined, endLine: undefined, timePattern: undefined, keywords: [] };
  let groups = state.groups;
  let startLine = state.startLine;
  let endLine = state.endLine;
  let keywords = state.keywords || [];
  let timePattern = state.timePattern || { format: '' };

  function saveState() { vscode.setState({ groups, startLine, endLine, keywords }); }

  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  // 预设色板：冷色系 / 暖色系 / 高对比度系
  var COLOR_SWATCHES = [
    { label: 'Cool', colors: ['#00BCD4','#4CAF50','#7C4DFF'] },
    { label: 'Warm', colors: ['#FF9800','#F44336','#FFEB3B'] },
    { label: 'HiCon', colors: ['#FF1744','#00E676','#2979FF'] }
  ];

  function swatchHtml(targetAttr, targetVal) {
    var h = '<div class="swatch-bar">';
    for (var s = 0; s < COLOR_SWATCHES.length; s++) {
      var group = COLOR_SWATCHES[s];
      h += '<span class="swatch-group">';
      h += '<span class="swatch-label">' + group.label + '</span>';
      for (var c = 0; c < group.colors.length; c++) {
        h += '<span class="swatch" style="background:' + group.colors[c] + '" data-swatch-color="' + group.colors[c] + '" ' + targetAttr + '="' + targetVal + '"></span>';
      }
      h += '</span>';
    }
    h += '</div>';
    return h;
  }

  function toNum(v) { var n = parseInt(v, 10); return isNaN(n) || n <= 0 ? undefined : n; }

  function render() {
    var html = '';

    // ── Section: Line Range ──
    html += '<div class="section">';
    html += '<div class="section-header">Line Range</div>';
    html += '<div class="section-body">';
    html += '<div class="line-range">';
    html += '<label>From:</label>';
    html += '<input type="number" id="start-line" value="' + (startLine || '') + '" placeholder="1" min="1">';
    html += '<label>To:</label>';
    html += '<input type="number" id="end-line" value="' + (endLine || '') + '" placeholder="end" min="1">';
    html += '<span class="hint">leave empty for all</span>';
    html += '</div></div></div>';

    // ── Section: Time Pattern ──
    html += '<div class="section">';
    html += '<div class="section-header">Time Pattern</div>';
    html += '<div class="section-body">';
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
      html += '<div class="group-card">';
      html += '<div class="group-header">';
      html += '<input type="checkbox" data-gi="' + gi + '" class="group-enabled"' + (g.enabled !== false ? ' checked' : '') + ' title="Enable/disable this group">';
      html += '<input type="text" value="' + esc(g.name) + '" data-gi="' + gi + '" class="group-name" placeholder="Group name">';
      html += '<input type="color" value="' + g.color + '" data-gi="' + gi + '" class="group-color" title="Text color">';
      html += '<button class="move-btn" data-action="moveGroupUp" data-gi="' + gi + '" title="Move up"' + (gi === 0 ? ' disabled' : '') + '>▲</button>';
      html += '<button class="move-btn" data-action="moveGroupDown" data-gi="' + gi + '" title="Move down"' + (gi === groups.length - 1 ? ' disabled' : '') + '>▼</button>';
      html += '<button class="remove-btn" data-action="removeGroup" data-gi="' + gi + '">&times;</button>';
      html += '</div>';
      html += swatchHtml('data-swatch-gi', gi);
      for (var ei = 0; ei < g.expressions.length; ei++) {
        var e = g.expressions[ei];
        html += '<div class="expr-row">';
        html += '<input type="checkbox" data-gi="' + gi + '" data-ei="' + ei + '" class="expr-enabled"' + (e.enabled !== false ? ' checked' : '') + ' title="Enable/disable this expression">';
        if (ei === 0) {
          html += '<span style="width:36px;font-size:10px;color:var(--vscode-descriptionForeground)">Expr</span>';
        } else {
          html += '<select data-gi="' + gi + '" data-ei="' + ei + '" class="expr-op">';
          html += '<option value="and"' + (e.operator==='and'?' selected':'') + '>AND</option>';
          html += '<option value="or"' + (e.operator==='or'?' selected':'') + '>OR</option>';
          html += '<option value="not"' + (e.operator==='not'?' selected':'') + '>NOT</option>';
          html += '</select>';
        }
        html += '<input type="text" class="pattern" value="' + esc(e.pattern) + '" data-gi="' + gi + '" data-ei="' + ei + '" placeholder="/regex/">';
        html += '<input type="text" class="flags" value="' + esc(e.flags) + '" data-gi="' + gi + '" data-ei="' + ei + '" placeholder="i">';
        html += '<button class="move-btn" data-action="moveExprUp" data-gi="' + gi + '" data-ei="' + ei + '" title="Move up"' + (ei === 0 ? ' disabled' : '') + '>▲</button>';
        html += '<button class="move-btn" data-action="moveExprDown" data-gi="' + gi + '" data-ei="' + ei + '" title="Move down"' + (ei === g.expressions.length - 1 ? ' disabled' : '') + '>▼</button>';
        html += '<button class="remove-btn" data-action="removeExpr" data-gi="' + gi + '" data-ei="' + ei + '">&times;</button>';
        html += '</div>';
      }
      html += '<button class="add-btn" data-action="addExpr" data-gi="' + gi + '" style="margin-top:2px">+ Expr</button>';
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
      html += '<span style="width:36px;font-size:10px;color:var(--vscode-descriptionForeground);text-align:center">' + (ki + 1) + '</span>';
      html += '<input type="text" class="pattern" value="' + esc(kw.pattern) + '" data-ki="' + ki + '" placeholder="regex">';
      html += '<input type="text" class="flags" value="' + esc(kw.flags) + '" data-ki="' + ki + '" placeholder="i">';
      html += '<input type="color" value="' + kw.color + '" data-ki="' + ki + '" class="keyword-color" title="Text color">';
      html += '<button class="move-btn" data-action="moveKwUp" data-ki="' + ki + '" title="Move up"' + (ki === 0 ? ' disabled' : '') + '>▲</button>';
      html += '<button class="move-btn" data-action="moveKwDown" data-ki="' + ki + '" title="Move down"' + (ki === keywords.length - 1 ? ' disabled' : '') + '>▼</button>';
      html += '<button class="remove-btn" data-action="removeKeyword" data-ki="' + ki + '">&times;</button>';
      html += '</div>';
      html += swatchHtml('data-swatch-ki', ki);
    }
    html += '<button class="add-btn" data-action="addKeyword" style="display:block;width:100%">+ Add Keyword</button>';
    html += '<span style="font-size:10px;color:var(--vscode-descriptionForeground)">Regex matches will be highlighted with a tinted background of the chosen color.</span>';
    html += '</div></div>';

    html += '<div class="action-bar">';
    html += '<button class="action-btn" id="go-btn">Go</button>';
    html += '<button class="action-btn reset-btn" id="clear-btn">Clear</button>';
    html += '<button class="action-btn reset-btn" id="reset-btn">Reset</button>';
    html += '</div>';
    document.getElementById('app').innerHTML = html;
  }

  function collectStartEnd() {
    var sl = document.getElementById('start-line');
    var el = document.getElementById('end-line');
    return {
      startLine: sl ? toNum(sl.value) : undefined,
      endLine: el ? toNum(el.value) : undefined
    };
  }

  // 事件委托：在 #app 上只绑定一次，不随 innerHTML 重建而累积
  document.getElementById('app').addEventListener('click', function(e) {
    // 处理色板点击（在 button 检查之前，因为 swatch 是 span）
    var swatch = e.target.closest('.swatch');
    if (swatch) {
      var color = swatch.dataset.swatchColor;
      var sg = parseInt(swatch.dataset.swatchGi), sk = parseInt(swatch.dataset.swatchKi);
      if (!isNaN(sg)) {
        groups[sg].color = color;
        var ci = document.querySelector('.group-color[data-gi="' + sg + '"]');
        if (ci) ci.value = color;
      } else if (!isNaN(sk)) {
        keywords[sk].color = color;
        var ci = document.querySelector('.keyword-color[data-ki="' + sk + '"]');
        if (ci) ci.value = color;
      }
      saveState();
      return;
    }

    var btn = e.target.closest('button'); if (!btn) return;
    var action = btn.dataset.action;
    var gi = parseInt(btn.dataset.gi), ei = parseInt(btn.dataset.ei);
    if (btn.id === 'go-btn') {
      collectData(); var se = collectStartEnd();
      startLine = se.startLine; endLine = se.endLine;
      var tf = document.getElementById('time-format');
      timePattern = { format: tf ? tf.value : '' };
      saveState();
      vscode.postMessage({ type: 'go', groups: groups, startLine: startLine, endLine: endLine, timePattern: timePattern, keywords: keywords });
    } else if (btn.id === 'clear-btn') {
      vscode.postMessage({ type: 'clear' });
    } else if (btn.id === 'reset-btn') {
      groups = []; startLine = undefined; endLine = undefined;
      keywords = [];
      timePattern = { format: '' }; saveState();
      vscode.postMessage({ type: 'reset' });
      render();
    } else if (action === 'addGroup') {
      groups.push({ id: uuid(), name: 'New Group', color: randomColor(), expressions: [], enabled: true });
      saveState(); render();
    } else if (action === 'removeGroup') { groups.splice(gi, 1); saveState(); render(); }
    else if (action === 'moveGroupUp' && gi > 0) {
      var tmp = groups[gi]; groups[gi] = groups[gi - 1]; groups[gi - 1] = tmp;
      saveState(); render();
    } else if (action === 'moveGroupDown' && gi < groups.length - 1) {
      var tmp = groups[gi]; groups[gi] = groups[gi + 1]; groups[gi + 1] = tmp;
      saveState(); render();
    }
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
      keywords.push({ id: uuid(), pattern: '', flags: '', color: randomColor() });
      saveState(); render();
    } else if (action === 'removeKeyword') {
      var ki = parseInt(btn.dataset.ki);
      keywords.splice(ki, 1); saveState(); render();
    } else if (action === 'moveKwUp') {
      var ki = parseInt(btn.dataset.ki);
      if (ki > 0) { var tmp = keywords[ki]; keywords[ki] = keywords[ki - 1]; keywords[ki - 1] = tmp; saveState(); render(); }
    } else if (action === 'moveKwDown') {
      var ki = parseInt(btn.dataset.ki);
      if (ki < keywords.length - 1) { var tmp = keywords[ki]; keywords[ki] = keywords[ki + 1]; keywords[ki + 1] = tmp; saveState(); render(); }
    }
  });

  document.getElementById('app').addEventListener('input', function(e) {
    var el = e.target, gi = parseInt(el.dataset.gi), ei = parseInt(el.dataset.ei);
    var ki = parseInt(el.dataset.ki);
    if (el.id === 'time-format') { timePattern.format = el.value; saveState(); return; }
    if (el.id === 'start-line') { startLine = toNum(el.value); saveState(); return; }
    if (el.id === 'end-line') { endLine = toNum(el.value); saveState(); return; }
    // Keyword inputs
    if (!isNaN(ki)) {
      if (el.classList.contains('pattern')) keywords[ki].pattern = el.value;
      else if (el.classList.contains('flags')) keywords[ki].flags = el.value;
      else if (el.classList.contains('keyword-color')) keywords[ki].color = el.value;
      saveState(); return;
    }
    if (isNaN(gi)) return;
    if (el.classList.contains('group-name')) groups[gi].name = el.value;
    else if (el.classList.contains('group-color')) groups[gi].color = el.value;
    else if (el.classList.contains('pattern') && !isNaN(ei)) groups[gi].expressions[ei].pattern = el.value;
    else if (el.classList.contains('flags') && !isNaN(ei)) groups[gi].expressions[ei].flags = el.value;
    saveState();
  });

  document.getElementById('app').addEventListener('change', function(e) {
    var el = e.target, gi = parseInt(el.dataset.gi), ei = parseInt(el.dataset.ei);
    var ki = parseInt(el.dataset.ki);
    if (el.classList.contains('expr-op')) {
      groups[gi].expressions[ei].operator = el.value; saveState();
    } else if (el.classList.contains('group-enabled')) {
      groups[gi].enabled = el.checked; saveState();
    } else if (el.classList.contains('expr-enabled')) {
      groups[gi].expressions[ei].enabled = el.checked; saveState();
    } else if (!isNaN(ki) && el.classList.contains('keyword-color')) {
      keywords[ki].color = el.value; saveState();
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
    document.querySelectorAll('.group-color').forEach(function(el) {
      groups[parseInt(el.dataset.gi)].color = el.value;
    });
    document.querySelectorAll('.expr-enabled').forEach(function(el) {
      var gi = parseInt(el.dataset.gi), ei = parseInt(el.dataset.ei);
      if (!isNaN(ei)) groups[gi].expressions[ei].enabled = el.checked;
    });
    document.querySelectorAll('.pattern').forEach(function(el) {
      var gi = parseInt(el.dataset.gi), ei = parseInt(el.dataset.ei);
      var ki = parseInt(el.dataset.ki);
      if (!isNaN(ei)) groups[gi].expressions[ei].pattern = el.value;
      else if (!isNaN(ki)) keywords[ki].pattern = el.value;
    });
    document.querySelectorAll('.flags').forEach(function(el) {
      var gi = parseInt(el.dataset.gi), ei = parseInt(el.dataset.ei);
      var ki = parseInt(el.dataset.ki);
      if (!isNaN(ei)) groups[gi].expressions[ei].flags = el.value;
      else if (!isNaN(ki)) keywords[ki].flags = el.value;
    });
    document.querySelectorAll('.keyword-color').forEach(function(el) {
      keywords[parseInt(el.dataset.ki)].color = el.value;
    });
  }

  window.addEventListener('message', function(event) {
    var msg = event.data;
    if (msg.type === 'updateConfig') {
      groups = msg.groups;
      startLine = msg.startLine;
      endLine = msg.endLine;
      keywords = msg.keywords || [];
      timePattern = msg.timePattern || { format: '' };
      saveState();
      render();
    }
  });

  render();
})();
</script>
</body>
</html>`;
  }
}
