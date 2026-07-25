# GrepLogViewer

> [English](README.md) | [中文](README_CN.md)

> Regex-based log viewer for VS Code - color highlighting, auto-folding, keyword timeline, code grep, and AI-assisted configuration.

![screenshot](screenshot.png)

---

## Overview

GrepLogViewer turns VS Code into a powerful log analysis tool. Define regex groups to color-code log lines, auto-fold irrelevant content, highlight keywords with substring-level coloring, and visualize keyword hit distribution on a timeline — all triggered by a single **Go** button.

Designed for debugging large log files: Android logcat, kernel logs, application traces, and more.

---

## Features

### 🎨 Regex Group Coloring & Auto-Folding

Define multiple regex groups, each with a color and one or more expressions (combined with AND / OR / NOT logic). Matched lines get full-line color highlights. Unmatched lines are **automatically folded** so only relevant content stays visible.

- First-match-wins priority (groups evaluated top-to-bottom)
- Per-expression flags (case-insensitive, multiline, dotAll)
- Fold annotations show hidden line count + time span
- Switching files preserves your fold state within the session

### 🔍 Keyword Substring Highlighting

Keywords highlight specific substrings **within** visible lines, using range subtraction so they never clash with group colors.

- **Named capture support**: use `(?<name>...)` in the pattern, then reference captures in hints with `{{name}}` — the hint displays the actual matched value per line
- **Per-keyword scope**:
  - `matched` — only highlight within group-matched lines
  - `full` — scan all lines; keyword-only lines stay visible and are **not folded** (acts like an additional filter group)
- **Per-keyword ↑/↓ navigation** buttons to jump between that keyword's hits
- **Live count badges** showing match counts per keyword

**Named capture example**:
- Pattern: `(?<pid>\d+)\s+(?<tag>\w+):`
- Hint: `pid={{pid}} tag={{tag}}`
- Result on line `1234 MyTag: message`: displays `pid=1234 tag=MyTag`

### ⏱️ Time Annotations & Auto-Detection

Configure a time format, or **leave it empty** for auto-detection. Supported formats:

| Log type | Format | Example |
|----------|--------|---------|
| Android logcat | `MM-DD HH:mm:ss.SSS` | `01-23 12:00:00.123` |
| Android (no ms) | `MM-DD HH:mm:ss` | `01-23 12:00:00` |
| ISO 8601 | `YYYY-MM-DD HH:mm:ss.SSS` | `2024-01-23 12:00:00.123` |
| Kernel | auto-detected | `[  1.234567]` |
| Time only | `HH:mm:ss.SSS` | `12:00:00.123` |

Each folded region displays: `▼ N lines │ ~duration │ +elapsed`

### 📊 Keyword Timeline

Canvas-based timeline chart embedded in the sidebar, showing when each keyword hit occurs over time.

- **Scroll-wheel zoom** — zoom in/out at mouse position with smart tick count and sub-grid
- **Hover tooltip** — shows keyword name, time offset, line number, and the matched substring
- **Click to jump** — click any point to navigate to that line in the editor
- **Auto-resize** — CSS-driven canvas sizing with 100ms polling fallback for VS Code panel changes
- Time axis starts from the log's first timestamp (or ring-buffer wrap point)

### 🚩 Ring Buffer Detection

Detects wrap-around in ring-buffer logs (where timestamps reset). The detected start line is marked with a red flag icon and protected from folding.

### 🖱️ Right-Click Grep

Select text in any file → right-click → **Grep Keyword** / **Grep Function**:

- Searches associated code directories (configured per regex group via `associatedDirs`)
- Output to terminal with `>>>` delimiters
- Supports `;`-separated multiple directories, `!` exclusion, `${VAR}` environment variables
- `Grep Function` finds multi-line function definitions across files

### 📤 Export Matched Lines

Click **Export** to copy all matched lines to a new unsaved editor (`<filename>_matched{n}`):
- Named after the source file with a counter
- Set to `log` language for syntax highlighting
- Ideal for large files where VS Code disables folding

### 💾 Config Sharing & Management

- **Save / Apply / Delete** named configs (User or Workspace scope)
- **Export / Import** as JSON files
- Configs persist across sessions via VS Code's workspace/global state

---

## 🤖 AI-Assisted Configuration

GrepLogViewer ships with an **Agent Skill** that lets AI agents (like Pi, Claude Code, or any Agent Skills-compatible tool) automatically configure filter groups, keywords, and time patterns for any log format.

### How It Works

1. **On install/update**, the extension copies `SKILL.md` to `~/.agents/skills/greplogviewer-config/`
2. The AI agent reads the skill, analyzes your sample log lines, and generates a config JSON
3. The agent writes the config to `~/.agents/greplogviewer-configs/<name>.json`
4. The config **automatically appears** in the **Solution** dropdown in the sidebar
5. You just select it and click **Apply** — no manual import needed

### Example: Agent Workflow

```bash
# The agent writes a config file:
mkdir -p ~/.agents/greplogviewer-configs
cat > ~/.agents/greplogviewer-configs/android-crash.json << 'EOF'
{
  "groups": [
    { "id": "g1", "name": "Fatal", "color": "#ff0000",
      "expressions": [{"id":"e1","pattern":"FATAL|ASSERT","flags":"","operator":"and"}] },
    { "id": "g2", "name": "Error", "color": "#ff6600",
      "expressions": [{"id":"e2","pattern":" E /|ERROR","flags":"","operator":"and"}] }
  ],
  "timePattern": { "format": "MM-DD HH:mm:ss.SSS" },
  "keywords": [
    { "id": "kw1", "pattern": "ANR in (?<app>\\S+)", "flags": "",
      "color": "#ff00ff", "matchScope": "full", "hint": "ANR: {{app}}" }
  ]
}
EOF
```

The config `android-crash` appears in the Solution dropdown as `(file)` scope. Click **Apply** to load it, then **Go** to filter.

### Skill Content

The bundled skill (`skills/greplogviewer-config/SKILL.md`) includes:
- Step-by-step configuration procedure for AI agents
- Common regex patterns by log type (Android, kernel, generic)
- Named capture hint syntax with practical examples
- Config JSON structure reference
- Large file handling guidelines
- Pitfalls and verification steps

---

## 📏 Large File Support

| File size | Behavior |
|-----------|----------|
| < 100k lines | Full features (filter, fold, timeline, dim) |
| 100k–300k lines | Async chunked filter with progress bar; timeline disabled >200k lines |
| >20 MB or >300k lines | Folding skipped (VS Code limitation); **Export** to filtered editor offered |
| >50 MB | VS Code hard limit — cannot sync file to extensions |

For very large logs (e.g. 1M+ line Android dumps), use **Export** to extract matched lines into a smaller editor where folding works.

---

## Usage

1. **Open** a log file in VS Code
2. **Configure** regex groups and keywords in the GrepLogViewer sidebar
   - Or use **Solution** dropdown to apply a saved/agent-generated config
3. **Click Go** — matched lines get colored, unmatched lines fold
4. **Navigate** — use ↑/↓ on keywords to jump between hits; scroll-wheel on timeline to zoom
5. **Export** — click Export to copy matched lines to a new editor

---

## Installation

Search **"GrepLogViewer"** in VS Code Extensions, or install from [Marketplace](https://marketplace.visualstudio.com/items?itemName=any-tool.greplogviewer).

---

## Development

```bash
git clone <repo-url>
cd greplogviewer
npm install
npm test          # 204 unit tests
npx tsc --noEmit  # type check
# Press F5 in VS Code to launch extension debug host
```

### Architecture

MVC layered architecture:
- **Model**: `RegexGroupModel`, `FilterResultModel`, `TimeMatchModel`, `ConfigStorageModel`, `RingBufferModel`
- **Controller**: `FilterController` (regex engine), `GrepController` (code search), `ViewController` (orchestrator)
- **View**: `ConfigPanel` (sidebar webview with inline timeline), `EditorDecorations` (highlight/fold annotations)

### Key Design Decisions

- **FoldingRangeProvider** for declarative folding (not manual `createFoldingRangeFromSelection`)
- **WebviewViewProvider** for sidebar (doesn't steal editor focus)
- **Go button** triggers all effects — no auto-apply on activation or editor switch
- **Session-aware attach**: switching back to a filtered file preserves your fold state

---

## License

MIT
