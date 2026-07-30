# Log--

> [English](README.md) | [中文](README_CN.md)

> Regex-based VS Code log viewer — color highlighting, auto-folding, keyword timeline, code grep. log + AI = log--.

![screenshot](screenshot.png)

---

## Overview

AI configures — highlighting what you care about, folding everything else.
AI analyzes — visual reasoning chain, click any step to jump to that line.

Built for debugging large log files: Android logcat, kernel logs, app traces, and more.

---

## Features

### 🎨 Group Coloring & Auto-Fold

Define regex groups with colors to spotlight issues. Unmatched lines **auto-fold** — expand on demand.

### 🔍 Keywords

**Match annotation** — annotate cryptic values with human-readable hints at line end.
**Live position** — shows which match number your cursor is closest to (e.g., 7/18), tap to jump.
**Timeline** — see keyword hit distribution across time, click to navigate.

### 🚩 Ring Buffer Detection

Detects timestamp wrap-around in ring-buffer logs. The reset point is marked with a red flag icon.

### 🖱️ Right-Click Grep

Read logs in editor, grep definitions in terminal — best of both worlds.

### 🤖 AI-Native

Built-in **Agent Skill** — AI configures filters for you, analyzes logs, and draws clickable flowcharts tracing the evidence chain.

---

### Example: Agent Workflow

> "/goal This log file may contain a crash caused by the audio module. Use Log-- to filter out unrelated modules, analyze the crash from root cause to impact, and draw a flowchart with clickable links to key lines."

---

## 📏 Large File Support

| File size | Behavior |
|-----------|----------|
| < 100K lines | Full features (filter, fold, timeline, dim) |
| 100K–300K lines | Async chunked filter + progress; timeline disabled >200K lines |
| >20 MB or >300K lines | Grep-based export to smaller file; full features on export |
| >50 MB | VS Code hard limit — cannot sync file to extensions |

For huge logs (1M+ line Android dumps), click the prompt to **grep-export** matched lines to a temp file where folding works normally.

---

## Usage

1. **Open** a log file in VS Code
2. **Configure** regex groups and keywords in the sidebar
   - Or use the **Solution** dropdown to apply a saved / AI-generated config
3. **Click Go** — matched lines colorize, unmatched lines fold
4. **Navigate** — ↑/↓ on keywords to jump hits; scroll-wheel on timeline to zoom
5. **Export** — click Export to copy matched lines to a new editor

---

## Installation

Search **"Log--"** in VS Code Extensions, or install from [Marketplace](https://marketplace.visualstudio.com/items?itemName=any-tool.log-dash).

---

## License

MIT
