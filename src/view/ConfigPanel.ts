// ConfigPanel — Webview 配置面板管理
import * as vscode from 'vscode';
import { RegexGroup, RegexExpression, LogicOperator, WebviewMessage, ExtensionMessage } from '../types';

export class ConfigPanel {
  private panel: vscode.WebviewPanel | undefined;
  private goCallback: ((groups: RegexGroup[]) => void) | undefined;
  private resetCallback: (() => void) | undefined;

  constructor(private context: vscode.ExtensionContext) {}

  /** 渲染配置面板 */
  render(groups: RegexGroup[]): void {
    if (this.panel) {
      this.sendMessage({ type: 'updateConfig', groups });
    }
  }

  /** 显示/创建面板，groups 作为初始数据注入 HTML */
  show(initialGroups?: RegexGroup[]): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Two);
      return;
    }

    try {
      this.panel = vscode.window.createWebviewPanel(
        'greplogviewer.config',
        'GrepLogViewer',
        vscode.ViewColumn.Two,
        { enableScripts: true, retainContextWhenHidden: true }
      );

      this.panel.webview.html = this.buildHtml(initialGroups);
      this.setupMessageHandler();

      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
    } catch (e: any) {
      vscode.window.showErrorMessage(`创建面板失败: ${e.message}`);
    }
  }

  /** 隐藏面板 */
  hide(): void {
    this.panel?.dispose();
  }

  /** 设置 Go 回调 */
  onGo(callback: (groups: RegexGroup[]) => void): void {
    this.goCallback = callback;
  }

  /** 设置 Reset 回调 */
  onReset(callback: () => void): void {
    this.resetCallback = callback;
  }

  /** 发送消息到 Webview */
  private sendMessage(msg: ExtensionMessage): void {
    this.panel?.webview.postMessage(msg);
  }

  /** 处理来自 Webview 的消息 */
  private setupMessageHandler(): void {
    this.panel!.webview.onDidReceiveMessage((msg: WebviewMessage) => {
      switch (msg.type) {
        case 'go':
          this.goCallback?.(msg.groups);
          break;
        case 'reset':
          this.resetCallback?.();
          break;
      }
    });
  }

  /** 构建 Webview HTML，可注入初始组数据 */
  private buildHtml(initialGroups?: RegexGroup[]): string {
    const initialData = initialGroups && initialGroups.length > 0
      ? JSON.stringify(initialGroups)
      : '[]';
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>GrepLogViewer Config</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family, sans-serif); font-size: 13px;
         color: var(--vscode-foreground); background: var(--vscode-editor-background);
         padding: 8px; }
  .group-card { border: 1px solid var(--vscode-panel-border); border-radius: 4px;
                margin-bottom: 8px; padding: 8px; }
  .group-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .group-header input[type="text"] { flex: 1; background: var(--vscode-input-background);
        color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);
        padding: 2px 6px; border-radius: 2px; }
  .group-header input[type="color"] { width: 28px; height: 22px; border: none; cursor: pointer; }
  .remove-btn { background: none; border: none; color: var(--vscode-errorForeground);
                cursor: pointer; font-size: 16px; line-height: 1; padding: 0 4px; }
  .expr-row { display: flex; align-items: center; gap: 4px; margin-bottom: 4px;
              padding: 4px; background: var(--vscode-input-background); border-radius: 2px; }
  .expr-row select { background: var(--vscode-dropdown-background);
        color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border);
        padding: 2px 4px; border-radius: 2px; }
  .expr-row input[type="text"] { flex: 1; background: transparent;
        color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);
        padding: 2px 6px; border-radius: 2px; }
  .expr-row input.pattern { min-width: 120px; }
  .expr-row input.flags { width: 60px; }
  .add-btn, .action-btn { background: var(--vscode-button-background);
        color: var(--vscode-button-foreground); border: none; padding: 4px 12px;
        border-radius: 2px; cursor: pointer; font-size: 12px; }
  .add-btn:hover, .action-btn:hover { background: var(--vscode-button-hoverBackground); }
  .action-bar { display: flex; gap: 8px; justify-content: center; margin-top: 12px; }
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
  // 从持久化 state 恢复，否则使用注入的初始数据
  const injected = ${initialData};
  let state = vscode.getState() || { groups: injected };
  let groups = state.groups;

  function saveState() {
    vscode.setState({ groups });
  }

  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // 操作符标签映射
  function operatorLabel(op) {
    switch(op) { case 'and': return 'AND'; case 'or': return 'OR'; case 'not': return 'NOT'; }
    return '';
  }

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
          html += '<span style="width:50px;font-size:11px;color:var(--vscode-descriptionForeground)">Expr</span>';
        } else {
          html += '<select data-gi="' + gi + '" data-ei="' + ei + '" class="expr-op">';
          ['and','or','not'].forEach(function(op) {
            html += '<option value="' + op + '"' + (e.operator === op ? ' selected' : '') + '>' + operatorLabel(op) + '</option>';
          });
          html += '</select>';
        }
        html += '<input type="text" class="pattern" value="' + esc(e.pattern) + '" data-gi="' + gi + '" data-ei="' + ei + '" placeholder="/regex/">';
        html += '<input type="text" class="flags" value="' + esc(e.flags) + '" data-gi="' + gi + '" data-ei="' + ei + '" placeholder="flags">';
        html += '<button class="remove-btn" data-action="removeExpr" data-gi="' + gi + '" data-ei="' + ei + '">&times;</button>';
        html += '</div>';
      }

      html += '<button class="add-btn" data-action="addExpr" data-gi="' + gi + '">+ Add Expression</button>';
      html += '</div>';
    }
    html += '<button class="add-btn" data-action="addGroup" style="display:block;width:100%">+ Add Group</button>';
    html += '<div class="action-bar">';
    html += '<button class="action-btn" id="go-btn">Go</button>';
    html += '<button class="action-btn reset-btn" id="reset-btn">Reset</button>';
    html += '</div>';

    document.getElementById('app').innerHTML = html;
    bindEvents();
  }

  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function bindEvents() {
    // Go 按钮
    document.getElementById('go-btn').onclick = function() {
      collectData();
      saveState();
      vscode.postMessage({ type: 'go', groups: groups });
    };
    // Reset 按钮
    document.getElementById('reset-btn').onclick = function() {
      groups = [];
      saveState();
      vscode.postMessage({ type: 'reset' });
      render();
    };

    // 事件委托
    document.getElementById('app').addEventListener('click', function(e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      var action = btn.dataset.action;
      var gi = parseInt(btn.dataset.gi);
      var ei = parseInt(btn.dataset.ei);

      if (action === 'addGroup') {
        groups.push({
          id: uuid(),
          name: 'New Group',
          color: '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6,'0'),
          expressions: []
        });
        saveState();
        render();
      } else if (action === 'removeGroup') {
        groups.splice(gi, 1);
        saveState();
        render();
      } else if (action === 'addExpr') {
        groups[gi].expressions.push({
          id: uuid(),
          pattern: '',
          flags: '',
          operator: 'and'
        });
        saveState();
        render();
      } else if (action === 'removeExpr') {
        groups[gi].expressions.splice(ei, 1);
        saveState();
        render();
      }
    });

    // 文本输入变更事件
    document.getElementById('app').addEventListener('input', function(e) {
      var el = e.target;
      var gi = parseInt(el.dataset.gi);
      var ei = parseInt(el.dataset.ei);
      if (isNaN(gi)) return;

      if (el.classList.contains('group-name')) {
        groups[gi].name = el.value;
      } else if (el.classList.contains('group-color')) {
        groups[gi].color = el.value;
      } else if (el.classList.contains('pattern')) {
        groups[gi].expressions[ei].pattern = el.value;
      } else if (el.classList.contains('flags')) {
        groups[gi].expressions[ei].flags = el.value;
      }
      saveState();
    });

    // select 变更
    document.getElementById('app').addEventListener('change', function(e) {
      var el = e.target;
      if (el.classList.contains('expr-op')) {
        var gi = parseInt(el.dataset.gi);
        var ei = parseInt(el.dataset.ei);
        groups[gi].expressions[ei].operator = el.value;
        saveState();
      }
    });
  }

  function collectData() {
    // 收集所有输入数据（确保最新值）
    var nameEls = document.querySelectorAll('.group-name');
    nameEls.forEach(function(el) {
      var gi = parseInt(el.dataset.gi);
      groups[gi].name = el.value;
    });
    var colorEls = document.querySelectorAll('.group-color');
    colorEls.forEach(function(el) {
      var gi = parseInt(el.dataset.gi);
      groups[gi].color = el.value;
    });
    var patternEls = document.querySelectorAll('.pattern');
    patternEls.forEach(function(el) {
      var gi = parseInt(el.dataset.gi);
      var ei = parseInt(el.dataset.ei);
      groups[gi].expressions[ei].pattern = el.value;
    });
    var flagsEls = document.querySelectorAll('.flags');
    flagsEls.forEach(function(el) {
      var gi = parseInt(el.dataset.gi);
      var ei = parseInt(el.dataset.ei);
      groups[gi].expressions[ei].flags = el.value;
    });
  }

  // 监听来自 Extension 的消息
  window.addEventListener('message', function(event) {
    var msg = event.data;
    if (msg.type === 'updateConfig') {
      groups = msg.groups;
      saveState();
      render();
    }
  });

  // 初始渲染
  render();
})();
</script>
</body>
</html>`;
  }

  dispose(): void {
    this.panel?.dispose();
  }
}
