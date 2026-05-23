// ConfigPanel — 左侧边栏 WebviewView 配置面板
import * as vscode from 'vscode';
import { RegexGroup, RegexExpression, LogicOperator, WebviewMessage, ExtensionMessage } from '../types';

export class ConfigPanel implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private goCallback: ((groups: RegexGroup[]) => void) | undefined;
  private resetCallback: (() => void) | undefined;
  /** 缓存最近一次 groups 用于 webview 尚未就绪时 */
  private pendingGroups: RegexGroup[] = [];

  /** WebviewViewProvider 接口：VS Code 创建/重建 webview 时调用 */
  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.buildHtml();

    webviewView.webview.onDidReceiveMessage((msg: WebviewMessage) => {
      switch (msg.type) {
        case 'go':
          this.goCallback?.(msg.groups);
          break;
        case 'reset':
          this.resetCallback?.();
          break;
      }
    });

    // 如果之前已经有数据，发送过去
    if (this.pendingGroups.length > 0) {
      this.sendMessage({ type: 'updateConfig', groups: this.pendingGroups });
    }
  }

  /** 发送最新配置到 webview */
  render(groups: RegexGroup[]): void {
    this.pendingGroups = groups;
    if (this.view) {
      this.sendMessage({ type: 'updateConfig', groups });
    }
  }

  /** 设置 Go 回调 */
  onGo(callback: (groups: RegexGroup[]) => void): void {
    this.goCallback = callback;
  }

  /** 设置 Reset 回调 */
  onReset(callback: () => void): void {
    this.resetCallback = callback;
  }

  private sendMessage(msg: ExtensionMessage): void {
    this.view?.webview.postMessage(msg);
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
  .group-header input[type="text"] { flex: 1; background: var(--vscode-input-background);
        color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);
        padding: 1px 4px; border-radius: 2px; font-size: 12px; }
  .group-header input[type="color"] { width: 22px; height: 18px; border: none; cursor: pointer; }
  .remove-btn { background: none; border: none; color: var(--vscode-errorForeground);
                cursor: pointer; font-size: 14px; line-height: 1; padding: 0 2px; }
  .expr-row { display: flex; align-items: center; gap: 3px; margin-bottom: 3px;
              padding: 3px; background: var(--vscode-input-background); border-radius: 2px; }
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
</style>
</head>
<body>
<div id="app"></div>
<script>
(function() {
  const vscode = acquireVsCodeApi();
  let state = vscode.getState() || { groups: [] };
  let groups = state.groups;

  function saveState() { vscode.setState({ groups }); }

  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function render() {
    var html = '';
    for (var gi = 0; gi < groups.length; gi++) {
      var g = groups[gi];
      html += '<div class="group-card">';
      html += '<div class="group-header">';
      html += '<input type="text" value="' + esc(g.name) + '" data-gi="' + gi + '" class="group-name" placeholder="Group name">';
      html += '<input type="color" value="' + g.color + '" data-gi="' + gi + '" class="group-color" title="Text color">';
      html += '<button class="remove-btn" data-action="removeGroup" data-gi="' + gi + '">&times;</button>';
      html += '</div>';
      for (var ei = 0; ei < g.expressions.length; ei++) {
        var e = g.expressions[ei];
        html += '<div class="expr-row">';
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
        html += '<button class="remove-btn" data-action="removeExpr" data-gi="' + gi + '" data-ei="' + ei + '">&times;</button>';
        html += '</div>';
      }
      html += '<button class="add-btn" data-action="addExpr" data-gi="' + gi + '" style="margin-top:2px">+ Expr</button>';
      html += '</div>';
    }
    html += '<button class="add-btn" data-action="addGroup" style="display:block;width:100%;margin-bottom:6px">+ Add Group</button>';
    html += '<div class="action-bar">';
    html += '<button class="action-btn" id="go-btn">Go</button>';
    html += '<button class="action-btn reset-btn" id="reset-btn">Reset</button>';
    html += '</div>';
    document.getElementById('app').innerHTML = html;
  }

  // 事件委托：在 #app 上只绑定一次，不随 innerHTML 重建而累积
  document.getElementById('app').addEventListener('click', function(e) {
    var btn = e.target.closest('button'); if (!btn) return;
    var action = btn.dataset.action;
    var gi = parseInt(btn.dataset.gi), ei = parseInt(btn.dataset.ei);
    if (btn.id === 'go-btn') {
      collectData(); saveState();
      vscode.postMessage({ type: 'go', groups: groups });
    } else if (btn.id === 'reset-btn') {
      groups = []; saveState();
      vscode.postMessage({ type: 'reset' });
      render();
    } else if (action === 'addGroup') {
      groups.push({ id: uuid(), name: 'New Group', color: randomColor(), expressions: [] });
      saveState(); render();
    } else if (action === 'removeGroup') { groups.splice(gi, 1); saveState(); render(); }
    else if (action === 'addExpr') {
      groups[gi].expressions.push({ id: uuid(), pattern: '', flags: '', operator: 'and' });
      saveState(); render();
    } else if (action === 'removeExpr') { groups[gi].expressions.splice(ei, 1); saveState(); render(); }
  });

  document.getElementById('app').addEventListener('input', function(e) {
    var el = e.target, gi = parseInt(el.dataset.gi), ei = parseInt(el.dataset.ei);
    if (isNaN(gi)) return;
    if (el.classList.contains('group-name')) groups[gi].name = el.value;
    else if (el.classList.contains('group-color')) groups[gi].color = el.value;
    else if (el.classList.contains('pattern') && !isNaN(ei)) groups[gi].expressions[ei].pattern = el.value;
    else if (el.classList.contains('flags') && !isNaN(ei)) groups[gi].expressions[ei].flags = el.value;
    saveState();
  });

  document.getElementById('app').addEventListener('change', function(e) {
    var el = e.target;
    if (el.classList.contains('expr-op')) {
      var gi = parseInt(el.dataset.gi), ei = parseInt(el.dataset.ei);
      groups[gi].expressions[ei].operator = el.value; saveState();
    }
  });

  function randomColor() {
    return '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6,'0');
  }

  function collectData() {
    document.querySelectorAll('.group-name').forEach(function(el) {
      groups[parseInt(el.dataset.gi)].name = el.value;
    });
    document.querySelectorAll('.group-color').forEach(function(el) {
      groups[parseInt(el.dataset.gi)].color = el.value;
    });
    document.querySelectorAll('.pattern').forEach(function(el) {
      var gi = parseInt(el.dataset.gi), ei = parseInt(el.dataset.ei);
      if (!isNaN(ei)) groups[gi].expressions[ei].pattern = el.value;
    });
    document.querySelectorAll('.flags').forEach(function(el) {
      var gi = parseInt(el.dataset.gi), ei = parseInt(el.dataset.ei);
      if (!isNaN(ei)) groups[gi].expressions[ei].flags = el.value;
    });
  }

  window.addEventListener('message', function(event) {
    var msg = event.data;
    if (msg.type === 'updateConfig') { groups = msg.groups; saveState(); render(); }
  });

  render();
})();
</script>
</body>
</html>`;
  }
}
