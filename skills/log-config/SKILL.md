---
name: log-config
description: Configure Log-- VS Code extension to filter, colorize, and fold log files using regex groups and keywords. Use when a user needs to set up log filtering, highlight errors, extract fields, or analyze structured/unstructured logs.
---

# Log Configuration

Help users configure the Log-- VS Code extension for any log format by defining
regex groups (line-level filtering + color), keywords (substring highlighting),
and time patterns (fold annotations). The extension folds unmatched lines so
only relevant content is visible.

## When to Use

- User wants to filter / colorize log files in VS Code
- User mentions "Log--", "GrepLogViewer", "log filtering", "log highlighting"
- User pastes log samples and asks to extract or highlight patterns
- User wants to navigate between keyword hits or export matched lines

## Procedure

### Step 1: Analyze sample lines

Ask for 5–10 representative log lines. Identify:

| Element | Example | Used for |
|---------|---------|----------|
| Timestamp | `07-21 14:32:01.123` | Time pattern, fold annotations, timeline |
| Log level | `E/`, `ERROR`, `WARNING` | Regex groups |
| Module/tag | `AudioTrack`, `SurfaceFlinger` | Keywords or groups |
| PIDs/TIDs | `(1234)`, `pid=5678` | Keyword extraction with named captures |
| Structured fields | `latency=42ms`, `ret=-1` | Keyword extraction |

### Step 2: Define regex groups

Groups match entire lines by priority (top-to-bottom, first match wins).
Each group has a name, hex color, and one or more regex expressions
combined left-to-right with AND/OR operators.

**Principles:**
- Put more specific / critical groups first (FATAL → ERROR → WARN)
- Use `|` alternation within one expression for equivalent levels
- Use AND across expressions to narrow (e.g. `ERROR` AND `timeout`)
- Single-expression groups cover 90% of use cases

**Color convention:**
- Errors: `#ff4444`, Fatal: `#ff0000`
- Warnings: `#ffaa00`
- Info: `#44aaff`
- Debug/Trace: `#888888`

### Step 3: Define keywords (optional)

Keywords highlight substrings within visible lines without affecting
line-level matching. Each keyword:

| Field | Required | Description |
|-------|----------|-------------|
| `pattern` | yes | JS regex pattern |
| `flags` | no | `i` (case-insensitive), `m` (multiline), `s` (dotall) |
| `color` | yes | Hex color for the matched substring text |
| `matchScope` | no | `matched` = only group-matched lines; `full` = all lines, prevents folding |
| `hint` | no | Label after line; `{{name}}` expands to named capture group `(?<name>...)` |

**Use `matchScope: "full"` only** for critical signals (crashes, timeouts, ANRs) —
every matching line stays visible and unfolded.

### Step 4: Set time pattern

Leave empty for auto-detection (covers ISO 8601, Android, kernel, time-only).
Set explicitly only if auto-detect fails:

| Format string | Matches |
|---------------|---------|
| `YYYY-MM-DD HH:mm:ss.SSS` | `2024-07-21 14:32:01.123` |
| `MM-DD HH:mm:ss.SSS` | `07-21 14:32:01.123` |
| `HH:mm:ss.SSS` | `14:32:01.123` |
| `[*:    s.SSSSSS]` | `[  123.456789]` (kernel) |

### Step 5: Write config and apply

Write the config JSON to `~/.log--/ai/solutions/<name>.json` (the extension
auto-discovers files here). Then tell the user: select from the Solution
dropdown at the top of the panel → click Apply (▶) → Go.

## Config JSON Reference

```json
{
  "groups": [
    {
      "id": "g-error",
      "name": "Errors",
      "color": "#ff4444",
      "expressions": [
        {"id": "e1", "pattern": "ERROR|FATAL|Exception|panic", "flags": "", "operator": "and"}
      ]
    }
  ],
  "timePattern": {"format": "MM-DD HH:mm:ss.SSS"},
  "keywords": [
    {
      "id": "kw-timeout",
      "pattern": "timeout|timed out",
      "flags": "i",
      "color": "#ff6600",
      "enabled": true,
      "matchScope": "full",
      "hint": "TIMEOUT"
    }
  ]
}
```

**Groups** (`groups[]`): priority-ordered line matchers.
- `id`: unique string (prefix `g-`)
- `expressions[]`: combined left-to-right with `operator` (`and`|`or`). First expression's operator is ignored.

**Keywords** (`keywords[]`): substring highlighters.
- `id`: unique string (prefix `kw-`)
- `matchScope`: `matched` (default, only group-matched lines) or `full` (all lines, prevents folding)
- `hint`: `{{name}}` expands to the captured group `(?<name>...)` value

**Config file directory**: `~/.log--/ai/solutions/` — write JSON files here,
they appear in the Solution dropdown at the top of the panel automatically.
Use kebab-case filenames (e.g. `android-crash.json`, `kernel-boot.json`).

## Auto-Install Configs (Agent-Only)

AI agents can programmatically manage configs by writing JSON files to
`~/.log--/ai/solutions/`. The extension scans this directory and lists
found configs in the Advance panel dropdown — no manual import needed.

**Directory**: `~/.log--/ai/solutions/`

**Operations**:
- **Add**: write a new `<name>.json` file
- **Update**: overwrite an existing file
- **Delete**: remove the file (or user clicks ✕ in the Solution row)
- **Target selection**: if user mentions an existing config name, update
  that file; if user says "add a new config", create a new file

**Naming**: kebab-case, descriptive (e.g. `android-crash.json`,
`kernel-boot.json`, `app-timeout.json`). The filename without `.json`
becomes the config name in the Solution dropdown.

**Example — create a config from scratch**:

```bash
mkdir -p ~/.log--/ai/solutions
cat > ~/.log--/ai/solutions/android-error.json << 'EOF'
{
  "groups": [
    {
      "id": "g-error",
      "name": "Errors",
      "color": "#ff4444",
      "expressions": [
        {"id": "e1", "pattern": "ERROR|FATAL|Exception", "flags": "", "operator": "and"}
      ]
    }
  ],
  "timePattern": {"format": "MM-DD HH:mm:ss.SSS"},
  "keywords": []
}
EOF
```

After writing, tell the user: in the panel, select the config from the
Solution dropdown at the top, click Apply (▶), then Go.

## Large File Handling

| Threshold | Strategy |
|-----------|----------|
| <10万 lines | Full features: filter, fold, dim, timeline |
| 10万–30万 lines | Async chunked filter; timeline disabled >20万 lines |
| >20MB or >30万 lines | Go shows prompt → click button to grep-export matched lines to a temp file, then full features on the smaller file |
| >50MB | VS Code refuses extension access (hard platform limit) |

## Pitfalls

- Groups are **priority-ordered** — FATAL must be above ERROR, etc.
- `matchScope: "full"` keyword lines **never fold** — use for critical signals only.
- Named captures use `(?<name>...)` (JS regex), not `(?P<name>...)` (Python).
- Files >20MB or >30万 lines: Go prompts for grep export instead of inline filtering.
- Time auto-detect samples first 20 lines only.
- Switching files within a session preserves fold state.
