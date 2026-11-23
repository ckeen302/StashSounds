# Request 103 When ownItem.checkFields marks BPM, key and root note
From lane: platform
For: lead
Blocking ticket: none

## What I need decided
build-spec says detected BPM and key are marked "check this" when the sources disagreed.

1. **Thresholds.**
   - BPM has `detection.bpmAgreed`.
   - Key has only `keyConfidence` (0 to 1), and limits has no threshold for it. Proposed: `limits.detection.keyConfidenceMin` (0.15 for now), applied when keySource is chroma.
   - Root note has no confidence. Proposed: marked when rootNoteSource is pitch_tracking.
2. **The uploader's corrections.** After the uploader corrects BPM or key with updateItem, the field should stop being marked. `details` is not a granted column, so the correction cannot be recorded as `bpmSource: "uploader"`. Proposed, either:
   - a `set_item_detection(item, fields)` security definer function, or
   - a trigger that sets the sources to "uploader" when the owner changes bpm, key_root or key_mode.

## Provisional choice in 103
`checkFields` in items/rows.ts marks:
- bpm when bpmAgreed is false and bpmSource is neither filename nor uploader;
- key when keySource is chroma and keyConfidence is below 0.15 (constant `KEY_CONFIDENCE_MIN`);
- rootNote when rootNoteSource is pitch_tracking.

The marks stay after a correction until (2) lands.
