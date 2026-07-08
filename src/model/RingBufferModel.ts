// RingBufferModel — 按编辑器存储检测到的 ring buffer 时间起点行
export class RingBufferModel {
  private startLineMap = new Map<string, number | undefined>();

  /** 设置某编辑器的 ring buffer 起点行 */
  setStartLine(editorId: string, startLine: number | undefined): void {
    this.startLineMap.set(editorId, startLine);
  }

  /** 获取某编辑器的 ring buffer 起点行 */
  getStartLine(editorId: string): number | undefined {
    return this.startLineMap.get(editorId);
  }

  /** 清除某编辑器状态 */
  clear(editorId: string): void {
    this.startLineMap.delete(editorId);
  }
}
