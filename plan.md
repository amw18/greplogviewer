# Implementation Plan — Ring Buffer Start Detection & Red Flag Folding

## Goal
Add ring-buffer log start detection, a red flag gutter icon at the detected start line, clickable 3-state folding on that line, and remove the existing Line Ranges configuration.

## Files to Modify

| File | What to change |
|------|----------------|
| `src/model/TimeMatchModel.ts` | Add `detectRingBufferStartLine(lines)` method. |
| `src/model/RingBufferModel.ts` | **New** — store detected start line per editor. |
| `src/model/StartLineFoldModel.ts` | **New** — 3-state fold state machine per editor. |
| `src/model/EditorStateModel.ts` | Remove `lineRangeMap` and line-range methods; load/save simplified `EditorConfig`. |
| `src/view/EditorDecorations.ts` | Add red flag gutter decoration (`showRingBufferFlag` / `clearRingBufferFlag`). |
| `src/controller/ViewController.ts` | Detect start line on Go; render flag; handle selection change for click-cycle; remove all line-range fields/logic. |
| `src/controller/FilterController.ts` | Remove `startPattern`/`endPattern` params and `findFirstMatchLine`; filter full document. |
| `src/view/ConfigPanel.ts` | Remove Line Ranges UI and callbacks; simplify all message signatures. |
| `src/types/index.ts` | Delete `NamedRange`; simplify `EditorConfig`. |
| `src/extension.ts` | Register `greplogviewer.toggleStartLineFold` command; pass new models to ViewController; update FoldingRangeProvider to merge ring-buffer fold ranges. |
| `package.json` | Add `onCommand:greplogviewer.toggleStartLineFold`. |
| `assets/flag-red.svg` | **New** — red flag SVG for gutter icon. |

## New Files
- `src/model/RingBufferModel.ts`
- `src/model/StartLineFoldModel.ts`
- `assets/flag-red.svg`

## Dependencies
1. `TimeMatchModel.detectRingBufferStartLine` must be implemented before `ViewController` can use it.
2. `RingBufferModel` and `StartLineFoldModel` must be created and passed into `ViewController`/`extension.ts` before folding integration.
3. Line Ranges removal should be done before or alongside the new feature to avoid conflicting signatures.
4. FoldingRangeProvider update depends on both `RingBufferModel` and `StartLineFoldModel`.

## Risks & Open Questions
1. **No native clickable gutter icon**: VS Code only supports non-clickable gutter icons. We will detect line selection changes as a proxy. This means clicking anywhere on the start line toggles the fold, not just the icon. Need to document this limitation.
2. **Line Ranges removal breaks backward compatibility**: Old saved configs containing `startPattern`/`endPattern`/`namedRanges` will be loaded but ignored. This is acceptable per requirement D.
3. **Ring buffer detection accuracy**: The algorithm assumes a single time wrap-around. Logs with non-monotonic timestamps for other reasons may produce false positives. We accept this trade-off for the simple "first negative relative time" heuristic.
4. **Persistence**: Start line and fold state are runtime-only and reset on each Go. This avoids stale state when files are edited. Document this behavior.
5. **Tests**: Need autotest coverage for ring buffer detection, red flag decoration, and click-cycle folding. Also verify Line Ranges UI is fully removed.

## Suggested Execution Order
1. Update types (`src/types/index.ts`) and remove `NamedRange`.
2. Remove Line Ranges from `EditorStateModel`, `FilterController`, `ConfigPanel`, `ViewController`.
3. Add `RingBufferModel`, `StartLineFoldModel`, and `TimeMatchModel.detectRingBufferStartLine`.
4. Add red flag SVG and `EditorDecorations` support.
5. Wire models into `ViewController` and `extension.ts`; implement selection-change toggle.
6. Update `FoldingRangeProvider` to merge ring-buffer ranges.
7. Add tests and documentation updates.
8. Run `npx tsc --noEmit`, `npm test`, and autotest regression suite.
