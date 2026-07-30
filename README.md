# Log--

[English](README.md) | [中文](README_CN.md)

> **log + AI = log--** : Regex-based VS Code log viewer.
> - *AI configures* — spotlight what you care about, fold everything else.
> - *AI analyzes* — visual reasoning chain, click any step to jump to that line.

Built for debugging large log files: *Android logcat, kernel logs, app traces, and more*.

![screenshot](screenshot.png)

---

## Features

### 🎨 Group Coloring & Auto-Fold

Define regex groups with colors to spotlight issues. Unmatched lines **auto-fold** — expand on demand.

### 🔍 Keywords

**Match annotation** — annotate cryptic values with human-readable hints at line end.
**Live position** — shows which match number your cursor is closest to, tap to jump.
**Timeline** — see keyword hit distribution across time, click to navigate.

### 🤖 AI + Evidence

Built-in **Agent Skill** — AI configures filters for you, analyzes logs, and draws clickable flowcharts tracing the evidence chain.

### 🚩 Ring Buffer Detection

Detects timestamp wrap-around in ring-buffer logs. The reset point is marked with a red flag icon.

### 🖱️ Right-Click Grep

Read logs in editor, grep definitions in terminal — best of both worlds.

---

### Example: Agent Workflow

> "This log file may contain a crash caused by the audio module. Use Log-- to filter out unrelated modules, analyze the crash from root cause to impact, and draw a flowchart with clickable links to key lines."

## Usage

1. **Open** a log file in VS Code.
2. **Configure** regex groups and keywords in the Log-- sidebar.
   - Or use the **Solution** dropdown to apply a saved / AI-generated config.
3. **Click Go** — matched lines colorize, unmatched lines fold.
4. **Navigate** — ↑/↓ on keywords to jump hits; scroll-wheel on timeline to zoom.
5. **Export & Import** — share configs with your team.

## 📏 Large File Support

| File size | Behavior |
|-----------|----------|
| < 100K lines | Full features (filter, fold, timeline, dim) |
| 100K–300K lines | Async chunked filter + progress; timeline disabled >200K lines |
| >20 MB or >300K lines | Folding skipped (VS Code limit); prompted to **grep-export** matched lines |
| >50 MB | VS Code hard limit — cannot sync file to extensions |

For huge logs (1M+ line Android dumps), use **grep-export** to extract matched lines to a smaller file where folding works.

---

## License

MIT
