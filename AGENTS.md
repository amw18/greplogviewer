# GrepLogViewer — VS Code Extension

基于正则表达式的文本文件增强查看器。配置面板在左侧边栏，Go 按钮触发过滤。

## 新会话必读

开始工作前，按顺序阅读 `prompts/` 下的文档：
1. `prompts/00_project_overview.md` — 项目概述、技术栈
2. `prompts/01_architecture.md` — MVC 架构、数据流、模块职责
3. `prompts/02_types_and_interfaces.md` — 所有类型和接口定义
4. `prompts/03_coding_conventions.md` — 编码规范、命名、Git 规则
5. `prompts/04_lessons_learned.md` — 踩坑记录（必读！）
6. `prompts/05_build_and_test.md` — 构建、测试、调试命令
7. `prompts/06_file_map.md` — 每个文件职责速查

## 关键命令

```bash
npm test              # 运行 165 个单元测试
npx tsc --noEmit      # 类型检查
npx tsc               # 编译
# F5 启动调试
```

## 核心原则

- 一切效果由用户点击 Go 触发，插件激活/切换编辑器时不自动生效
- 使用 VS Code 标准扩展 API，禁止 hack（语言切换、edit tricks 等）
- 不自行提交 GitHub，需用户授权
- 提交前更新相关文档
- 美观是基本要求 — 所有 UI 开发须时刻保持视觉和谐

## 已实现功能

### 日志过滤与高亮
- 正则组匹配 → 行级颜色高亮 + 未匹配行折叠 + 时间标注
- 关键字匹配 → 子串颜色高亮（范围减法，与行级颜色不冲突）
- 颜色选择器弹出面板（native + 15 色预设色板，Cool/Warm/HiCon）

### 代码跳转 (Grep)
- 每个 RegexGroup 可配置关联代码目录（`associatedDirs`）
- 选中关键字右击 → **Grep Keyword** / **Grep Function**
- 结果输出到当前 terminal，前后 `>>>` 分隔
- 支持分号分隔多目录、`!` 排除、`${VAR}` 环境变量（由 shell 展开）
- Dirs 从持久化配置读取，无需点 Go
- 未配置 dirs 时默认搜索整个 workspace
