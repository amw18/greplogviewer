# 原型设计 — Ring Buffer 日志起点识别与红旗折叠

## 1. 整体界面变化

### 1.1 配置面板（ConfigPanel）
- **删除 Line Ranges 区域**：移除原 "Line Ranges" 输入区、Named Range 列表、Start/End Pattern 输入框。
- 保留：Regex Groups、Time Pattern、Keyword Highlight、Config Management。
- 面板更简洁，聚焦核心过滤能力。

### 1.2 编辑器 Gutter
- 在时间起点行左侧 gutter 显示一个**红色旗帜图标**。
- 图标位置：与行号同一行，位于行号左侧或折叠图标旁边（由 VS Code gutter 布局决定）。
- 图标颜色：鲜艳红色，确保在暗/亮主题下都清晰可见。

### 1.3 折叠效果
| 状态 | 视觉表现 | 折叠区间 |
|------|----------|----------|
| **none** | 正常显示全文，红旗仅作标记 | 无 |
| **foldBelow** | 起点行以下全部折叠，起点行是可见区域底部 | `[S+1, N-1]` |
| **foldAbove** | 起点行以上全部折叠，起点行是可见区域顶部 | `[0, S-1]` |

## 2. 交互流程

### 2.1 首次 Go
1. 用户配置 Time Pattern 和 Regex Groups，点击 Go。
2. 扩展检测 ring buffer 起点行 S，左侧 gutter 出现红旗。
3. 默认状态为 `none`，全文按现有规则高亮/折叠。

### 2.2 点击红旗行
1. 用户点击红旗所在行（ gutter 或行内任意位置）。
2. 选择变更事件触发，状态切换：
   - 第 1 次点击：`none` → `foldBelow`，起点行下方所有行折叠。
   - 第 2 次点击：`foldBelow` → `foldAbove`，恢复下方，折叠上方。
   - 第 3 次点击：`foldAbove` → `none`，恢复全文。
   - 第 4 次点击：重复第 1 次。
3. 折叠状态即时生效，无需再点 Go。

### 2.3 重新 Go
- 每次点击 Go 时重新检测 ring buffer 起点，并重置折叠状态为 `none`。
- 若新文件无 ring buffer 特征，红旗消失。

## 3. 图标设计

### 3.1 红旗 SVG
文件：`assets/flag-red.svg`
```xml
<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
  <path d="M4 2v12h2V8l6 2V4L6 6V2H4z" fill="#e51400"/>
</svg>
```
- 尺寸 16x16，红色填充。
- 使用 `gutterIconSize: 'contain'` 保持比例。

### 3.2 备选方案
- 若 SVG 文件管理复杂，可使用红色 emoji 🚩 作为 `contentText` 装饰在文本前，但会占用文本区域，不推荐。
- 最终采用 SVG gutter icon。

## 4. 交互限制说明

### 4.1 点击检测的折中
- **问题**：VS Code 没有原生可点击 gutter icon API。
- **方案**：监听 `onDidChangeTextEditorSelection`。
- **副作用**：用户点击红旗所在行任意位置都会触发状态切换，不限于图标本身。
- **缓解**：
  - 红旗图标提供视觉引导。
  - 提供命令面板命令 `GrepLogViewer: Toggle Start Line Fold` 作为精确入口。
  - 在文档中说明：点击红旗行即切换。

### 4.2 文本编辑时的误触发
- 用户在起点行输入时光标已在该行，若从其他行移回起点行会触发切换；持续在起点行输入不会反复触发（依赖选择变更事件）。

## 5. 配置面板原型（文字描述）

```
┌─────────────────────────────┐
│ GrepLogViewer               │
├─────────────────────────────┤
│ Regex Groups                │
│ [Group A]  [color]  [x]     │
│ [Group B]  [color]  [x]     │
│ [+ Add Group]               │
├─────────────────────────────┤
│ Time Pattern                │
│ [YYYY-MM-DD HH:mm:ss.SSS]   │
├─────────────────────────────┤
│ Keyword Highlight           │
│ [keyword] [color] [x]       │
│ [+ Add Keyword]             │
├─────────────────────────────┤
│ [   Go   ] [Clear] [Reset]  │
├─────────────────────────────┤
│ Config Management           │
│ ...                         │
└─────────────────────────────┘
```

- 删除原 "Line Ranges" 区域后，面板高度降低，布局更紧凑。

## 6. 编辑器原型（文字描述）

```
   1   │ 2024-01-01 00:00:05 log A
   2   │ 2024-01-01 00:00:06 log B
   3   │ 2024-01-01 00:00:07 log C
   4 🚩│ 2024-01-01 00:00:00 log D   ← ring buffer 起点，红旗图标
   5   │ 2024-01-01 00:00:01 log E
   6   │ 2024-01-01 00:00:02 log F
```

- 点击第 4 行：
  - 第 1 次：折叠 5-6 行。
  - 第 2 次：折叠 1-3 行。
  - 第 3 次：恢复全部。
