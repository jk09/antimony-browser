// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { findInPage, inspectElement, readPage, scriptSource, scrollPage } from './page-scripts'

beforeEach(() => {
  document.title = 'Shop'
  document.body.innerHTML = `
    <h1>Welcome</h1>
    <p>Best cats in town. Cats, cats, cats.</p>
    <a href="/about">About us</a>
    <form>
      <label for="q">Search</label><input id="q" name="q">
      <input type="password" name="pw">
      <input name="card" autocomplete="cc-number">
      <button type="submit">Go</button>
      <button disabled>Nope</button>
    </form>
    <ul><li><button>First</button></li><li><button>Second</button></li></ul>
  `
})

describe('readPage', () => {
  it('returns text and interactive elements with selectors that find them', () => {
    const page = readPage({ maxText: 10_000, maxElements: 50 })
    expect(page.title).toBe('Shop')
    expect(page.text).toContain('Best cats in town')
    const names = page.elements.map((element) => `${element.role}:${element.name}`)
    expect(names).toEqual([
      'link:About us',
      'textbox:Search',
      'textbox:pw',
      'textbox:card',
      'button:Go',
      'button:First',
      'button:Second',
    ])
    for (const element of page.elements) {
      expect(document.querySelectorAll(element.selector), element.selector).toHaveLength(1)
    }
    expect(page.elements[1]!.selector).toBe('#q')
  })

  it('truncates long text and element lists', () => {
    const page = readPage({ maxText: 5, maxElements: 2 })
    expect(page.text).toHaveLength(5)
    expect(page.textTruncated).toBe(true)
    expect(page.elements).toHaveLength(2)
    expect(page.elementsTruncated).toBe(true)
  })
})

describe('findInPage', () => {
  it('counts case-insensitive matches and returns snippets', () => {
    const result = findInPage({ text: 'CATS', max: 2 })
    expect(result.total).toBe(4)
    expect(result.matches).toHaveLength(2)
    expect(result.matches[0]).toContain('cats')
  })
})

describe('inspectElement', () => {
  it('flags password and payment card fields as sensitive', () => {
    expect(inspectElement({ selector: 'input[name="pw"]', focus: false })).toMatchObject({
      found: true,
      sensitive: true,
    })
    expect(inspectElement({ selector: 'input[name="card"]', focus: false }).sensitive).toBe(true)
    expect(inspectElement({ selector: '#q', focus: false }).sensitive).toBe(false)
  })

  it('focuses fields on request, but never sensitive ones', () => {
    inspectElement({ selector: '#q', focus: true })
    expect(document.activeElement?.id).toBe('q')
    inspectElement({ selector: 'input[name="pw"]', focus: true })
    expect(document.activeElement?.id).toBe('q')
  })

  it('reports missing elements and invalid selectors', () => {
    expect(inspectElement({ selector: '#missing', focus: false })).toMatchObject({ found: false })
    expect(inspectElement({ selector: '[[', focus: false })).toEqual({
      found: false,
      error: 'Invalid CSS selector',
    })
  })
})

describe('scriptSource', () => {
  it('is self-contained: the serialized script runs on its own with JSON arguments', () => {
    // Evaluated like executeJavaScript would, without access to this module.
    const result = new Function(`return ${scriptSource(findInPage, { text: 'welcome', max: 1 })}`)()
    expect(result).toEqual({ total: 1, matches: [expect.stringContaining('Welcome')] })
    const page = new Function(
      `return ${scriptSource(readPage, { maxText: 100, maxElements: 1 })}`,
    )()
    expect(page.elements).toHaveLength(1)
    const scrolled = new Function(`return ${scriptSource(scrollPage, { direction: 'top' })}`)()
    expect(scrolled).toMatchObject({ scrollY: 0 })
  })

  it('passes arguments as data, not code', () => {
    const source = scriptSource(findInPage, { text: '"); alert(1); ("', max: 1 })
    expect(source.endsWith('({"text":"\\"); alert(1); (\\"","max":1})')).toBe(true)
  })
})

describe('inspectElement roles', () => {
  it('describes elements by role for approvals', () => {
    expect(inspectElement({ selector: 'a', focus: false })).toMatchObject({
      role: 'link',
      name: 'About us',
    })
    expect(inspectElement({ selector: '#q', focus: false }).role).toBe('textbox')
    expect(inspectElement({ selector: 'button[type="submit"]', focus: false }).role).toBe('button')
  })
})
