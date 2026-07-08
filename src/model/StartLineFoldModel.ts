// StartLineFoldModel — 按编辑器维护起点行折叠三态
import { StartLineFoldState } from '../types';

export class StartLineFoldModel {
  private stateMap = new Map<string, StartLineFoldState>();
  private changeListeners: Array<() => void> = [];

  /** 获取当前状态，未设置默认为 'none' */
  getState(editorId: string): StartLineFoldState {
    return this.stateMap.get(editorId) ?? 'none';
  }

  /** 直接设置状态 */
  setState(editorId: string, state: StartLineFoldState): void {
    this.stateMap.set(editorId, state);
    this.notifyChange();
  }

  /** 循环切换：none → foldBelow → foldAbove → none */
  cycleState(editorId: string): StartLineFoldState {
    const current = this.getState(editorId);
    const next: StartLineFoldState =
      current === 'none' ? 'foldBelow' :
        current === 'foldBelow' ? 'foldAbove' : 'none';
    this.stateMap.set(editorId, next);
    this.notifyChange();
    return next;
  }

  /** 清除某编辑器状态 */
  clear(editorId: string): void {
    this.stateMap.delete(editorId);
    this.notifyChange();
  }

  onChange(listener: () => void): void {
    this.changeListeners.push(listener);
  }

  private notifyChange(): void {
    for (const listener of this.changeListeners) {
      listener();
    }
  }
}
