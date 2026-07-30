// TaskWatcher - 监听 ~/.log--/ai/tasks/ 目录，处理 AI agent 提交的任务
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AITask } from '../types';

const TASKS_DIR = path.join(os.homedir(), '.log--', 'ai', 'tasks');
const POLL_INTERVAL_MS = 2000;  // 轮询间隔
const MAX_PARSE_RETRIES = 3;  // JSON 解析最大重试次数

export class TaskWatcher {
  private timer: ReturnType<typeof setInterval> | undefined;
  /** 文件名 -> 解析失败次数，超过 MAX_PARSE_RETRIES 则标记为 .error */
  private parseRetries = new Map<string, number>();

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

      const taskPath = path.join(TASKS_DIR, entry.name);
      // 等待文件写入完成
      await new Promise(r => setTimeout(r, 300));

      let task: AITask;
      try {
        const raw = fs.readFileSync(taskPath, 'utf-8');
        task = JSON.parse(raw);
      } catch {
        // 文件损坏或仍在写入中，累计重试次数
        const retries = (this.parseRetries.get(entry.name) || 0) + 1;
        if (retries >= MAX_PARSE_RETRIES) {
          this.parseRetries.delete(entry.name);
          this.markError(taskPath, { error: 'JSON parse failed after retries', raw: null });
        } else {
          this.parseRetries.set(entry.name, retries);
        }
        continue;
      }

      if (!task.action) {
        this.markError(taskPath, { error: 'Missing action field', task });
        continue;
      }

      // 解析成功，清除重试计数
      this.parseRetries.delete(entry.name);

      try {
        await this.onTask(task, taskPath);
        // 成功：删除任务文件
        try { fs.unlinkSync(taskPath); } catch { /* ignore */ }
      } catch (err: any) {
        this.markError(taskPath, { error: err.message, task });
      }
    }
  }

  /** 标记任务失败：写入 .error 文件并删除原文件 */
  private markError(taskPath: string, content: { error: string; task?: AITask | null; raw?: string | null }): void {
    try {
      fs.writeFileSync(taskPath + '.error', JSON.stringify(content, null, 2), 'utf-8');
      fs.unlinkSync(taskPath);
    } catch { /* ignore */ }
  }
}
