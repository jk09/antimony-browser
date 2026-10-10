import { describe, expect, it, vi } from 'vitest'
import { sampleTheme } from '../shared/sample-theme'
import {
  generateThemes,
  MAX_CANDIDATES,
  parseCandidates,
  parseDescription,
  THEME_SYSTEM,
  themePrompt,
} from './generate'

const answer = (candidates: unknown[]) => JSON.stringify({ candidates })

describe('theme generation', () => {
  it('sends only the need and the token names, with WCAG and usability guidance', () => {
    const text = themePrompt('a light theme suitable for astigmatism')
    expect(text).toContain('Need: a light theme suitable for astigmatism')
    expect(text).toContain('panel-bg')
    expect(THEME_SYSTEM).toMatch(/WCAG 2\.2/)
    for (const need of ['Astigmatism', 'photophobia', 'Low vision', 'Dyslexia', 'Colour-vision']) {
      expect(THEME_SYSTEM).toContain(need)
    }
  })

  it('validates the description', () => {
    expect(parseDescription('  dark, low glare ')).toBe('dark, low glare')
    for (const bad of [42, '', '   ', 'x'.repeat(301)]) {
      expect(() => parseDescription(bad), String(bad)).toThrow(TypeError)
    }
  })

  it('reads candidates from fenced or wrapped JSON, skipping malformed ones', () => {
    const good = sampleTheme('Calm')
    const parsed = parseCandidates(
      'Here you go:\n```json\n' +
        answer([good, { name: 'Broken', colors: {} }, { ...good, name: 'Calm two' }]) +
        '\n```',
    )!
    expect(parsed.map((c) => c.theme.name)).toEqual(['Calm', 'Calm two'])
    expect(parseCandidates('no json here')).toBeNull()
    expect(parseCandidates('{"themes": []}')).toBeNull()
  })

  it(`keeps at most ${MAX_CANDIDATES} candidates`, () => {
    const many = Array.from({ length: 6 }, (_, i) => sampleTheme(`Theme ${i}`))
    expect(parseCandidates(answer(many))).toHaveLength(MAX_CANDIDATES)
  })

  it('asks once more after an answer that is not JSON, then reports errors for the user', async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ text: 'Sorry, here are some ideas…' })
      .mockResolvedValueOnce({ text: answer([sampleTheme()]) })
    const themes = await generateThemes(complete, 'calm')
    expect(themes).toHaveLength(1)
    expect(complete).toHaveBeenCalledTimes(2)
    expect(complete.mock.calls[0]![0]).toMatchObject({
      system: THEME_SYSTEM,
      text: themePrompt('calm'),
    })

    const never = vi.fn().mockResolvedValue({ text: 'nope' })
    await expect(generateThemes(never, 'calm')).rejects.toThrow("didn't answer with themes")
    expect(never).toHaveBeenCalledTimes(2)

    const unreadable = sampleTheme()
    const hopeless = vi.fn().mockResolvedValue({
      text: answer([
        {
          ...unreadable,
          colors: {
            ...unreadable.colors,
            'toolbar-bg': '#000000',
            'panel-bg': '#ffffff',
            'card-bg': '#767676',
          },
        },
      ]),
    })
    await expect(generateThemes(hopeless, 'calm')).rejects.toThrow('readable enough')
  })
})
