# GrepLogViewer

> Regex-based log file viewer with color highlighting, auto-folding, and keyword timeline — all inside VS Code.

<p align="center">
  <img src="https://raw.githubusercontent.com/amw18/greplogviewer/main/docs/screenshot-main.png" alt="GrepLogViewer" width="800">
</p>

---

## Features

### 🎨 Regex Group Coloring

Define regex groups with custom colors. Matched lines get full-line highlighting. Unmatched lines are **auto-folded** so you only see what matters.

### 🔍 Keyword Highlighting

Highlight specific substrings within lines using independent colors. Keywords use a range-subtraction technique so they never clash with group-level colors.

### ⏱️ Time Pattern & Fold Annotations

Configure a time format (`HH:mm:ss.SSS`) and each folded region shows:
- Number of hidden lines
- Time range of hidden content
- Keyword hit counts

### 🕐 Keyword Timeline

A bottom-panel timeline chart visualizes all keyword matches across time:

- **One row per keyword** with color-coded dots
- **Hover** to see exact timestamps and line numbers; **click** to jump
- **Mouse wheel zoom** in/out centered on cursor — inspect dense clusters
- **Zoom indicator** bar shows current view range vs full data

### 🖱️ Right-Click Grep

Select text in any file, right-click:

| Command | What it does |
|---------|-------------|
| **Grep Keyword** | Searches associated code directories for the selected word |
| **Grep Function** | Finds function definitions matching the selected word |

Results output to the current terminal. Directories support `;` separation, `!` exclusion, and `${VAR}` environment variables.

### 💾 Config Management

Save named configs (`User` or `Workspace` scope), export/import as JSON, apply saved configs with one click.

---

## Installation

1. Open VS Code
2. Go to Extensions (`Ctrl+Shift+X`)
3. Search **GrepLogViewer**
4. Click **Install**

Or download from [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=your-publisher-name.greplogviewer).

---

## Quick Start

1. Open a log file
2. Click the **GrepLogViewer** icon in the left sidebar
3. Add a regex group with a pattern (e.g. `ERROR|FATAL`) and pick a color
4. *(Optional)* Add keywords (e.g. `timeout`) with a different color
5. *(Optional)* Set a **Time Pattern** to see fold annotations with timestamps
6. Click **Go** → matched lines are highlighted, everything else is folded

---

## Configuration

All settings live in the sidebar panel:

| Section | Purpose |
|---------|---------|
| **Line Ranges** | Limit scanning to a start/end pattern region |
| **Regex Groups** | Define regex patterns with colors for full-line matching |
| **Time Pattern** | Format string for extracting timestamps (e.g. `HH:mm:ss.SSS`) |
| **Keyword Highlight** | Substring matches with independent colors |

---

## Requirements

- VS Code `^1.85.0`

---

## Contributing

```bash
git clone https://github.com/amw18/greplogviewer.git
cd greplogviewer
npm install
npm test        # 165 tests
npx tsc         # compile
# F5 to launch Extension Dev Host
```

---

## License

MIT
