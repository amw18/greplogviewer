---
name: greplogviewer-config
description: Configure GrepLogViewer VS Code extension filter groups, keywords, and time patterns for any log format. Use when setting up regex highlighting/folding for log analysis, or when a user wants to filter and colorize log files.
---

# GrepLogViewer Configuration

Help users configure the GrepLogViewer VS Code extension to filter, colorize, and
fold log files using regex groups and keywords.

## What GrepLogViewer Does

GrepLogViewer is a VS Code extension that:
- Matches log lines against regex **groups** (first match wins, colored by group)
- Folds unmatched lines so only relevant lines are visible
- Highlights **keywords** as colored substrings within visible lines
- Parses **time patterns** to show fold duration annotations
- Detects ring-buffer wrap-around (red flag at start line)

## Configuration Procedure

### 1. Collect sample log lines

Ask the user to paste 5–10 representative lines. Identify:
- Timestamp format
- Log levels (ERROR, WARN, INFO, etc.)
- Tags / modules / PIDs

### 2. Define regex groups

Groups are evaluated top-to-bottom; the first matching group wins. Each group
has a color and one or more expressions (combined with AND / OR / NOT).

Common patterns by log type:

**Android logcat** (`MM-DD HH:mm:ss.SSS LEVEL/TAG: msg`):
- Fatal: `FATAL|ASSERT`
- Error: ` E /|ERROR`
- Warn: ` W /|WARN`

**Kernel** (`[  s.SSSSSS] msg`):
- Error: `err|ERROR|panic|BUG`
- Warn: `warn|WARNING`

**Generic application logs**:
- Error: `ERROR|FATAL|Exception|Traceback|CRASH`
- Warn: `WARN|WARNING|DEPRECATED`

### 3. Define keywords (optional)

Keywords highlight specific substrings across visible lines. Each keyword has:
- `pattern`: regex
- `flags`: e.g. `i` for case-insensitive
- `color`: hex color
- `matchScope`:
  - `matched` — only highlight within group-matched lines
  - `full` — scan all lines; keyword-only lines stay visible and are **not folded**
- `hint`: optional label shown after the line (e.g. "timeout")

Use `matchScope: "full"` sparingly on large files — every matched line stays
unfolded.

### 4. Set time pattern

Leave the Time Fmt field empty to auto-detect. Common explicit formats:

| Log type | Format |
|----------|--------|
| Android logcat | `MM-DD HH:mm:ss.SSS` |
| Android (no ms) | `MM-DD HH:mm:ss` |
| ISO 8601 | `YYYY-MM-DD HH:mm:ss.SSS` |
| Kernel | auto-detected (`[S+]`) |

### 5. Apply and verify

1. Click **Go** — matched lines get colored, unmatched lines fold.
2. Check the match-counts badge (e.g. `12/1000`).
3. Fold annotations show `▼ N lines │ ~duration │ +elapsed`.
4. If nothing matches, test the regex in a JS console first.

## Config JSON Structure

Configs can be exported / imported as JSON:

```json
{
  "groups": [
    {
      "id": "g-error",
      "name": "Errors",
      "color": "#ff0000",
      "expressions": [
        { "id": "e1", "pattern": "ERROR|FATAL", "flags": "", "operator": "and" }
      ]
    }
  ],
  "timePattern": { "format": "YYYY-MM-DD HH:mm:ss.SSS" },
  "keywords": [
    {
      "id": "kw1",
      "pattern": "timeout",
      "flags": "i",
      "color": "#ff6600",
      "enabled": true,
      "matchScope": "full",
      "hint": "timeout"
    }
  ]
}
```

## Panel Layout

| Section | Controls |
|---------|----------|
| Regex Groups | Add/remove groups and expressions, color per group |
| Keyword Highlight | Add/remove keywords, ↑/↓ per-keyword hit navigation |
| Advance | Time Fmt, saved configs (Apply / Delete / Save / Export / Import) |
| Action bar | Go \| Clear \| Reset \| Export (matched lines → new editor) |

## Pitfalls

- Groups are priority-ordered; put most specific first.
- `matchScope: "full"` keyword lines are never folded — use sparingly.
- Files >20 MB or >300 k lines: VS Code disables folding; use **Export** to get a
  smaller filtered editor.
- VS Code refuses to sync files >50 MB to extensions (hard limit).
- Time auto-detect samples only the first few lines.
