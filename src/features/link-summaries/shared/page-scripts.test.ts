// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { markLinks, scanLinks, scriptSource, unmarkLinks } from './page-scripts'

const limits = { minText: 100, maxLinks: 10, maxTargets: 3 }
const paragraph = 'Readers do not block writers and writers do not block readers. '.repeat(3)

function article(links: string, extra = '') {
  document.body.innerHTML = `
    <header><a href="/home">Home</a></header>
    <nav><a href="/nav">Nav</a></nav>
    <article><h1>WAL</h1><p>${paragraph}</p><p>${links}</p>${extra}</article>
    <footer><a href="/legal">Legal</a></footer>`
}

beforeEach(() => {
  history.replaceState(null, '', '/notes/wal#top')
})
afterEach(() => {
  unmarkLinks()
  vi.restoreAllMocks()
})

describe('scanLinks', () => {
  it('collects distinct web targets of the main text in order, without fragments', () => {
    article(`
      <a href="https://example.com/a#x">A</a>
      <a href="https://example.com/a#y">A again</a>
      <a href="#top">Self</a>
      <a href="/notes/wal">Self too</a>
      <a href="mailto:x@example.com">Mail</a>
      <a href="/file.pdf">PDF</a>
      <a href="/b" download>Download</a>
      <a href="/c">C</a>
      <aside><a href="/aside">Aside</a></aside>
      <a href="https://other.example/d">D</a>
      <a href="https://other.example/e">E (over the limit)</a>`)
    expect(scanLinks(limits)).toEqual({
      url: 'http://localhost:3000/notes/wal',
      simple: true,
      targets: ['https://example.com/a', 'http://localhost:3000/c', 'https://other.example/d'],
    })
  })

  it('treats short pages, pages with password or card fields and link lists as not simple', () => {
    document.body.innerHTML = '<p>Too short.</p><a href="/a">A</a>'
    expect(scanLinks(limits)).toMatchObject({ simple: false, targets: [] })
    article('<a href="/a">A</a>', '<input type="password">')
    expect(scanLinks(limits).simple).toBe(false)
    article('<a href="/a">A</a>', '<input autocomplete="cc-number">')
    expect(scanLinks(limits).simple).toBe(false)
    article(Array.from({ length: 11 }, (_, i) => `<a href="/l${i}">L</a>`).join(' '))
    expect(scanLinks(limits).simple).toBe(false)
    article('<a href="/a">A</a>')
    expect(scanLinks(limits).simple).toBe(true)
  })

  it('falls back to the body when there is no article or main', () => {
    document.body.innerHTML = `<p>${paragraph}</p><nav><a href="/nav">Nav</a></nav><a href="/x">X</a>`
    expect(scanLinks(limits).targets).toEqual(['http://localhost:3000/x'])
  })
})

describe('markLinks', () => {
  let shadow: ShadowRoot
  beforeEach(() => {
    const attach = HTMLElement.prototype.attachShadow
    vi.spyOn(HTMLElement.prototype, 'attachShadow').mockImplementation(function (
      this: HTMLElement,
      init,
    ) {
      shadow = attach.call(this, init)
      return shadow
    })
    vi.useFakeTimers()
    article(
      '<a href="https://example.com/a">A</a> <a href="https://example.com/a#part">A2</a> <a href="/c">C</a>',
    )
  })
  afterEach(() => vi.useRealTimers())

  const summaries = [{ url: 'https://example.com/a', title: 'Page A', summary: 'All about A.' }]
  const link = (name: string) =>
    Array.from(document.querySelectorAll('a')).find((a) => a.textContent === name)!
  const tooltip = () => shadow.querySelector('[role="tooltip"]') as HTMLElement

  it('marks every link to a summarised target and keeps the summary in a closed shadow root', () => {
    expect(markLinks({ summaries, delayMs: 300 })).toBe(2)
    expect(link('A').hasAttribute('data-antimony-summary')).toBe(true)
    expect(link('A2').hasAttribute('data-antimony-summary')).toBe(true)
    expect(link('C').hasAttribute('data-antimony-summary')).toBe(false)
    expect(document.querySelector('style[data-antimony-link-summaries]')).toBeTruthy()
    const host = document.querySelector('div[data-antimony-link-summaries]')!
    expect(host.shadowRoot).toBeNull()
    expect(document.documentElement.textContent).not.toContain('All about A.')
    // Calling again adds summaries without a second tooltip.
    markLinks({
      summaries: [{ url: 'http://localhost:3000/c', title: 'C', summary: 'See C.' }],
      delayMs: 300,
    })
    expect(link('C').hasAttribute('data-antimony-summary')).toBe(true)
    expect(document.querySelectorAll('div[data-antimony-link-summaries]')).toHaveLength(1)
  })

  it('shows the tooltip after a hover delay and on focus, and hides it on leave and Escape', () => {
    markLinks({ summaries, delayMs: 300 })
    link('A').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(tooltip().hidden).toBe(true)
    vi.advanceTimersByTime(300)
    expect(tooltip().hidden).toBe(false)
    expect(tooltip().textContent).toContain('Page A')
    expect(tooltip().textContent).toContain('All about A.')
    expect(tooltip().textContent).toContain('example.com')
    link('A').dispatchEvent(
      new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }),
    )
    expect(tooltip().hidden).toBe(true)

    link('A2').dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(tooltip().hidden).toBe(false)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(tooltip().hidden).toBe(true)
    // Unmarked links show nothing.
    link('C').dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(tooltip().hidden).toBe(true)
  })

  it('unmarkLinks removes the marks, the stylesheet, the tooltip and the listeners', () => {
    markLinks({ summaries, delayMs: 300 })
    const tip = tooltip()
    unmarkLinks()
    expect(document.querySelector('[data-antimony-summary]')).toBeNull()
    expect(document.querySelector('[data-antimony-link-summaries]')).toBeNull()
    link('A').dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(tip.hidden).toBe(true)
  })
})

describe('scriptSource', () => {
  it('is self-contained: the serialized scripts run on their own with JSON arguments', () => {
    article('<a href="https://example.com/a">A</a>')
    const scan = new Function(`return ${scriptSource(scanLinks, limits)}`)()
    expect(scan.targets).toEqual(['https://example.com/a'])
    const count = new Function(
      `return ${scriptSource(markLinks, {
        summaries: [{ url: 'https://example.com/a', title: 'A', summary: 'S' }],
        delayMs: 0,
      })}`,
    )()
    expect(count).toBe(1)
    new Function(`return ${scriptSource(unmarkLinks, undefined)}`)()
    expect(document.querySelector('[data-antimony-summary]')).toBeNull()
  })
})
