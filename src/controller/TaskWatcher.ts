// TaskWatcher — 监听 ~/.log--/ai/tasks/ 目录，处理 AI agent 提交的任务
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { AITask } from '../types';

const TASKS_DIR = path.join(os.homedir(), '.log--', 'ai', 'tasks');
const POLL_INTERVAL_MS = 2000;  // 轮询间隔

export class TaskWatcher {
  private timer: ReturnType<typeof setInterval> | undefined;
  private handled = new Set<string>();  // 已处理的任务文件名，避免重复触发

  constructor(
    private onTask: (task: AITask, taskPath: string) => Promise<void>,
  ) {}

  /** 开始监听 */
  start(): void {
    this.ensureDir();
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  /** 停止监听 */
  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = undefined; }
  }

  dispose(): void {
    this.stop();
  }

  private ensureDir(): void {
    try { fs.mkdirSync(TASKS_DIR, { recursive: true }); } catch { /* ignore */ }
  }

  private async poll(): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(TASKS_DIR, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) { continue; }
      if (this.handled.has(entry.name)) { continue; }

      const taskPath = path.join(TASKS_DIR, entry.name);
      // 等待文件写入完成（简单 stat 检查）
      await new Promise(r => setTimeout(r, 300));

      let task: AITask;
      try {
        const raw = fs.readFileSync(taskPath, 'utf-8');
        task = JSON.parse(raw);
      } catch {
        // 文件损坏或仍在写入中，下轮重试
        continue;
      }

      if (!task.action) { continue; }
      this.handled.add(entry.name);

      try {
        await this.onTask(task, taskPath);
        // 成功：删除任务文件
        try { fs.unlinkSync(taskPath); } catch { /* ignore */ }
      } catch (err: any) {
        // 失败：重命名为 .error
        try {
          const errPath = taskPath + '.error';
          fs.writeFileSync(errPath, JSON.stringify({ error: err.message, task }, null, 2), 'utf-8');
          fs.unlinkSync(taskPath);
        } catch { /* ignore */ }
      }
    }
  }
}
