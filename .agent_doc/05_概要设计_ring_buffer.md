# 概要设计 — Ring Buffer 日志起点识别与红旗折叠

## 1. 目标
在现有 GrepLogViewer 基础上增加两项能力：
1. **Ring Buffer 起点识别**：当日志是环形缓冲区输出时，时间起点可能位于文本中间。自动识别该起点行，并在编辑器左侧 gutter 显示红旗图标。
2. **红旗点击折叠**：点击红旗所在行，按「无折叠 → 折叠下方 → 折叠上方 → 无折叠」三态循环切换。
3. **删除 Line Ranges 配置**：移除 `startPattern` / `endPattern` / `rangeDescription` / `namedRanges` / `activeRangeId` 及其 UI，简化配置模型。

## 2. 核心原则
- 保持现有 `FoldingRangeProvider` 架构不变；新增折叠区间由独立模型提供，Provider 合并输出。
- 红旗仅作为视觉指示，点击检测通过 VS Code 标准选择变更事件间接实现（VS Code 无原生可点击 gutter icon API）。
- Line Ranges 的删除要彻底，不遗留 dead code。

## 3. 模块职责

| 模块 | 新增/修改 | 职责 |
|------|----------|------|
| `TimeMatchModel` | 修改 | 新增 `detectRingBufferStartLine(lines)`，基于时间戳相对 negativity 识别 ring buffer wrap-around 行。 |
| `RingBufferModel` | 新增 | 每编辑器存储检测到的 ring buffer 起点行号。 |
| `StartLineFoldModel` | 新增 | 每编辑器维护三态折叠状态：`none` / `foldBelow` / `foldAbove`。 |
| `EditorDecorations` | 修改 | 在起点行 gutter 绘制红旗图标；管理图标 decoration type。 |
| `ViewController` | 修改 | Go 后调用检测 → 存储起点行 → 渲染红旗；监听选择变更实现点击切换；移除 Line Ranges 相关字段与逻辑。 |
| `ConfigPanel` | 修改 | 删除 Line Ranges UI 与相关回调参数。 |
| `FilterController` | 修改 | 删除 `startPattern` / `endPattern` 参数及 `findFirstMatchLine`；过滤始终作用于全文。 |
| `EditorStateModel` | 修改 | 删除 line range 存储；持久化 ring buffer 起点行与折叠状态（可选）。 |
| `extension.ts` | 修改 | 注册 `greplogviewer.toggleStartLineFold` 命令；FoldingRangeProvider 合并 ring buffer 折叠区间。 |
| `types/index.ts` | 修改 | 删除 `NamedRange` 类型；`EditorConfig` 移除 line range 字段。 |

## 4. 数据流

```
用户点击 Go
  │
  ▼
ViewController.handleGo()
  ├─ FilterController.filter(lines, groups)        ← 不再传 startPattern/endPattern
  ├─ TimeMatchModel.detectRingBufferStartLine(lines)
  │     └─ 返回 startLine 或 undefined
  ├─ RingBufferModel.setStartLine(editorId, startLine)
  ├─ StartLineFoldModel.setState(editorId, 'none')  ← 每次 Go 重置为无折叠
  ├─ EditorDecorations.showRingBufferFlag(startLine, editor)
  ├─ FilterResultModel.setResults(...)
  └─ applyFolding() → editor.foldAll()
        └─ FoldingRangeProvider 返回：原有未匹配区间 + ring buffer 折叠区间

用户点击红旗所在行（选择变更）
  │
  ▼
ViewController.onSelectionChange()
  ├─ 若新选行 == RingBufferModel.getStartLine(editorId)
  │     └─ StartLineFoldModel.cycleState(editorId)
  │     └─ 触发 onDidChangeFoldingRanges → Provider 重新提供区间
  │     └─ editor.foldAll()
```

## 5. 关键约束
- **无原生可点击 gutter icon**：红旗用 `TextEditorDecorationType.gutterIconPath` 实现，点击通过 `onDidChangeTextEditorSelection` 检测。该方案会触发于任何点击红旗行的操作，需在 UX 文档中说明。
- **Line Ranges 删除影响**：已保存的 `EditorConfig` 若含旧字段，加载时忽略即可；`EditorStateModel.loadConfig` 已有旧格式兼容逻辑，可继续忽略未知字段。
