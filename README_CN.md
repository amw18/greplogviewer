# GrepLogViewer

> [English](README.md) | [中文](README_CN.md)

> 基于正则表达式的 VS Code 日志查看器 - 颜色高亮、自动折叠、关键字时间线、代码跳转。

![screenshot](screenshot.png)

## 功能

### 正则组着色与自动折叠

定义多个正则组并指定颜色。匹配行整行高亮；未匹配行**自动折叠**，只保留相关内容。首组匹配优先。

### 关键字子串高亮

子串级着色，与行级颜色不冲突（范围减法）。支持：
- 正则命名捕获组 `(?<name>...)`
- hint 中用 `{{name}}` 引用捕获值
- 每个关键字独立作用域：`matched`（仅匹配行内）或 `full`（全文扫描）
- 每个关键字独立的 ↑/↓ 命中行导航按钮

### 时间标注

配置时间格式（留空则自动检测：Android logcat、kernel、ISO 等）。每个折叠区域显示隐藏行数 + 时间跨度。

### 关键字时间线

内嵌在侧边栏的 canvas 时间线图表。展示关键字命中分布，支持：
- 滚轮缩放（canvas 相对坐标）
- 悬停 tooltip 显示匹配子串
- 点击跳转到源行
- 自动适应面板尺寸（轮询兜底）

### Ring Buffer 检测

检测环形缓冲区日志的回绕起点，用红旗图标标记。

### 右键 Grep

选中文本 -> 右键 -> **Grep Keyword** / **Grep Function** -> 搜索关联代码目录，结果输出到终端。支持分号分隔多目录、`!` 排除、`${VAR}` 环境变量。

### 导出匹配行

点击 **Export** 将所有匹配行复制到新的未保存编辑器（`<文件名>_matched{n}`），适用于大文件无法折叠的场景。

### 配置共享

保存命名配置，导出/导入 JSON。AI agent 可自动将配置写入 `~/.agents/greplogviewer-configs/`，自动出现在 Solution 下拉列表中。

### 大文件支持

| 文件大小 | 行为 |
|----------|------|
| < 10 万行 | 全功能 |
| 10 万–30 万行 | 异步分块过滤，>20 万行禁用时间线 |
| >20 MB 或 >30 万行 | 跳过折叠，提示导出 |
| >50 MB | VS Code 硬限制（无法同步到扩展） |

## 使用方法

1. 打开日志文件
2. 在侧边栏配置正则组和关键字
3. 点击 **Go**
4. 用关键字 ↑/↓ 导航命中行，滚轮缩放时间线

## 安装

在 VS Code 扩展商店搜索 "GrepLogViewer"，或从 [Marketplace](https://marketplace.visualstudio.com/items?itemName=any-tool.greplogviewer) 安装。

## 开发

```bash
npm install
npm test          # 204 个单元测试
npx tsc --noEmit  # 类型检查
# 按 F5 调试
```

## License

MIT
