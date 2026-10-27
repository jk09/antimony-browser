// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { collectLinks, scriptSource } from './page-scripts'

const limits = { maxLinks: 3, maxText: 10 }

beforeEach(() => {
  history.replaceState(null, '', '/notes/wal#top')
  document.body.innerHTML = `
    <header><a href="/home">Home</a></header>
    <nav><a href="/nav">Nav</a></nav>
    <article><h1>WAL</h1><p>
      <a href="https://example.com/a#x">  Page   A  </a>
      <a href="https://example.com/a#y">A again</a>
      <a href="#top">Self</a>
      <a href="/notes/wal">Self too</a>
      <a href="mailto:x@example.com">Mail</a>
      <a href="/file.pdf">PDF</a>
      <a href="/b" download>Download</a>
      <a href="/c"><img alt=""></a>
      <aside><a href="/aside">Aside</a></aside>
      <a href="https://other.example/d">A rather long link text</a>
      <a href="https://other.example/e">E (over the limit)</a>
    </p></article>
    <footer><a href="/legal">Legal</a></footer>`
})

describe('collectLinks', () => {
  it("collects the main text's distinct web targets in order, without fragments, with their text", () => {
    expect(collectLinks(limits)).toEqual({
      url: 'http://localhost:3000/notes/wal',
      links: [
        { url: 'https://example.com/a', text: 'Page A' },
        { url: 'http://localhost:3000/c', text: '' },
        { url: 'https://other.example/d', text: 'A rather l' },
      ],
    })
  })

  it('falls back to the body without an article and leaves the page unchanged', () => {
    document.body.innerHTML = '<nav><a href="/nav">Nav</a></nav><p><a href="/x">X</a></p>'
    const before = document.documentElement.outerHTML
    expect(collectLinks(limits).links).toEqual([{ url: 'http://localhost:3000/x', text: 'X' }])
    expect(document.documentElement.outerHTML).toBe(before)
  })

  it('is self-contained: the serialized script runs on its own with JSON arguments', () => {
    const result = new Function(`return ${scriptSource(collectLinks, limits)}`)()
    expect(result.links).toHaveLength(3)
  })
})
