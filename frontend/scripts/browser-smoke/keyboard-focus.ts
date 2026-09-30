import { installKeyboardFocus } from '@/lib/dom/keyboardFocus'

export async function exerciseKeyboardFocus(): Promise<void> {
  installKeyboardFocus()
  const element = document.createElement('div')
  element.style.cssText = 'position:fixed;inset:0;z-index:1;display:flex;align-items:start;gap:24px;padding:24px;background:var(--color-bg)'
  element.innerHTML = '<button type="button">First</button><button type="button">Second</button>'
  document.body.append(element)
  const [first, second] = element.querySelectorAll('button')
  const ring = (target: Element) => getComputedStyle(target).outlineStyle !== 'none'
  const press = async (x: number, y: number) => {
    await window.smoke.pointer('mouseMove', x, y)
    await window.smoke.pointer('mouseDown', x, y)
    await window.smoke.pointer('mouseUp', x, y)
  }
  const bounds = first.getBoundingClientRect()
  await press(Math.round(bounds.x + bounds.width / 2), Math.round(bounds.y + bounds.height / 2))
  await window.smoke.key('a')
  if (document.activeElement !== first || !first.matches(':focus-visible')) {
    throw new Error('Chromium no longer marks a clicked button :focus-visible after a key press')
  }
  if (ring(first)) {
    throw new Error('A clicked button shows a focus ring after a key press')
  }
  const claimTab = (event: KeyboardEvent) => {
    event.preventDefault()
  }
  window.addEventListener('keydown', claimTab)
  await window.smoke.key('Tab', ['shift'])
  window.removeEventListener('keydown', claimTab)
  if (document.activeElement !== first || ring(first)) {
    throw new Error('A Tab shortcut that keeps focus in place turned focus rings on')
  }
  await window.smoke.key('Tab')
  if (document.activeElement !== second || !ring(second)) {
    throw new Error('Tab navigation shows no focus ring')
  }
  await press(Math.round(bounds.x + bounds.width / 2), Math.round(bounds.bottom + 80))
  if ('keyboardFocus' in document.documentElement.dataset) {
    throw new Error('A pointer press left keyboard focus rings on')
  }
  element.remove()
}
