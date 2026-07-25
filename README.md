# GrepLogViewer

> Regex-based log viewer for VS Code — color highlighting, auto-folding, keyword timeline, and code grep.

![screenshot](screenshot.png)

## Features

### Regex Group Coloring & Auto-Folding

Define multiple regex groups with colors. Matched lines get full-line highlights; unmatched lines are **auto-folded** so only relevant content stays visible. First-match-wins priority.

### Keyword Substring Highlighting

Substring-level coloring that never clashes with group colors (range subtraction). Supports:
- Named capture groups in pattern (`(?<name>...)`)
- `{{name}}` placeholders in hints to display captured values
- Per-keyword scope: `matched` (within group hits only) or `full` (all lines)
- Per-keyword ↑/↓ navigation buttons

### Time Annotations

Configure a time format (or leave empty for auto-detect: Android logcat, kernel, ISO, etc.). Each folded region displays hidden line count + time span.

### Keyword Timeline

Canvas-based timeline chart embedded in the sidebar. Shows keyword hit distribution over time with:
- Scroll-wheel zoom (canvas-relative coordinates)
- Hover tooltip showing matched substring
- Click to jump to source line
- Auto-resize with polling fallback

### Ring Buffer Detection

Detects wrap-around start in ring-buffer logs and marks it with a red flag icon.

### Right-Click Grep

Select text → right-click → **Grep Keyword** / **Grep Function** → searches associated code directories, output to terminal. Supports `;`-separated dirs, `!` exclusion, `${VAR}` environment variables.

### Export Matched Lines

Click **Export** to copy all matched lines to a new unsaved editor (`<filename>_matched{n}`), useful for large files where folding is disabled.

### Config Sharing

Save named configs, export/import as JSON. AI agents can auto-install configs to `~/.agents/greplogviewer-configs/` — they appear in the Solution dropdown automatically.

### Large File Support

| File size | Behavior |
|-----------|----------|
| < 100k lines | Full features |
| 100k–300k lines | Async chunked filter, timeline disabled >200k |
| >20 MB or >300k lines | Folding skipped, Export offered |
| >50 MB | VS Code hard limit (cannot sync to extensions) |

## Usage

1. Open a log file
2. Configure regex groups and keywords in the sidebar
3. Click **Go**
4. Use ↑/↓ on keywords to navigate hits, scroll-wheel on timeline to zoom

## Installation

Search "GrepLogViewer" in VS Code Extensions, or install from [Marketplace](https://marketplace.visualstudio.com/items?itemName=any-tool.greplogviewer).

## Development

```bash
npm install
npm test          # 204 unit tests
npx tsc --noEmit  # type check
# Press F5 to debug
```

## License

MIT
