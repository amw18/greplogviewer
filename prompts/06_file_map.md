# 文件地图 — 每个文件的作用

## 配置文件
| 文件 | 作用 | 关键字段 |
|------|------|----------|
| `package.json` | 插件清单 | `contributes.views.explorer`, `activationEvents: ["onView:..."]`, `main: "./out/extension.js"` |
| `tsconfig.json` | TS 编译配置 | strict, target ES2020, module commonjs, outDir out/ |
| `.mocharc.json` | Mocha 配置 | require ts-mocha, spec test/**/*.test.ts |
| `.gitignore` | Git 忽略 | node_modules, out, *.vsix, .DS_Store, goal.md |
| `.vscode/launch.json` | F5 调试 | preLaunchTask: npm: compile |
| `.vscode/tasks.json` | 任务定义 | compile 和 test 两个 npm 脚本任务 |

## 设计文档 (dev_doc/)
| 文件 | 内容 |
|------|------|
| `dev_doc/01_概要设计.md` | 系统架构、组件关系、数据流 |
| `dev_doc/02_详细设计.md` | 数据模型、核心算法、折叠策略、事件流程 |
| `dev_doc/03_接口设计.md` | Model/Controller/View 接口定义、消息协议 |
| `dev_doc/04_原型设计.md` | UI 布局、交互细节、状态流转、文件结构 |

## 源码 (src/)

### 入口
| 文件 | 行数 | 作用 |
|------|------|------|
| `src/extension.ts` | ~50 | activate: 初始化 Model→Controller→View, 注册 WebviewViewProvider + FoldingRangeProvider + 监听器 |

### 类型 (src/types/)
| 文件 | 行数 | 作用 |
|------|------|------|
| `src/types/index.ts` | ~160 | LogicOperator 枚举, RegexExpression, RegexGroup(含 associatedDirs), KeywordConfig, FilterResult, TimePatternConfig, FoldRange, EditorConfig, ConfigScope, SavedConfigEntry, 消息协议类型（含 config management）

### Model (src/model/)
| 文件 | 行数 | 作用 |
|------|------|------|
| `src/model/RegexGroupModel.ts` | ~80 | 正则组 CRUD + 表达式 CRUD + 正则校验 |
| `src/model/EditorStateModel.ts` | ~50 | 编辑器→配置映射 + workspaceState 持久化 |
| `src/model/FilterResultModel.ts` | ~90 | 匹配结果存储 + 折叠区间计算 + getFoldRanges 时间富化 |
| `src/model/TimeMatchModel.ts` | ~260 | 时间格式解析（含灵活空白、SSSSSS微秒、s可变秒），行时间戳提取，FoldRange 元数据填充（仅搜索匹配行） |
| `src/model/uuid.ts` | ~8 | 纯函数 `uuid()` 生成 UUID v4 |
| `src/model/ConfigStorageModel.ts` | ~70 | 命名配置预设 CRUD，持久化到 workspaceState（工作区级）和 globalState（用户级），支持 save/list/get/delete/exists |

### Controller (src/controller/)
| 文件 | 行数 | 作用 |
|------|------|------|
| `src/controller/ConfigController.ts` | ~60 | 封装 RegexGroupModel + EditorStateModel 操作 |
| `src/controller/FilterController.ts` | ~70 | `filter()` 全文过滤 + `matchGroup()` 单组匹配（核心算法） |
| `src/controller/GrepController.ts` | ~160 | 右键 grep 关键字/函数，支持 !排除、${VAR}、shell basename 提取，terminal 输出 |
| `src/controller/ViewController.ts` | ~560 | `attach()` 切换编辑器, `handleGo()/handleClear()/handleReset()`, `applyFolding()`/`adjustCursorOutOfFolds()`, `clearFoldingState()`, `getCurrentEditor()`，配置 export/import/save/apply/delete 操作 |

### View (src/view/)
| 文件 | 行数 | 作用 |
|------|------|------|
| `src/view/ConfigPanel.ts` | ~1030 | WebviewViewProvider 实现，内联 HTML/CSS/JS，事件委托，含 Line Ranges（单行卡片+默认项）+ Time Pattern + Keyword Highlight + 弹出式颜色选择器（Native + 15色预设色板）+ Config Management（export/import/save/apply/delete）|
| `src/view/EditorDecorations.ts` | ~320 | 管理 TextEditorDecorationType；匹配行高亮 + 未匹配行灰暗 + 关键字子串颜色（范围减法）；`apply()` 支持 scanStart/scanEnd 参数在范围内扫描关键字；`__kw_visible__` 行不 dim；时间标注 after 装饰 |
| `src/view/KeywordTimeline.ts` | ~280 | WebviewViewProvider，底部面板时间线图表；canvas 渲染多 keyword 时间点分布 + 等距时间轴；hover tooltip；click 跳转；鼠标滚轮 zoom in/out（以鼠标位置为中心，RAF 节流）；zoom 指示条 |

## 测试 (test/)
| 文件 | 测试数 | 覆盖 |
|------|--------|------|
| `test/FilterController.test.ts` | 12 | matchGroup 各种逻辑组合、filter 首组匹配优先 |
| `test/FilterResultModel.test.ts` | 6 | getMatchedLines, getUnmatchedRanges, clearResults |
| `test/RegexGroupModel.test.ts` | 15 | CRUD 操作、正则校验、setGroups |
| `test/GrepController.test.ts` | 80 | grepKeyword, grepFunction, 环境变量, terminal 复用, 路径处理 |
| `test/TimeMatchModel.test.ts` | 40 | parseFormat, parseDate, computeFoldRanges, SSSSSS微秒, s可变秒, 空白处理, 匹配行限定, 边界情况 |

## 上下文文档 (prompts/)
| 文件 | 内容 |
|------|------|
| `prompts/00_project_overview.md` | 项目目标、技术栈、关键决策 |
| `prompts/01_architecture.md` | MVC 架构、数据流、模块职责表、文件树 |
| `prompts/02_types_and_interfaces.md` | 所有类型定义和接口签名 |
| `prompts/03_coding_conventions.md` | 命名规范、注释风格、测试模式、Git 规范 |
| `prompts/04_lessons_learned.md` | 踩坑记录：折叠、焦点、事件绑定、匹配逻辑 |
| `prompts/05_build_and_test.md` | 命令速查、调试方法、测试范围 |
| `prompts/06_file_map.md` | 本文件 — 每个文件职责速查 |
