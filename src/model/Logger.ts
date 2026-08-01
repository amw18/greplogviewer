// Logger - 可切换的日志输出，默认 console，运行时由 extension 设置为 OutputChannel
type LogFn = (msg: string) => void;

const defaultLog: LogFn = (msg) => {
  const ts = new Date().toISOString().slice(11, 23);  // HH:mm:ss.SSS
  console.log(`[${ts}] ${msg}`);
};

let logFn: LogFn = defaultLog;

/** 由 extension 调用，切换到 VS Code OutputChannel */
export function setLogger(fn: LogFn): void {
  logFn = fn;
}

/** 输出一行日志 */
export function log(msg: string): void {
  logFn(msg);
}
