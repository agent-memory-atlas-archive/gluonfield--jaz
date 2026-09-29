// A caller that is itself inside a dialog passes how many it expects to be open.
export function modalDialogOpen(expected = 0): boolean {
  return document.querySelectorAll('[role="dialog"][aria-modal="true"]').length > expected
}
