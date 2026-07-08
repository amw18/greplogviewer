# 详细设计 — Ring Buffer 日志起点识别与红旗折叠

## 1. Ring Buffer 起点识别算法

### 1.1 输入输出
- **输入**：`lines: string[]`，当前已配置的时间格式 `TimeMatchModel`。
- **输出**：`number | undefined` —— 起点行号（0-based），未识别则返回 `undefined`。

### 1.2 算法步骤
```
function detectRingBufferStartLine(lines): number | undefined {
  if (!timeMatchModel.isConfigured()) return undefined;

  let previousTime: Date | null = null;
  let previousLine = -1;

  // Step 1: 确定默认时间原点
  // 优先使用第一行；若第一行无法解析，则顺序查找第一个可解析行
  for (let i = 0; i < lines.length; i++) {
    const t = timeMatchModel.parseLineTimestamp(lines[i]);
    if (t) { previousTime = t; previousLine = i; break; }
  }
  if (!previousTime) return undefined;

  // Step 2: 从原点继续向下扫描，寻找第一个相对时间为负值的行
  for (let i = previousLine + 1; i < lines.length; i++) {
    const t = timeParseModel.parseLineTimestamp(lines[i]);
    if (!t) continue;              // 解析不到的行跳过
    if (t.getTime() < previousTime.getTime()) {
      return i;                    // 发现时间回退，即 ring buffer 起点
    }
    previousTime = t;
    previousLine = i;
  }

  return undefined;                // 未出现负相对时间
}
```

### 1.3 设计说明
- 默认原点保持与现有逻辑一致：从第 0 行开始找第一个可解析时间戳的行。
- 仅比较**连续可解析行**之间的时间，跳过无时间戳行。
- 识别到第一个负相对时间即停止；不处理多次 wrap-around（罕见且可能误识别）。

## 2. 红旗 Gutter 图标

### 2.1 实现方式
- 使用 `vscode.TextEditorDecorationType`：
  ```ts
  const flagDecorationType = vscode.window.createTextEditorDecorationType({
    gutterIconPath: vscode.Uri.file(path.join(context.extensionPath, 'assets', 'flag-red.svg')),
    gutterIconSize: 'contain',
    overviewRulerColor: 'red',
    overviewRulerLane: vscode.OverviewRulerLane.Left,
  });
  ```
- 红旗图标文件：`assets/flag-red.svg`（简单 SVG，红色旗帜）。
- 在起点行应用 `editor.setDecorations(flagDecorationType, [new Range(startLine, 0, startLine, 0)])`。

### 2.2 可点击性约束与方案
- **约束**：`gutterIconPath` 本身无 click handler。
- **方案**：监听 `vscode.window.onDidChangeTextEditorSelection`。
  - 当用户点击 gutter 或行内任意位置，选择会落到该行。
  - ViewController 判断：若新选择行等于 `RingBufferModel.getStartLine(editorId)`，则调用 `StartLineFoldModel.cycleState(editorId)` 并刷新折叠。
  - 为避免光标在起点行敲代码时误触发，**仅在点击 gutter 区域时触发**的精确检测无法实现；作为折中：
    - 监听选择变更，但要求上一次选择行与当前选择行不同（即用户确实点击/移动到了起点行）。
    - 提供命令 `greplogviewer.toggleStartLineFold` 作为替代入口。

## 3. 三态折叠状态机

### 3.1 状态定义
```ts
type StartLineFoldState = 'none' | 'foldBelow' | 'foldAbove';
```

### 3.2 状态转换
```
none ──点击──> foldBelow ──点击──> foldAbove ──点击──> none
```

### 3.3 各状态对应的折叠区间
假设总行数为 `N`，起点行为 `S`（0-based）：
- **none**：不提供额外折叠区间。
- **foldBelow**：起点行是可见的最后一行，折叠其下方所有行 → 区间 `[S + 1, N - 1]`。
- **foldAbove**：起点行是可见的第一行，折叠其上方所有行 → 区间 `[0, S - 1]`。

### 3.4 与现有折叠的合并
`FoldingRangeProvider.provideFoldingRanges` 输出：
1. 原有未匹配行区间（来自 `FilterResultModel.getUnmatchedRanges`）。
2. 根据 `StartLineFoldModel` 状态追加的 ring buffer 区间。

两个集合可能有重叠。例如：
- foldBelow 区间 `[S+1, N-1]` 与某个未匹配区间 `[a, b]` 重叠时，VS Code 会自动合并/裁剪，无需我们处理。
- 若 `S+1 > N-1`（起点在最后一行），foldBelow 不产生区间。
- 若 `S-1 < 0`（起点在第一行），foldAbove 不产生区间。

## 4. Line Ranges 删除清单

### 4.1 类型层
- 删除 `NamedRange` 接口。
- `EditorConfig` 移除：`startPattern`, `endPattern`, `rangeDescription`, `namedRanges`, `activeRangeId`。

### 4.2 Model 层
- `EditorStateModel`：
  - 删除 `lineRangeMap` 及 `getLineRange` / `setLineRange`。
  - `saveConfig` / `loadConfig` 不再处理 line range 字段。
  - （可选）新增 `ringBufferStartLineMap` 与 `startLineFoldStateMap` 用于持久化。

### 4.3 Controller 层
- `FilterController`：
  - `filter(lines, groups)` 移除 `startPattern` / `endPattern` 参数。
  - 删除 `findFirstMatchLine` 方法。
  - 内部 `scanStart` 固定为 0，`scanEnd` 固定为 `lines.length`。
- `ViewController`：
  - 删除 `currentStartPattern`, `currentEndPattern`, `currentRangeDescription`, `currentNamedRanges`, `currentActiveRangeId`。
  - 删除所有调用 `findFirstMatchLine` 的代码；`scanStart` / `scanEnd` 固定为 0 / lines.length。
  - `computeFilterFingerprint` 不再包含 startPattern / endPattern。
  - 所有回调签名简化：`(groups, timePattern, keywords)`。

### 4.4 View 层
- `ConfigPanel`：
  - 删除 HTML 中 Line Ranges 区域（含 named ranges 输入、start/end pattern 输入、active range 选择）。
  - 删除相关 CSS class（`.line-range` 等）。
  - 所有 callback 与 message 不再携带 line range 字段。
  - `render` / `sendUpdate` / `sendConfigApplied` 等签名简化。

### 4.5 Entry 层
- `extension.ts`：无需特殊改动，因为 FoldingRangeProvider 输入来自模型，ConfigPanel 与 ViewController 的签名变化不影响注册逻辑。

## 5. 持久化策略

### 5.1 需要持久化的内容
- 检测到的 ring buffer 起点行 `startLine`：
  - 可在 `EditorStateModel` 中按 `editorId` 存储。
  - 由于行号会随文件编辑而变化，**建议不跨会话持久化**，每次 Go 重新检测。
- 三态折叠状态 `foldState`：
  - 同样随文件内容变化，**建议每次 Go 重置为 `none`**，避免打开旧文件后状态混乱。
- **结论**：不在 workspaceState 中持久化 ring buffer 相关状态；运行时模型维护即可。

## 6. 边界情况

| 场景 | 处理 |
|------|------|
| 未配置 Time Pattern | 不检测，不显示红旗。 |
| 全文无时间戳 | 返回 undefined，不显示红旗。 |
| 只有一行时间戳 | 无负相对时间，不显示红旗。 |
| 起点行在第 0 行 | foldAbove 区间为空，foldBelow 折叠 [1, N-1]。 |
| 起点行在最后一行 | foldBelow 区间为空，foldAbove 折叠 [0, N-2]。 |
| 用户点击非起点行 | 不触发状态切换。 |
| 选择变更到起点行但用户正在输入 | 仍会切换。需在 UX 文档提示这是已知折中。 |
