# GrepLogViewer Config Skill

Help AI agents automatically configure GrepLogViewer's filter groups, keywords,
and time patterns for any log format.

## When to Use

Use this skill when a user wants to:
- Set up regex filter groups to highlight and fold log lines
- Configure keyword highlighting
- Detect time patterns for fold duration annotations
- Analyze a new log format they haven't used before

## How GrepLogViewer Works

GrepLogViewer is a VS Code extension that filters log files using regex groups.
Clicking **Go** applies the filter: matched lines get colored, unmatched lines
get folded. Keywords add sub-string highlights on top of group colors.

### Key Concepts

1. **Regex Group**: A named group with one or more expressions. First matching
   group wins (priority by order). Each group has a color.
2. **Expression**: A regex pattern + flags + logic operator (AND/OR/NOT).
3. **Keyword**: A regex that highlights matching substrings. `matchScope`:
   - `matched`: only highlight within group-matched lines
   - `full`: highlight in all lines (keyword-only lines stay visible, not folded)
4. **Time Pattern**: A format string like `YYYY-MM-DD HH:mm:ss.SSS` for
   timestamp parsing. Leave empty to auto-detect (Android, kernel, ISO, etc.).
5. **Ring Buffer**: Detects wrap-around start in ring-buffer logs (red flag icon).

## Configuration Procedure

### Step 1: Identify the log format

Ask the user to paste 5-10 sample lines. Identify:
- Timestamp format (if any)
- Common log levels (ERROR, WARN, INFO, etc.)
- PID/TID patterns
- Tag/module patterns

### Step 2: Define regex groups

Create groups in priority order. Common patterns:

```
# Android logcat: MM-DD HH:mm:ss.SSS LEVEL/TAG: message
Group "Fatal":   pattern "FATAL|ASSERT"
Group "Error":   pattern " E |ERROR"
Group "Warn":    pattern " W |WARN"
Group "Info":    pattern " I |INFO"

# Kernel log: [  s.SSSSSS] message
Group "Error":   pattern "err|ERROR|panic"
Group "Warn":    pattern "warn|WARNING"

# Generic
Group "Error":   pattern "ERROR|FATAL|Exception|Traceback"
Group "Warn":    pattern "WARN|WARNING"
```

### Step 3: Define keywords (optional)

Keywords highlight specific terms across all visible lines:

```json
{
  "id": "kw1",
  "pattern": "timeout|timed out",
  "flags": "i",
  "color": "#ff6600",
  "enabled": true,
  "matchScope": "full",
  "hint": "timeout"
}
```

- Use `matchScope: "full"` for keywords that should keep unmatched lines visible.
- Use `matchScope: "matched"` for keywords that only matter within group hits.

### Step 4: Set time pattern

Common formats:
- Android: `MM-DD HH:mm:ss.SSS`
- Android (no ms): `MM-DD HH:mm:ss`
- ISO: `YYYY-MM-DD HH:mm:ss.SSS`
- Kernel: `[S+]` (auto-detected)
- Leave empty for auto-detection.

### Step 5: Export config JSON

The config can be exported/imported as JSON:

```json
{
  "groups": [
    {
      "id": "g1",
      "name": "Errors",
      "color": "#ff0000",
      "expressions": [
        { "id": "e1", "pattern": "ERROR|FATAL", "flags": "", "operator": "and" }
      ]
    }
  ],
  "timePattern": { "format": "YYYY-MM-DD HH:mm:ss.SSS" },
  "keywords": []
}
```

## Config Panel Layout

- **Regex Groups** section: add/remove groups and expressions
- **Keyword Highlight** section: add/remove keywords with ↑/↓ navigation
- **Advance** section: Time Fmt, saved configs (Apply/Delete/Save/Export/Import)
- **Action bar**: Go | Clear | Reset | Export (exports matched lines to new editor)

## Pitfalls

- Groups are evaluated in order; first match wins. Put most specific first.
- Keyword `matchScope: "full"` lines are never folded — use sparingly on large files.
- Time pattern auto-detect samples only the first few lines.
- Files >20MB or >300k lines: VS Code disables folding; use Export to filtered editor.
- VS Code refuses to sync files >50MB to extensions (hard limit).

## Verification

After configuring:
1. Click **Go** — matched lines should be colored, unmatched folded.
2. Check match counts badge (e.g., `5/100`).
3. Fold annotations show line count + duration.
4. If no matches, verify regex with `RegExp` test.
