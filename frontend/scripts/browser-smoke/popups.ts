import type { SideBrowser } from '@/lib/sideBrowser'

export async function exercisePopupNavigation(browser: SideBrowser, evaluate: (expression: string) => Promise<unknown>): Promise<void> {
  const original = await evaluate('location.href')
  const url = location.origin + '/popup-login'
  const point = await evaluate(`(() => {
    const link = document.createElement('a')
    link.href = '/popup-login'
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.textContent = 'Sign in'
    link.style.cssText = 'position:fixed;top:10px;left:10px;padding:16px;z-index:1000'
    document.body.append(link)
    const rect = link.getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  })()`) as { x: number; y: number }
  await browser.call({ method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', ...point, button: 'left', clickCount: 1 } })
  await browser.call({ method: 'Input.dispatchMouseEvent', params: { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 } })
  const deadline = Date.now() + 3000
  while (!(await window.smoke.openedURLs()).includes(url)) {
    if (Date.now() > deadline) {
      throw new Error('Sign in new-tab link never reached the browser-opening handler')
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  if (await evaluate('location.href') !== original) {
    throw new Error('A new-tab link replaced the current preview')
  }
  await evaluate('document.querySelector(\'a[href="/popup-login"]\').remove()')
}
