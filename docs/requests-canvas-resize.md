# Canvas Resize and Overflow

- [x] Make resizing reliable at corners and edges, including when zoomed out.
- [x] Show usable vertical and horizontal scrollbars for overflowing content.
- [x] Remove duplicate filename footers and retain viewer controls.
- [x] Guide agents to fit readable content without scrolling where practical.
- [x] Finish verification and strict code review.
- [x] Verify and commit the follow-up review corrections.

Resize controls sit above content, with edge hit areas outside the card so scrollbar thumbs remain accessible. Readable documents accept pointer input; viewers requiring Focus keep that boundary. Filenames remain above cards, and viewer controls float in the top corner. The authoring guidance asks for content-sized cards, concise overviews and useful sections for long reports, and scrolling where needed.

The normal hidden Electron smoke suite covers the production ThreadCanvas: four resize corners at two zoom levels, edges, vertical scrolling in Markdown/CSV/notes, horizontal CSV scrolling, filename footer removal, Focus/Escape, and title dragging. Disabling the corner hit areas or blocking document input fails the corresponding regression.

Follow-up review found four regressions and corrected them at their owners:

- Hand mode now disables item content input so the board can pan across documents.
- Viewer status remains visible without hover or selection, including CAD load errors.
- Note update highlights sit outside scrolling content and retain the note's rounded corners.
- Clipboard handling yields to a native text selection; copying canvas items still works when the text selection is cleared.

The normal canvas smoke reproduces each failure through the real renderer. Its clipboard checks dispatch DOM clipboard events without touching the system clipboard. Final verification passed: 326 frontend tests, full Go 1.26 backend tests, typecheck, lint, desktop build, focused canvas checks, and the full hidden Electron browser suite. No review blockers remain; the branch awaits merge/release.
