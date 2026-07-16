# 踩坑记录 — 重要经验教训

## 1. 自动折叠：FoldingRangeProvider + 显式清除
**结论**: 使用 `FoldingRangeProvider` 提供折叠区间以获得性能，但在更新过滤规则前必须显式让 Provider 返回空区间，彻底移除旧折叠状态。

| 操作 | 命令/方式 | 说明 |
|------|------|------|
| Go 折叠 | `FoldingRangeProvider` + `editor.foldAll` | 声明式提供区间后整体折叠 |
| 清除旧折叠 | `editor.unfoldAll` + `FilterResultModel.setEmptyResults()` | 先展开当前折叠，再让 Provider 返回 `[]`，强制 VS Code 移除 provider 折叠 |

**关键教训**:
- `FoldingRangeProvider` 的折叠状态会被 VS Code 持久化，修改规则后若不清除，旧折叠会与新折叠叠加残留
- 仅 `editor.unfoldAll` 不够：大文件或跨会话时 VS Code 仍可能保留折叠状态
- 正确顺序：`unfoldAll` → `setEmptyResults()` + 重新注册 Provider → 等待 → `setResults()`（Provider 返回新区间）→ `foldAll`
- 仅让 Provider 返回 `[]` 可以更新折叠内容，但 VS Code 仍可能在 gutter 保留旧的折叠图标；通过 `dispose` + `registerFoldingRangeProvider` 重新注册 Provider，让 VS Code 把该 Provider 视为全新的来源，才能彻底刷新 gutter 折叠图标
- `FilterResultModel.setEmptyResults()` 与 `clearResults()` 语义不同：前者保留“已过滤”状态让 Provider 返回 `[]`，后者删除记录让 Provider 返回 `undefined`（回退默认折叠）
- 在 `handleGo()`/`addKeyword()`/`attach()` 更新过滤结果前都执行完整清除流程
- `Clear` / `Reset` / `attach()`（编辑器切换）都必须重置 `lastFilterFingerprint`，否则再次点击 `Go` 时若配置未变，会误判为“无需重新过滤”而直接复用已被清空的结果或上一编辑器的缓存
- Group/Keyword 颜色属于纯视觉属性，修改后通过 `syncConfig` 实时同步并刷新装饰，无需点 Go；装饰渲染时优先从 `RegexGroupModel` 读取当前颜色，而不是依赖过滤结果里缓存的旧颜色
- Keyword Timeline 的颜色也要同步刷新：`handleSyncConfig` 检测到颜色变化后，除了重新应用编辑器装饰，还要重新调用 `sendTimelineData()` 下发新的 keyword 颜色
- Webview 中的 Canvas/图表应让 CSS 控制 canvas 容器大小（`width:100%; height:100%`），同步 drawing buffer 时使用 `canvas.clientWidth/Height`，并同时监听 `window.resize`、`ResizeObserver(canvas)` 和轮询兜底，因为 VS Code 面板拖动不一定会触发 window resize 事件
- Timeline 左侧 keyword 标签列宽度应动态计算：在绘制前用 `ctx.measureText()` 测量所有 keyword 标签宽度，取最大值 + margin 作为第 0 列宽度，避免固定宽度导致标签截断或留白过多
- 折叠命令生效的前提是编辑器有焦点 → 调用前用 `showTextDocument(preserveFocus: false)` 确保焦点
- 旧方案 `createFoldingRangeFromSelection` 每区间一次命令，大文件极慢，已废弃

## 2. WebviewPanel vs WebviewViewProvider
- `createWebviewPanel` 抢焦点 → 折叠命令、selection 赋值等全部失效
- `registerWebviewViewProvider` 不抢焦点 → 编辑器操作正常
- **设计原则**: 配置/工具类 UI 用侧边栏，编辑器增强用原生 Editor API

## 3. Webview addEventListener 重复绑定
- `render()` 内部每次调用 `addEventListener` 会**累积**监听器
- 点击一次按钮触发 N 次（N = render 调用次数）
- **解决方案**: 事件监听移出 `render()`，用事件委托只在初始化时注册一次

## 4. 正则组匹配逻辑的运算符优先级
`matchGroup` 是**从左到右顺序计算**，不是按运算符优先级：
```
result = match(e0)
result = result <op1> match(e1)
result = result <op2> match(e2)
```
例如 `[ERROR AND] [FATAL OR] [ignore NOT]`：
- `'FATAL crash'` → false || true && !false = **true**（OR 让 FATAL 单独命中也能通过）

## 5. Model 层不要依赖 VS Code API
- `RegexGroupModel`, `FilterController`, `FilterResultModel` **不导入 vscode**
- 可以脱离 VS Code 运行时直接跑 mocha 单元测试

## 6. isActive：内存状态，控制效果生效
- `editorStateModel.isActive(editorId)` — 仅内存，不持久化
- Go → setActive(true)；Clear → setActive(false)；Reset → clearEditor
- 切换回已激活编辑器 → `attach()` 检查 isActive → 恢复装饰（折叠由 VS Code 维持）
- 重启 VS Code → isActive 全清空 → 无自动生效

## 7. 一切效果由 Go 触发
- `activate()` 不应用过滤
- `attach()` 只加载配置到面板；若 isActive 则恢复装饰，非激活则清除折叠残留
- `onDocumentChange()` 在 isActive 时重新过滤
- Clear 清除效果保留配置，Reset 清除一切

## 8. VS Code 标准 API > hack
- ✅ `createFoldingRangeFromSelection` / `removeManualFoldingRanges` — 标准 API
- ✅ `WebviewViewProvider` — 标准 API  
- ❌ 语言切换触发 Provider 重查 — hack，已废弃
- ❌ edit + undo 触发文档变更 — hack，已废弃
- 原则：始终优先使用平台提供的标准扩展 API

## 9. 关键字颜色与行级颜色的装饰冲突
**问题**: 行级装饰和关键字装饰都使用 `TextEditorDecorationType.color` 属性，重叠区域的渲染结果不可靠，行级颜色可能覆盖关键字颜色。
**错误尝试**: 改用 `backgroundColor` → 视觉效果不直观，用户期望的是文字颜色。
**最终方案（范围减法）**: 在 `apply()` 内部：
1. 预计算所有关键字匹配范围（`computeKeywordMatches`）
2. 从行级范围中减去关键字范围（`subtractRanges`）
3. 行级颜色和小关键字颜色各自装饰互不重叠的范围
- 关键保证：**两个装饰层的范围不重叠**，因此 `color` 属性无冲突
- 性能：范围减法为 O(每行关键字匹配数)，对典型日志文件几乎无开销
- 多关键字同在一行时按顺序挖洞，重叠时后者覆盖前者

## 10. 右键菜单命令需添加 activationEvents
- 仅靠 `onView` 激活事件不够 → 右键菜单命令需要 `onCommand` 激活事件
- 否则用户未打开过侧边栏时右击不会触发命令

## 11. grep BRE vs ERE — \( \) 的陷阱
**问题**: `grepFunction` 使用 `keyword\([^)]*\)$`，但 grep 默认是 BRE（Basic RegEx），其中 `\(` 和 `\)` 是**分组运算符**而非字面括号。
**结果**: grep 匹配了所有含关键字的行，完全没有括号限制。
**修复**: 改用 BRE 字面语法 `keyword([^)]*)$`，BRE 中 `(` `)` 直接就是字面括号。
**教训**: 写 grep 正则前务必确认当前模式（BRE/ERE），不同模式下元字符语义完全不同。

## 12. 环境变量：process.env ≠ terminal 的 export
**问题**: 用户在 terminal 中 `export myout=./out`，然后在 dirs 配置 `!${myout}`，但 grep 仍然搜到了 `./out`。
**根因**: Node.js 的 `process.env` 是扩展宿主进程的环境变量，与用户 terminal 的 shell 环境变量是**完全隔离**的。
**修复**: 删除 `expandEnv()` 方法，保留原始 `${VAR}` 引用透传给 shell 命令，由 terminal 的 shell 在命令执行时展开。
**额外处理**: 排除目录通过 `--exclude-dir` 需要 basename，使用 shell 参数展开 `${_var##*/}` 取路径最后一段。
```bash
_ex0=./out; grep -rn --exclude-dir="${_ex0##*/}" 'keyword' dirs
```

## 13. Terminal 复用
**错误**: 每次 grep 都 `vscode.window.createTerminal()`，造成 terminal 列表膨胀。
**修复**: 用 `vscode.window.activeTerminal` 获取用户当前终端，不存在时才创建。
**教训**: VS Code 扩展产生的输出应尽量复用已有面板/终端，避免污染用户工作空间。

## 14. Dirs 配置独立于 Go 按钮
**需求**: dirs 配置不应该依赖用户点击 Go 才生效——用户可能只改了 dirs 没点 Go，然后右击 grep 应该用最新配置。
**方案**: GrepController 优先从 `editorStateModel.loadConfig()`（workspaceState 持久化）读取 dirs，再回退到 `regexGroupModel`（内存模型）。
**权衡**: workspaceState 是上次 Go 保存的快照，不完全实时，但已是最接近用户意图的数据源。完全实时需要 webview→extension 的即时 sync 消息，引入额外复杂度。

## 15. 事件委托 + 非 button 元素 = 静默失败
**问题**: Line Ranges 的 radio button 是 `<input type="radio" data-action="activateRange">`，但事件委托做了 `e.target.closest('button')` 的提前返回，导致 radio click 被**静默忽略**。`activeRangeId` 从未更新，Go 始终用第一个 range 的 startLine/endLine。浏览器原生 radio 行为让 UI 看起来正常，极具迷惑性。
**修复**: 改为 `closest('button, input[data-action]')`，让 radio input 也能匹配。
**教训**: 事件委托时不要假设所有可交互元素都是 `<button>`。用 `data-action` 属性驱动行为时，`closest()` 选择器必须覆盖所有可能的元素类型。

## 16. 手动折叠区间的清理与创建顺序
**问题**: `applyFolding` 在 Go 时只调 `editor.unfoldAll`（仅展开），未调 `editor.removeManualFoldingRanges`（不删除），旧区间残留导致新区间冲突。且侧边栏点 Go 后编辑器可能失焦，fold 命令静默失败。
**修复**:
1. 先 `showTextDocument(preserveFocus: false)` 确保编辑器有焦点
2. `unfoldAll` + 选全文 + `removeManualFoldingRanges` 彻底清除旧折叠
3. 从底向上创建新区间（底部折叠不影响上方行号，避免视口偏移干扰）
4. 创建完成后检查光标是否落入折叠区，若是则移到折叠区前最后一个匹配行
**教训**: `createFoldingRangeFromSelection` 有副作用（改变视口），循环创建时要注意顺序。

## 17. Time Pattern 三个坑
1. **Linux kernel 格式 `[    ss.SSSSSS]` 匹配不出**: 内核日志秒数可变宽度（1-6位）+ 可变空格填充，`ss` 固定 2 位、空格为字面量，完全不匹配。**修复**: 增加 `s` token（贪婪读数字）、`SSSSSS` token（6 位微秒，自动 /1000 转毫秒）、连续 2+ 空格合并为灵活空白、token 前自动跳过空格。
2. **firstMatchTime 应从第一个匹配行算起**: `findFirstMatchTime` 从第 0 行扫描，可能命中折叠行的时间戳 → 经历时间锚点错误。**修复**: 传入 `matchedSet`，跳过折叠行。
3. **折叠行经历时间可能超过总时间**: `findTimeBefore/After` 同样会穿透折叠行取到内部时间戳 → 计算出来的时间跨度无意义。**修复**: 同样传入 `matchedSet` 限制搜索范围。

## 18. 范围内 keyword 命中行必须保持可见
**需求**: 在 [startPattern, endPattern) 范围内的行，即使未被任何 regex group 匹配，只要命中 keyword pattern 就应保持可见（不折叠、不 dim）。
**错误尝试**: 在 `applyFolding()` 异步方法中调用 `excludeKeywordLinesFromRanges()` 过滤折叠区间 → 引入新的 `readLines()` 调用和参数传递，破坏了 async folding 流程，导致所有折叠失效。
**正确方案**: 在 `setResults()` 之前修改 `FilterResult[]`，将范围内 keyword 命中行的 `groupId` 设为 `'__kw_visible__'`。`getUnmatchedRanges()` 自然排除这些行，`applyFolding()` 完全不需要修改。
**教训**: 修改异步核心流程（如折叠）风险极高，最优解是调整数据层让下游代码无需感知。

## 19. Flags 输入 UX：纯文本框 → 多选面板
**问题**: regex flags 输入框的 placeholder 是 `i`，对新用户无提示意义。
**方案**: 替换为点击弹出式多选 panel，checkbox 带描述：
- `i` — ignore case
- `m` — multiline (^/$ match lines)
- `s` — dotAll (. matches newline)
触发器显示当前 flags 值（如 `im`），空时显示 `···`。勾选/取消即时更新数据模型，无需额外的 `collectData()` 收集。

## 20. Keyword 正则的 g 标志导致 test() 有状态
**问题**: `regex.test()` 带 `g` 标志时，`lastIndex` 会跨行残留。对每行不同字符串调用 `test()` 时，如果 `lastIndex` 非零，可能从错误位置开始搜索，导致后续行匹配被漏掉。多个 keyword 同时启用时，每个 keyword 的 regex 独立受影响，造成某些 keyword 在 timeline 中完全不显示。
**修复**: 创建 `buildKwRegex()` 静态 helper，统一 `(kw.flags || '').replace(/g/g, '')` 移除 g 标志，所有 keyword 正则构建都走此 helper。

## 21. Canvas fillStyle 不解析 CSS var()
**问题**: `ctx.fillStyle = 'var(--vscode-descriptionForeground)'` — Canvas API 不会像 CSS 那样解析 `var()` 函数，导致颜色无效（fallback 到透明或上一个 fillStyle），时间轴标签完全不可见。
**修复**: 改用 `getComputedStyle(document.body).getPropertyValue('--vscode-descriptionForeground')` 显式读取 CSS 变量值，并带上 fallback `'#999999'`。

## 22. Canvas 缩放的 RAF 节流
**问题**: 滚轮事件每秒触发数十次，每次直接同步调用 `draw()` 重绘整个 canvas，导致画面卡顿不丝滑。
**修复**: 用 `requestAnimationFrame` 做节流——`scheduleDraw()` 在已排期时跳过，同帧内多次调用只执行最后一次 `draw()`。

## 23. 大文件折叠失效：VS Code 内部限制
**问题**: 超过约 30 万行或 20MB 的文件，`editor.foldAll` 静默无效，非匹配行不折叠。
**根因**: VS Code 对大文件有内部折叠限制（非 `foldingMaximumRegions` 设置可控），foldAll 命令不报错但不生效。
**修复**: 用 `isFoldingDisabled(editor, lineCount)` 判断（行数 >30万 或文件 >20MB），超阈值时跳过 foldAll/unfoldAll，改为提示用户用 Export 导出过滤结果到新 editor。
**教训**: 不要假设 VS Code 命令在大文件上一定生效；要用 visibleRanges 验证实际折叠状态，不能只信任模型数据。

## 24. 大文件 Clear/Reset 超时
**问题**: 大文件上点 Clear，`editor.unfoldAll` 超时 10s+，导致 Clear 似乎"卡死"。
**修复**: 所有 fold/unfold 操作都用 `isFoldingDisabled()` 保护，大文件直接跳过。
**教训**: VS Code 的 fold 命令在大文件上性能极差，必须设阈值跳过。

## 25. 切换编辑器后折叠被重置
**问题**: `attach()` 每次切回文件都 clearFoldingState + foldAll，用户手动展开的折叠被重新折起。
**修复**: 用 `attachedEditors: Set<string>` 记录本次会话已完整恢复的编辑器。首次恢复（如重启后）才 foldAll；会话内切回只恢复颜色装饰，保留折叠状态。
**关键**: `handleGo()` 和 `addKeyword()` 也要加入 Set，否则点 Go 后第一次切回仍被误判为首次恢复。

## 26. Clear 未清空匹配计数
**问题**: `handleClear` 发送了零计数消息但未更新 `lastMatchCounts` 缓存，测试读到旧值。
**修复**: 统一用 `sendMatchCountsMessage(msg)` 同时更新缓存和发送面板消息。
**教训**: 手动构造消息发送时，要确保所有缓存同步更新。

## 27. Skill 自动安装
**需求**: 插件安装/更新时把 skill 拷贝到 `~/.agent/skills/`。
**实现**: `installSkill()` 在 `activate()` 时读取 bundled `skills/greplogviewer-config/SKILL.md`，与目标文件内容比较，不同才写入。
**注意**: skill 必须有 YAML frontmatter（`name` + `description`），否则不会被 agent 加载。`skills/` 不能在 `.vscodeignore` 中。
