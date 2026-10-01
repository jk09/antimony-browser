import { describe, expect, it } from 'vitest'
import type { SummarySource } from './db'
import { needsSummary, parseSummary, SUMMARY_TEXT_LIMIT, summaryPrompt } from './summarize'

const DAY = 24 * 60 * 60 * 1000
const source = (overrides: Partial<SummarySource> = {}): SummarySource => ({
  url: 'https://example.com/a',
  title: 'A page',
  description: 'About things',
  siteName: 'Example',
  text: 'Body text',
  textHash: 'h1',
  sensitive: false,
  summarizedAt: null,
  summaryTextHash: null,
  ...overrides,
})

describe('summaries', () => {
  it('are needed once, then only when the text changed and the summary is a week old', () => {
    expect(needsSummary(source(), 0)).toBe(true)
    const done = source({ summarizedAt: 10 * DAY, summaryTextHash: 'h1' })
    expect(needsSummary(done, 30 * DAY)).toBe(false)
    expect(needsSummary({ ...done, textHash: 'h2' }, 12 * DAY)).toBe(false)
    expect(needsSummary({ ...done, textHash: 'h2' }, 18 * DAY)).toBe(true)
  })

  it('are never requested for sensitive or empty pages', () => {
    expect(needsSummary(source({ sensitive: true }), 0)).toBe(false)
    expect(needsSummary(source({ text: '' }), 0)).toBe(false)
  })

  it('send page content as untrusted, capped', () => {
    const prompt = summaryPrompt(source({ text: 'x'.repeat(SUMMARY_TEXT_LIMIT + 500) }))
    expect(prompt).toMatch(
      /^<untrusted_page_content>\nURL: https:\/\/example.com\/a\nTitle: A page/,
    )
    expect(prompt).toContain('</untrusted_page_content>')
    expect(/\n(x+)\n<\/untrusted_page_content>/.exec(prompt)![1]).toHaveLength(SUMMARY_TEXT_LIMIT)
  })

  it('parse SUMMARY and LOOKS', () => {
    expect(parseSummary('SUMMARY: A guide to WAL.\nLOOKS: A white page with a diagram.')).toEqual({
      summary: 'A guide to WAL.',
      visualDescription: 'A white page with a diagram.',
    })
    expect(parseSummary('Just a summary')).toEqual({
      summary: 'Just a summary',
      visualDescription: null,
    })
    expect(parseSummary('SUMMARY: x\nLOOKS: -')).toEqual({ summary: 'x', visualDescription: null })
    expect(parseSummary('  ')).toBeNull()
    expect(parseSummary('LOOKS: only looks')).toBeNull()
  })
})
