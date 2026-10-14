# Voice Light Mode

Request: fix Jaz's voice dock in light mode, shown with a dark pill and a heavy grey halo (14 October 2026 screenshot, 18:13 BST).

- [x] Use the light background token for the voice pill and transcript, with the dark surface in dark mode.
- [x] Remove the stacked parent drop shadow and use the existing theme-aware elevation.
- [x] Inspect light/dark, docked/floating and transcript states; run required checks, review and commit.

The change uses `bg-bg` in light mode, preserves `bg-surface` in dark mode and reuses `--shadow-raised` for each surface. The floating wrapper's second shadow is removed. Hidden WebKit renders inspected all six theme/layout/transcript variants and confirmed no on-screen test windows. Full backend suite, 326 frontend tests, typecheck and lint pass. One history-worker timeout passed in isolation and on the full rerun; its code was unchanged. Strict review found no further changes needed. The active development server serves the updated classes; packaged release pending.
