# Grep 代码跳转 — 详细设计

## 概述
用户通过 log 关键字快速定位到对应代码文件。在每个 RegexGroup 中配置关联代码目录，选中关键字右击执行 grep。

## 数据模型

### RegexGroup 扩展
```typescript
interface RegexGroup {
  // ... 原有字段 ...
  /** 关联代码目录，分号分隔的相对路径。如 "src/server; src/utils; !src/test" */
  associatedDirs?: string;
}
```

- 分隔符：`;`（分号）
- 排除语法：`!` 前缀，如 `!src/test`
- 环境变量：`${VAR}` 或 `$VAR`，由 shell 展开
- 未配置时默认搜索整个 workspace 根目录

## 右键菜单

| 命令 | 标题 | 触发条件 | 效果 |
|------|------|----------|------|
| `greplogviewer.grepKeyword` | Grep Keyword | `editorHasSelection` | `grep -rn 'keyword' dirs` |
| `greplogviewer.grepFunction` | Grep Function | `editorHasSelection` | `grep -rn 'keyword([^)]*)$' dirs` |

### grepFunction 正则说明
- BRE 模式（grep 默认）：`keyword([^)]*)$`
- `(` `)` 直接匹配字面括号（BRE 语义）
- `[^)]*` 非贪婪匹配括号内任意内容
- `$` 行尾锚定

## 目录查找逻辑

```
getRawDirs():
  1. editorStateModel.loadConfig(editorId) → 从持久化配置读取（无需点 Go）
     a. 找到选中行匹配的组的 associatedDirs
     b. 回退：第一个 enabled 且有 associatedDirs 的组
  2. 回退：regexGroupModel.getGroups() → 内存模型兜底
```

## 命令生成

### 包含路径
```bash
"${workspace}/src/server" "${workspace}/src/utils"
```
双引号允许 shell 展开内嵌的 `${VAR}`。

### 排除路径
```bash
_ex0=./out; grep -rn --exclude-dir="${_ex0##*/}" 'keyword' dirs
```
- 先赋值 shell 变量 `_ex0`
- `${_ex0##*/}` 取 basename（`./out` → `out`）
- 传给 `--exclude-dir` 匹配目录名

### 完整命令
```bash
echo ">>>" && grep -rn --color=always ${excludeFlags} 'pattern' "dir1" "dir2" && echo ">>>"
```

## 关键技术决策

| 决策 | 原因 |
|------|------|
| 环境变量由 shell 展开 | `process.env` 拿不到 terminal 的 export |
| BRE 字面括号 `(` `)` | grep 默认 BRE 模式，`\(` 是分组符 |
| 从 workspaceState 读取 dirs | 不依赖 Go 按钮，dirs 独立生效 |
| 复用 `activeTerminal` | 避免 terminal 列表膨胀 |
| `>>>` 分隔线 | 在 terminal 中清晰分隔多次 grep 结果 |

## 激活事件

```json
"activationEvents": [
  "onView:greplogviewer.configView",
  "onCommand:greplogviewer.grepKeyword",
  "onCommand:greplogviewer.grepFunction"
]
```
- `onCommand` 确保不开侧边栏也能右键触发
