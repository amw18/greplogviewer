// Logger - VS Code OutputChannel 日志，用户可在 Output 面板选择 "Log--" 查看
import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

/** 初始化 OutputChannel（在 activate 中调用） */
export function initLogger(context: vscode.ExtensionContext): void {
  channel = vscode.window.createOutputChannel('Log--');
  context.subscriptions.push(channel);
}

/** 输出一行日志，带时间戳 */
export function log(msg: string): void {
  const ts = new Date().toISOString().slice(11, 23);  // HH:mm:ss.SSS
  channel?.appendLine(`[${ts}] ${msg}`);
}
