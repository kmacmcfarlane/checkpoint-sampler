# Aspect 6: Frontend code quality (Vue/TS)

Lint: 0 errors 3 warnings; vue-tsc clean.

- **[medium]** [error states] `frontend/src/App.vue:753-787` — stopJob/resumeJob/retryFailedJob/deleteJob swallow API errors with console.warn only; no toast layer anywhere (useMessage unused). User clicks appear ignored on failure. Fix: toast/error ref.
- **[medium]** [error states] `frontend/src/components/JobLaunchDialog.vue:1061-1064,1124-1125,1149-1151` — initial fetches reset lists to [] on failure w/ empty catch; empty dropdowns indistinguishable from "none exist", no retry. Fix: error ref + inline alert with retry.
- **[medium]** [a11y] `frontend/src/components/XYGrid.vue:284-296,314-326` — clickable header divs: no tabindex/role/keydown. Fix: button semantics.
- **[medium]** [a11y] `frontend/src/components/ImageCell.vue:66-79` — no Enter/Space to open lightbox; tabindex only when sliderValues exist. Fix: always tabindex=0 on non-empty cells + Enter/Space.
- **[medium]** [component size] JobLaunchDialog.vue (2029 lines), StudyEditor.vue (1808), App.vue (1318), JobProgressPanel.vue (1252) — mixing fetch/persistence/validation/template. Fix: extract composables/stores (useJobProgress pattern exists).
- **[low]** [dead code] `frontend/src/components/ComboFilter.vue` — unused, superseded by DimensionFilter/FiltersDrawer. Delete + test.
- **[low]** [Pinia] `App.vue:303,319-323,414-416` + `composables/useWebSocket.ts:62-67` — comboSelections mutated in-place outside store; forced comboSignature() workaround in useImagePreloader.ts:231-236; App.vue:303 captures object identity (stale after $reset). Fix: store actions.
- **[low]** [memory] `composables/useJobProgress.ts:96,182` — jobProgress entries never deleted on terminal status (unlike inferenceProgress). Fix: delete on terminal.
- **[low]** [URL encoding] `api/client.ts:140` — getImageMetadata interpolates filepath unencoded; image URLs likewise. Filenames with #/?/% break. Fix: encode per-segment.
- **[low]** [duplication] `api/client.ts:144-174,245-258,318-348` — fetch boilerplate hand-rolled 5x for void endpoints. Fix: requestVoid() helper.
- **[low]** [performance] `composables/useImagePreloader.ts:209-218` — final pass preloads every scan image; no abort on scope dispose. Fix: onScopeDispose abort + cap.
- **[low]** [lint] `ImageLightbox.vue:34` — require-default-prop warning; 2 one-component-per-file warnings in useCountdown.test.ts.

**Verdict:** Well-maintained frontend — zero any/@ts-ignore, clean vue-tsc, disciplined WS client. Gaps are UX-facing: silent API failures (no toast layer), incomplete keyboard a11y, four 1200-2000 line components.
