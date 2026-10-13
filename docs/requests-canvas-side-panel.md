# Canvas Side Panel

- [x] Allow Canvas threads to open the existing right-side panel, including Browser and other existing tabs.
- [x] Preserve usable canvas space beside the chat and browser.
- [x] Verify real page navigation and close/reopen on desktop and mobile with the production ThreadView.
- [x] Run full checks, review and commit.

| Before | After |
| --- | --- |
| Canvas hid the titlebar panel controls and omitted the panel drawer. | Remove both guards and the unused `panelControls` prop; Canvas uses the existing panel and tab system. |
| Panel sizing reserved room only for chat. | Measure the canvas/panel region separately so the existing minimum-content rule reserves space for the board. Mobile retains the full-width overlay. |
| The native thread fixture only checked composer settings. | It also loads a real page in Canvas Browser, preserves the board and browser while closing/reopening, and exercises the mobile controls with native input. |

Verification: 326 frontend tests, typecheck, lint, build and native desktop/mobile checks pass. Screenshots were inspected. The on-screen sampler observed zero new visible Electron/Jaz windows. The full backend suite passes.

- [x] Restore pinch zoom while hovering over canvas content.
- [x] Fit canvas content without internal scrollbars, preserving card positions and sizes.

The fitting request supersedes the earlier scrollbar behavior. Notes, Markdown and CSV use one content-fit boundary. Sandboxed cards fit their document and pass wheel gestures back to the owning canvas. Authoring guidance requires readable content sized to its card.

The native check covers fitted card clicks, updates and resizing, plus pinch gestures over ordinary content and inside active sandboxed frames. Restoring the previous wheel marker in an isolated control reproduces the reported failure. Full backend and frontend checks pass.
