## Review

### 1. Timeline dynamic height — `ConfigPanel.ts` L604
- **Correct**: `Math.max(80, Math.min(300, keywords.length * 28 + 60))` — verified:
  - 0 keywords → 80px, 2 → 116px, 5 → 200px, 10 → 300px cap
- **Note**: Empty timeline div (`tl-empty`) still rendered when 0 keywords; harmless since it correctly shows "Click Go with Keywords to see timeline"

### 2. Group ↑/↓ navigation
- **Correct**: `gotoGroupHit()` in `ViewController.ts` L1442 — proper null/empty guards (`!editor`, `!results`, `hitLines.length===0`), wrap-around navigation matching `gotoKeywordHit` pattern
- **Correct**: Webview buttons `data-action="groupGotoPrev/groupGotoNext"` with `data-group-id` in `ConfigPanel.ts` L563-564, event handler sends `gotoGroupMatch` message
- **Correct**: `GotoGroupMatchMessage` type extended with `groupId: string` in `types/index.ts` L264
- **Fixed**: Remove stray orphan JSDoc comment "跳转到当前光标位置的下一个/上一个关键字匹配行" that was left above `gotoGroupHit` (commit `9db208a`)

### 3. Right-click menu cleanup — `package.json`
- **Correct**: Removed `gotoPrevHit` and `gotoNextHit` from `menus.editor/context`
- **Correct**: Commands still registered (`commands` array) and in `activationEvents` — keyboard shortcuts bound to these commands (e.g. Ctrl+Up/Down via VS Code keybindings.json) continue to work
- **Correct**: New `gotoGroupHit` command registered and added to activation events

### 4. GrepController fallback — `GrepController.ts` L68-77
- **Correct**: `getSearchPath()` now falls back to `path.dirname(activeEditor.uri.fsPath)` when no workspace folder
- **Correct**: Checks `editor.document.uri.scheme === 'file'` to avoid non-file URIs (untitled, remote)
- **Correct**: Updated warning message to reflect new behavior

### 5. Skill update — `skills/log-config/SKILL.md`
- **Correct**: Added `≤5` groups guideline
- **Correct**: Expanded color palette with high-contrast pairs (red `#ff0000`, bright red `#ff4444`, amber `#ffaa00`, blue `#44aaff`, gray `#888888`, extras green `#00cc66`, purple `#cc44ff`)
- **Correct**: Added warning about similar shades

### MVC check
- No violations. `gotoGroupHit` accesses `FilterResultModel.getResults()` through `ViewController` (the Coordinating Controller), consistent with architecture.

### Type safety
- `npx tsc --noEmit` passes clean. No `any` casts added beyond existing patterns.

### Tests
- All 205 tests pass (26ms). No regressions.