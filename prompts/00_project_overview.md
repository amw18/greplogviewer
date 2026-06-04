# GrepLogViewer — 项目概述

## 目标
一个 VS Code 插件，基于正则表达式提供文本文件的增强查看体验：
- 配置多个正则表达式组，每组可设颜色，匹配行高亮显示
- 配置关键字匹配（正则），匹配子串显示指定文字颜色（从行颜色中"挖洞"实现）
- 每组可关联代码目录（分号分隔、!排除、${VAR}环境变量），右击关键字 → Grep Keyword / Grep Function
- 未匹配行自动折叠
- 折叠区域标注行数 + 时间范围（需配置 Time Pattern）
- 首组匹配优先

## 技术栈
- **语言**: TypeScript (strict mode)
- **运行环境**: VS Code Extension API (^1.85.0)
- **UI**: WebviewView (侧边栏) + VS Code 原生编辑器
- **存储**: `ExtensionContext.workspaceState`
- **测试**: ts-mocha + Node assert
- **构建**: tsc → out/

## 关键设计决策
1. **不自定义 editor** — 基于 VS Code 原生编辑器，用 `FoldingRangeProvider` + `TextEditorDecorationType` 增强
2. **配置面板在侧边栏** — 使用 `WebviewViewProvider` 而非 `WebviewPanel`（面板不会抢占编辑器焦点）
3. **正则组内逻辑** — 扁平化 operator-per-expression 模型（非树），按顺序从左到右计算
4. **Go 按钮生效** — 配置不实时生效，点 Go 才执行过滤

## 项目路径
```
~/workspace/vs_plugin/greplogviewer/
```

## 快速开始
```bash
cd ~/workspace/vs_plugin/greplogviewer
npm install
npm test          # 165 个单元测试
code .            # 在 VS Code 打开，F5 启动调试
```
