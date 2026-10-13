# Canvas Resize and Overflow

- [x] Make resizing reliable at corners and edges, including when zoomed out.
- [x] Show usable vertical and horizontal scrollbars for overflowing content.
- [x] Remove duplicate filename footers and retain viewer controls.
- [x] Guide agents to fit readable content without scrolling where practical.
- [x] Finish verification and strict code review.

Resize controls sit above content, with edge hit areas outside the card so scrollbar thumbs remain accessible. Readable documents accept pointer input; viewers requiring Focus keep that boundary. Filenames remain above cards, and viewer controls float in the top corner. The authoring guidance asks for content-sized cards, concise overviews and useful sections for long reports, and scrolling where needed.

The normal hidden Electron smoke suite covers the production ThreadCanvas: four resize corners at two zoom levels, edges, vertical scrolling in Markdown/CSV/notes, horizontal CSV scrolling, filename footer removal, Focus/Escape, and title dragging. Disabling the corner hit areas or blocking document input fails the corresponding regression.

Verified: 326 frontend tests, full backend tests on Go 1.26, typecheck, lint, the desktop bundle, the focused canvas smoke and the full hidden Electron browser suite. Rendered captures show usable scrollbars and no filename footer. Strict review found no remaining blockers. The fix stays on the task branch for merge/release.
