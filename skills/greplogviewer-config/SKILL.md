---
name: greplogviewer-config
description: Configure GrepLogViewer VS Code extension filter groups, keywords, and time patterns for any log format. Use when setting up regex highlighting/folding for log analysis, debugging log files, or when a user wants to filter and colorize large log files.
---

# GrepLogViewer Configuration

Help users configure the GrepLogViewer VS Code extension to filter, colorize, and
fold log files using regex groups and keywords.

## What GrepLogViewer Does

- Matches log lines against regex **groups** (first match wins, colored by group)
- Folds unmatched lines so only relevant lines are visible
- Highlights **keywords** as colored substrings within visible lines
- Parses **time patterns** to show fold duration annotations
- Detects ring-buffer wrap-around (red flag at start line)
- Exports matched lines to a new unsaved editor
- Per-keyword ↑/↓ navigation between hit lines

## Configuration Procedure

### 1. Collect sample log lines

Ask the user to paste 5–10 representative lines. Identify:
- Timestamp format
- Log levels (ERROR, WARN, INFO, etc.)
- Tags / modules / PIDs
- Any structured fields worth extracting

### 2. Define regex groups

Groups are evaluated top-to-bottom; the first matching group wins. Each group
has a color and one or more expressions (combined with AND / OR / NOT).

Common patterns by log type:

**Android logcat** (`MM-DD HH:mm:ss.SSS LEVEL/TAG(PID): msg`):
- Fatal: `FATAL|ASSERT`
- Error: ` E /|ERROR`
- Warn: ` W /|WARN`
- Info: ` I /|INFO`

**Kernel** (`[  s.SSSSSS] msg`):
- Error: `err|ERROR|panic|BUG`
- Warn: `warn|WARNING`
- Info: `info|INFO`

**Generic application logs**:
- Error: `ERROR|FATAL|Exception|Traceback|CRASH`
- Warn: `WARN|WARNING|DEPRECATED`
- Info: `INFO|DEBUG|TRACE`

### 3. Define keywords (optional)

Keywords highlight specific substrings across visible lines. Each keyword has:

| Field | Description |
|-------|-------------|
| `pattern` | Regex pattern (supports named captures `(?<name>...)`) |
| `flags` | e.g. `i` for case-insensitive, `m` for multiline |
| `color` | Hex color (e.g. `#ff6600`) |
| `matchScope` | `matched` = only within group-matched lines; `full` = scan all lines (keyword-only lines stay visible, not folded) |
| `hint` | Optional label shown after the line. Supports `{{name}}` placeholders to reference named capture groups. |

**Named capture hint example**:

Pattern: `(?<pid>\d+)\s+(?<tag>\w+):`
Hint: `pid={{pid}} tag={{tag}}`
Result on line `1234 MyTag: message`: displays `keyword hint: pid=1234 tag=MyTag`

**Practical keyword examples**:

| Use case | Pattern | Flags | Hint |
|----------|---------|-------|------|
| Timeout detection | `timeout\|timed out` | `i` | `timeout` |
| Extract PID | `(?<pid>\d{4,})` | | `pid={{pid}}` |
| ANR detection | `ANR in (?<app>\S+)` | | `ANR: {{app}}` |
| Crash package | `FATAL EXCEPTION.*?at (?<cls>\S+)` | `s` | `{{cls}}` |

Use `matchScope: "full"` sparingly on large files — every matched line stays
unfolded.

### 4. Set time pattern

Leave the Time Fmt field empty to auto-detect. Common explicit formats:

| Log type | Format |
|----------|--------|
| Android logcat | `MM-DD HH:mm:ss.SSS` |
| Android (no ms) | `MM-DD HH:mm:ss` |
| ISO 8601 | `YYYY-MM-DD HH:mm:ss.SSS` |
| Time only | `HH:mm:ss.SSS` |
| Kernel | auto-detected (`[S+]`) |

### 5. Apply and verify

1. Click **Go** — matched lines get colored, unmatched lines fold.
2. Check the match-counts badge (e.g. `12/1000`).
3. Fold annotations show `▼ N lines │ ~duration │ +elapsed`.
4. If nothing matches, test the regex in a JS console first.
5. Use ↑/↓ buttons on each keyword to jump between hits.
6. Click **Export** to copy matched lines to a new unsaved editor.

## How AI Agents Can Auto-Install Configs

Terminal-based AI agents can write config JSON files directly to a shared
directory. The extension automatically scans this directory and lists the
configs in the Advance panel's dropdown - the user just selects and clicks
Apply, no import needed.

**Directory**: `~/.agents/greplogviewer-configs/`

**File name**: `<config-name>.json` (e.g. `android-crash.json`)

**File format**: Same as the Config JSON Structure below.

Example:
```bash
mkdir -p ~/.agents/greplogviewer-configs
cat > ~/.agents/greplogviewer-configs/android-error.json << 'EOF'
{
  "groups": [...],
  "timePattern": { "format": "MM-DD HH:mm:ss.SSS" },
  "keywords": [...]
}
EOF
```

The config appears in the Advance section dropdown as `android-error (file)`.

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
    },
    {
      "id": "g-warn",
      "name": "Warnings",
      "color": "#ffaa00",
      "expressions": [
        { "id": "e2", "pattern": "WARN|WARNING", "flags": "", "operator": "and" }
      ]
    }
  ],
  "timePattern": { "format": "MM-DD HH:mm:ss.SSS" },
  "keywords": [
    {
      "id": "kw-timeout",
      "pattern": "timeout|timed out",
      "flags": "i",
      "color": "#ff6600",
      "enabled": true,
      "matchScope": "full",
      "hint": "timeout"
    },
    {
      "id": "kw-pid",
      "pattern": "(?<pid>\\d{4,})",
      "flags": "",
      "color": "#00aaff",
      "enabled": true,
      "matchScope": "matched",
      "hint": "pid={{pid}}"
    }
  ]
}
```

## Panel Layout

| Section | Controls |
|---------|----------|
| Regex Groups | Add/remove groups and expressions, color per group, flags multi-select |
| Keyword Highlight | Add/remove keywords, ↑/↓ per-keyword hit navigation, hint with `{{capture}}` |
| Advance | Time Fmt, saved configs (Apply / Delete / Save / Export / Import) |
| Action bar | Go \| Clear \| Reset \| Export (matched lines → new editor) |

## Large File Handling

| File size | Behavior |
|-----------|----------|
| < 10万行 | Full features (filter, fold, timeline, dim) |
| 10万–30万行 | Async chunked filter + progress, timeline disabled >20万行 |
| >20MB or >30万行 | Folding skipped (VS Code limit), Export to filtered editor offered |
| >50MB | VS Code refuses to sync file to extensions (hard limit) |

## Pitfalls

- Groups are priority-ordered; put most specific first.
- `matchScope: "full"` keyword lines are never folded — use sparingly.
- Named captures require `(?<name>...)` syntax (JS regex, not Python `(?P<name>...)`).
- `{{name}}` in hint references named capture group `name`; unmatched groups show empty string.
- Files >20 MB or >300 k lines: VS Code disables folding; use **Export**.
- VS Code refuses to sync files >50 MB to extensions (hard limit).
- Time auto-detect samples only the first few lines.
- Switching to another file and back preserves fold state within the same session.
