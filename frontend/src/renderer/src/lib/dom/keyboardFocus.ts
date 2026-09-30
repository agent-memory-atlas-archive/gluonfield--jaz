// Focus styling follows Tab navigation only. Chromium also marks a clicked
// element :focus-visible as soon as any plain key is pressed, which painted
// focus rings on rows nobody tabbed to. Focus moved while a Tab press is
// handled turns keyboard focus on for the document; a pointer press turns it
// off.
export function installKeyboardFocus() {
  const root = document.documentElement
  let tabbing = false
  window.addEventListener(
    'keydown',
    (event) => {
      tabbing = event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey
      setTimeout(() => {
        tabbing = false
      })
    },
    true,
  )
  window.addEventListener(
    'focusin',
    () => {
      if (tabbing) {
        root.dataset.keyboardFocus = ''
      }
    },
    true,
  )
  window.addEventListener(
    'pointerdown',
    () => {
      delete root.dataset.keyboardFocus
    },
    true,
  )
}

export function hasKeyboardFocus(element: Element): boolean {
  return element.matches('[data-keyboard-focus] :focus-visible')
}
