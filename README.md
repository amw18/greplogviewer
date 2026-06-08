# GrepLogViewer

> 基于正则的日志增强查看器 — 匹配行彩色高亮 + 未匹配行自动折叠 + 关键字时间线

<p align="center">
  <img src="https://raw.githubusercontent.com/amw18/greplogviewer/main/docs/screenshot-main.png" alt="screenshot" width="800">
</p>

---

## 怎么用

1. 打开任意文本 / 日志文件
2. 左侧边栏 **GrepLogViewer** 面板配置规则
3. 点 **Go** → 生效

**所有效果由 Go 按钮触发**，切换编辑器、改配置都不会自动生效。

---

## 功能

### 正则组高亮 + 自动折叠

为每组正则设定颜色，匹配行整行高亮。未匹配行**自动折叠**，只留下关心的内容。

### 关键字子串高亮

关键字匹配子串级着色，不与行颜色冲突（范围减法）。

### 折叠时间标注

配置时间格式后，每个折叠区域显示隐藏行数 + 时间跨度。

### 关键字时间线

底部面板以时间轴展示各关键字命中分布：
- 每关键字一行，色点标记
- 悬停看精确时间和行号，点击跳转
- 滚轮缩放，以光标位置为中心

### 右键 Grep 跳转

选中文本 → 右击 → **Grep Keyword** / **Grep Function**→ 在关联代码目录中搜索，结果输出到终端。

支持 `;` 分隔多目录、`!` 排除、`${VAR}` 环境变量。

### 配置管理

预设保存（User / Workspace）、JSON 导入导出。

---

## 安装

VS Code 扩展商店搜索 **GrepLogViewer**。

---

## 开发

```bash
git clone https://github.com/amw18/greplogviewer.git
cd greplogviewer
npm install
npm test        # 165 项测试
npx tsc         # 编译
# F5 启动调试
```

## License

MIT
