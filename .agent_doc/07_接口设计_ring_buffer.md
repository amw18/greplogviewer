# 接口设计 — Ring Buffer 日志起点识别与红旗折叠

## 1. 新增/修改类型

### 1.1 删除 `NamedRange`
```ts
// 删除整个 NamedRange 接口
```

### 1.2 简化 `EditorConfig`
```ts
export interface EditorConfig {
  groups: RegexGroup[];
  timePattern?: TimePatternConfig;
  keywords?: KeywordConfig[];
  // 删除以下字段：
  // startPattern?: string;
  // endPattern?: string;
  // rangeDescription?: string;
  // namedRanges?: NamedRange[];
  // activeRangeId?: string;
}
```

### 1.3 新增 Ring Buffer 相关类型
```ts
/** 起点行折叠状态 */
export type StartLineFoldState = 'none' | 'foldBelow' | 'foldAbove';

/** RingBufferModel 对外暴露的只读信息 */
export interface RingBufferInfo {
  startLine?: number;
  foldState: StartLineFoldState;
}
```

## 2. 新增 Model 接口

### 2.1 RingBufferModel
文件：`src/model/RingBufferModel.ts`

```ts
export class RingBufferModel {
  /** 设置某编辑器的 ring buffer 起点行 */
  setStartLine(editorId: string, startLine: number | undefined): void;

  /** 获取某编辑器的 ring buffer 起点行 */
  getStartLine(editorId: string): number | undefined;

  /** 清除某编辑器状态 */
  clear(editorId: string): void;
}
```

### 2.2 StartLineFoldModel
文件：`src/model/StartLineFoldModel.ts`

```ts
export class StartLineFoldModel {
  /** 获取当前状态，未设置默认为 'none' */
  getState(editorId: string): StartLineFoldState;

  /** 直接设置状态 */
  setState(editorId: string, state: StartLineFoldState): void;

  /** 循环切换：none → foldBelow → foldAbove → none */
  cycleState(editorId: string): StartLineFoldState;

  /** 清除某编辑器状态 */
  clear(editorId: string): void;
}
```

## 3. TimeMatchModel 新增方法

文件：`src/model/TimeMatchModel.ts`

```ts
export class TimeMatchModel {
  /**
   * 检测 ring buffer 日志的时间起点行。
   * 从第一行（或第一个可解析时间戳的行）开始作为时间原点，
   * 向下扫描，返回第一个时间戳小于上一可解析行时间戳的行号。
   * @param lines 文档所有行
   * @returns 起点行号（0-based），未识别返回 undefined
   */
  detectRingBufferStartLine(lines: string[]): number | undefined;
}
```

## 4. EditorDecorations 新增方法

文件：`src/view/EditorDecorations.ts`

```ts
export class EditorDecorations {
  /**
   * 在指定行 gutter 显示红旗图标。
   * @param startLine 起点行号（0-based）
   * @param editor 目标编辑器
   */
  showRingBufferFlag(startLine: number, editor: vscode.TextEditor): void;

  /** 清除红旗图标 */
  clearRingBufferFlag(): void;
}
```

实现说明：
- 内部持有 `ringBufferFlagDecorationType`。
- `showRingBufferFlag` 调用 `editor.setDecorations`。
- `clear()` 中调用 `clearRingBufferFlag()`。

## 5. ViewController 变更

### 5.1 构造函数依赖新增
```ts
constructor(
  configController: ConfigController,
  private filterController: FilterController,
  private editorStateModel: EditorStateModel,
  private filterResultModel: FilterResultModel,
  private regexGroupModel: RegexGroupModel,
  private timeMatchModel: TimeMatchModel,
  private configStorageModel: ConfigStorageModel,
  private timeline: KeywordTimeline,
  private ringBufferModel: RingBufferModel,           // 新增
  private startLineFoldModel: StartLineFoldModel,     // 新增
  private reRegisterFoldProvider?: () => void
)
```

### 5.2 新增方法
```ts
/** 检测并应用 ring buffer 起点行与红旗 */
private applyRingBufferStart(editor: vscode.TextEditor, lines: string[]): void;

/** 处理编辑器选择变更，判断是否点击了红旗行 */
private onSelectionChange(editor: vscode.TextEditor): void;

/** 切换起点行折叠状态并刷新折叠 */
private toggleStartLineFold(editor: vscode.TextEditor): void;
```

### 5.3 删除字段
```ts
// 删除：
private currentStartPattern?: string;
private currentEndPattern?: string;
private currentRangeDescription?: string;
private currentNamedRanges?: import('../types').NamedRange[];
private currentActiveRangeId?: string;
```

### 5.4 简化回调签名
所有与 ConfigPanel 交互的回调统一为：
```ts
(groups: RegexGroup[], timePattern?: TimePatternConfig, keywords?: KeywordConfig[]) => void
```

## 6. ConfigPanel 变更

### 6.1 回调签名简化
```ts
onGo(callback: (groups: RegexGroup[], timePattern?: TimePatternConfig, keywords?: KeywordConfig[]) => void): void;
onExport(callback: (groups: RegexGroup[], timePattern?: TimePatternConfig, keywords?: KeywordConfig[]) => void): void;
onSave(callback: (name: string, scope: ConfigScope, groups: RegexGroup[], timePattern?: TimePatternConfig, keywords?: KeywordConfig[]) => void): void;
onSyncConfig(callback: (groups: RegexGroup[], timePattern?: TimePatternConfig, keywords?: KeywordConfig[]) => void): void;
```

### 6.2 render / sendUpdate 签名简化
```ts
render(groups: RegexGroup[], timePattern?: TimePatternConfig, keywords?: KeywordConfig[]): void;
private sendUpdate(groups: RegexGroup[], timePattern?: TimePatternConfig, keywords?: KeywordConfig[]): void;
```

### 6.3 WebviewMessage 简化
```ts
// 保留字段：
type: 'go' | 'syncConfig' | ...
groups: RegexGroup[]
timePattern?: TimePatternConfig
keywords?: KeywordConfig[]
// 删除字段：startPattern, endPattern, rangeDescription, namedRanges, activeRangeId
```

## 7. FilterController 变更

```ts
export class FilterController {
  /**
   * 过滤所有行。
   * 删除 startPattern / endPattern 参数，始终作用于全文。
   */
  filter(lines: string[], groups: RegexGroup[]): FilterResult[];

  // 删除 findFirstMatchLine 方法
}
```

## 8. FoldingRangeProvider 变更

文件：`src/extension.ts` 中的 provider。

```ts
provideFoldingRanges(document) {
  const editorId = document.uri.toString();
  const results = filterResultModel.getResults(editorId);

  // 1. 原有未匹配区间
  let ranges: vscode.FoldingRange[] = [];
  if (results !== undefined) {
    ranges = filterResultModel.getUnmatchedRanges(editorId)
      .map(r => new vscode.FoldingRange(r.start, r.end));
  }

  // 2. ring buffer 起点折叠区间
  const startLine = ringBufferModel.getStartLine(editorId);
  const foldState = startLineFoldModel.getState(editorId);
  const totalLines = document.lineCount;

  if (startLine !== undefined && foldState !== 'none') {
    if (foldState === 'foldBelow' && startLine + 1 <= totalLines - 1) {
      ranges.push(new vscode.FoldingRange(startLine + 1, totalLines - 1));
    } else if (foldState === 'foldAbove' && startLine - 1 >= 0) {
      ranges.push(new vscode.FoldingRange(0, startLine - 1));
    }
  }

  return ranges.length > 0 ? ranges : undefined;
}
```

## 9. 新增命令

### 9.1 命令注册
```ts
vscode.commands.registerCommand('greplogviewer.toggleStartLineFold', () => {
  const editor = vscode.window.activeTextEditor;
  if (editor) { viewController?.toggleStartLineFold(editor); }
});
```

### 9.2 activationEvents
在 `package.json` 中加入：
```json
"onCommand:greplogviewer.toggleStartLineFold"
```

## 10. EditorStateModel 变更

```ts
export class EditorStateModel {
  // 删除：
  // private lineRangeMap
  // getLineRange / setLineRange

  // loadConfig / saveConfig 使用简化后的 EditorConfig
}
```
