# 文件地图 - 每个文件的作用

## 配置文件
| 文件 | 作用 | 关键字段 |
|------|------|----------|
| `package.json` | 插件清单 | `contributes.views.explorer`, `activationEvents`, `main: "./out/extension.js"`, 右键菜单+命令, 版本 0.2.11 |
| `tsconfig.json` | TS 编译配置 | strict, target ES2020, module commonjs, outDir out/ |
| `.mocharc.json` | Mocha 配置 | require ts-mocha, spec test/**/*.test.ts |
| `.gitignore` | Git 忽略 | node_modules, out, *.vsix, .DS_Store |
| `.vscodeignore` | VSIX 打包排除 | 排除 src/test/autotest/prompts，保留 assets/skills/out |

## 设计文档
| 文件 | 内容 |
|------|------|
| `.agent_doc/01-08_*_ring_buffer.md` | Ring buffer 功能设计文档 |
| `prompts/00-06_*.md` | 项目文档（概述/架构/类型/规范/踩坑/构建/文件地图） |

## 源码 (src/)

### 入口
| 文件 | 作用 |
|------|------|
| `src/extension.ts` | activate: 安装 skill 到 ~/.agent/skills/, 初始化 MVC, 注册 FoldingRangeProvider + 命令(Grep/Goto/Export) + 监听器 + 测试命令 |

### 类型 (src/types/)
| 文件 | 作用 |
|------|------|
| `src/types/index.ts` | LogicOperator, RegexExpression, RegexGroup(含 associatedDirs), KeywordConfig(matchScope), FilterResult, TimePatternConfig, FoldRange, EditorConfig, ConfigScope, SavedConfigEntry, 消息协议(含 ExportMatchedLines/GotoKeywordMatch+keywordId) |

### Model (src/model/)
| 文件 | 作用 |
|------|------|
| `src/model/RegexGroupModel.ts` | 正则组 CRUD + 表达式 CRUD + 正则校验 |
| `src/model/EditorStateModel.ts` | 编辑器->配置映射 + workspaceState 持久化 |
| `src/model/FilterResultModel.ts` | 匹配结果存储 + 折叠区间计算 + getFoldRanges + setProtectedLines(ring buffer) + setEmptyResults |
| `src/model/TimeMatchModel.ts` | 时间格式解析(灵活空白/微秒/可变秒), 行时间戳提取, computeFoldRanges(含区间内时间戳回退), autoDetect(Android/kernel/ISO), detectRingBufferStartLine |
| `src/model/RingBufferModel.ts` | 每编辑器的 ring buffer 起点行存储 |
| `src/model/ConfigStorageModel.ts` | 命名配置预设 CRUD, workspaceState + globalState |
| `src/model/uuid.ts` | UUID v4 生成 |

### Controller (src/controller/)
| 文件 | 作用 |
|------|------|
| `src/controller/ConfigController.ts` | 封装 RegexGroupModel + EditorStateModel |
| `src/controller/FilterController.ts` | `filter()` 同步过滤 + `filterAsync()` 异步分块过滤(大文件) + `matchGroup()` 单组匹配 |
| `src/controller/GrepController.ts` | 右键 grep 关键字/函数, !排除/${VAR}/shell basename |
| `src/controller/ViewController.ts` | attach(含 attachedEditors 会话跟踪), handleGo/handleClear/handleReset, applyFolding(含大文件跳过), exportMatchedLines(untitled editor), gotoKeywordHit(按 keyword 跳转), gotoPrevNextHit, 大文件提示+导出, runFilterWithProgress, sendMatchCountsMessage |

### View (src/view/)
| 文件 | 作用 |
|------|------|
| `src/view/ConfigPanel.ts` | WebviewViewProvider, 内联 HTML/CSS/JS, 事件委托; Regex Groups + Keyword Highlight(含↑/↓导航按钮) + Advance(Time Fmt/Save/Export/Import) + Action bar(Go/Clear/Reset/Export) + 颜色选择器 + Flags 多选 |
| `src/view/EditorDecorations.ts` | TextEditorDecorationType 管理; 匹配行高亮 + 未匹配行 dim(大文件跳过) + 关键字子串颜色(范围减法) + 时间标注 + ring buffer 红旗 |
| `src/view/KeywordTimeline.ts` | 底部面板时间线图表; canvas 渲染 + hover tooltip + click 跳转 + 滚轮 zoom |

## Skill
| 文件 | 作用 |
|------|------|
| `skills/greplogviewer-config/SKILL.md` | Agent Skills 规范的 skill, 帮助 AI 自动配置 grep group/keyword/time pattern; activate 时自动拷贝到 ~/.agent/skills/ |

## 测试 (test/)
| 文件 | 测试数 | 覆盖 |
|------|--------|------|
| `test/FilterController.test.ts` | 14 | matchGroup 逻辑组合, filter 同步, filterAsync 异步分块 |
| `test/FilterResultModel.test.ts` | 7 | getMatchedLines, getUnmatchedRanges, kw_visible 排除, protectedLines |
| `test/RegexGroupModel.test.ts` | 15 | CRUD, 正则校验, setGroups |
| `test/GrepController.test.ts` | 80 | grepKeyword, grepFunction, 环境变量, terminal 复用 |
| `test/TimeMatchModel.test.ts` | 44 | parseFormat, parseDate, computeFoldRanges, 微秒, 可变秒, 匹配行限定, 边界, autoDetect, ringBuffer |
| `test/RingBufferModel.test.ts` | ~10 | ring buffer 起点存储 |

## Autotest (autotest_workspace/)
| 文件 | 覆盖 |
|------|------|
| `fold_persistence_test.yaml` | 折叠持久化 |
| `clear_then_go_test.yaml` | Clear->Go 重过滤 + 命中计数清零/重算 |
| `color_change_sync_test.yaml` | 颜色实时同步 |
| `goto_hit_test.yaml` / `goto_hit_overlap_test.yaml` | Goto 命中行导航 |
| `keyword_full_scope_test.yaml` | keyword 全局匹配行不折叠 |
| `keyword_goto_test.yaml` | 按 keyword 跳转 |
| `export_matched_lines_test.yaml` | 导出匹配行到 untitled editor |
| `ring_buffer_test.yaml` / `ring_buffer_protected_test.yaml` / `ring_buffer_auto_detect_test.yaml` | Ring buffer |
| `large_file_filter_test.yaml` / `large_1m_file_filter_test.yaml` / `large_file_clear_test.yaml` | 大文件过滤/Clear |
| `switch_back_preserve_fold_test.yaml` | 切换编辑器保留折叠状态 |
| `kernel_mixed_time_format_test.yaml` | 混合 kernel 时间格式 |
