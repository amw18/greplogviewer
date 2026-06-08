# GrepLogViewer

> Regex-based log viewer — color highlighting, auto-folding, and keyword timeline

<p align="center">
  <img src="screenshot.png" alt="screenshot" width="800">
</p>

---

## Usage

1. Open any text/log file
2. Configure rules in the **GrepLogViewer** sidebar panel
3. Click **Go** to apply

All effects are triggered by the Go button — switching editors or changing config does not auto-apply.

---

## Features

### Regex Group Coloring & Auto-Folding

Assign colors to regex groups. Matched lines get full-line highlights. Unmatched lines are **auto-folded** — only relevant content stays visible.

### Keyword Substring Highlighting

Substring-level coloring that never clashes with group colors (range subtraction).

### Fold Time Annotations

With a time pattern configured, each folded region displays hidden line count + time span.

### Keyword Timeline

Bottom-panel time axis chart showing keyword hit distribution over time:
- One row per keyword, color-coded dots
- Hover for precise time + line number, click to jump
- Mouse wheel zoom centered on cursor

### Right-Click Grep

Select text → right-click → **Grep Keyword** / **Grep Function** → searches associated code directories, output to terminal.

Supports `;`-separated dirs, `!` exclusion, `${VAR}` environment variables.

### Config Management

Named presets (User / Workspace), JSON import/export.

## Use Cases

- **Log debugging**: filter ERROR/WARN lines, collapse noise, jump to code
- **Trace analysis**: correlate timestamps across keyword occurrences with the timeline
- **Code auditing**: grep keywords or function definitions across code directories from any file

---

## License

MIT
