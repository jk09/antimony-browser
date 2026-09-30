import type { PageControls } from '../../navigation/main'
import { scriptSource } from '../shared/page-scripts'
import { ToolError, type BrowserPort, type PageKey } from './tools'

/** Isolated world for the agent's page scripts: the page's own scripts can't see or alter them. */
const WORLD_ID = 1001

const keyCodes: Record<PageKey, string> = {
  Enter: 'Enter',
  Tab: 'Tab',
  Escape: 'Escape',
  Backspace: 'Backspace',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Home: 'Home',
  End: 'End',
  Space: 'Space',
}
// Keys that also produce a character event (Enter submits forms through it).
const charKeys = new Set<PageKey>(['Enter', 'Space', 'Tab'])

/** The agent's view of the navigation page view: trusted input events and isolated-world scripts. */
export function pageBrowser(page: PageControls): BrowserPort {
  const contents = () => {
    const current = page.contents()
    if (!current) throw new ToolError('No page is loaded. Use navigate first.')
    return current
  }
  return {
    state: () => page.state(),
    load: (url) => page.load(url),
    back: () => page.back(),
    forward: () => page.forward(),
    reload: () => page.reload(),
    stop: () => page.stop(),
    waitForLoad: (timeoutMs) => page.waitForLoad(timeoutMs),
    hasPage: () => page.contents() !== null,
    run: (script, args) =>
      contents().executeJavaScriptInIsolatedWorld(WORLD_ID, [{ code: scriptSource(script, args) }]),
    async capture() {
      const image = await contents().capturePage()
      const { width } = image.getSize()
      const scaled = width > 1280 ? image.resize({ width: 1280 }) : image
      const thumbnail = image.resize({ width: Math.min(width, 320) })
      return {
        data: scaled.toJPEG(80).toString('base64'),
        thumbnail: `data:image/jpeg;base64,${thumbnail.toJPEG(70).toString('base64')}`,
      }
    },
    async click(x, y) {
      const target = contents()
      target.sendInputEvent({ type: 'mouseMove', x, y })
      target.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
      target.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
    },
    async insertText(text) {
      await contents().insertText(text)
    },
    async pressKey(key) {
      const target = contents()
      target.focus()
      const keyCode = keyCodes[key]
      target.sendInputEvent({ type: 'keyDown', keyCode })
      if (charKeys.has(key)) target.sendInputEvent({ type: 'char', keyCode })
      target.sendInputEvent({ type: 'keyUp', keyCode })
    },
  }
}
