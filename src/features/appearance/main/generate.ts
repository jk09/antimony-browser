// Asks the selected model for theme candidates that fit a usability need, then keeps only those
// that parse and meet WCAG 2.2 AA after repair (shared/theme.ts).
import { checkTheme, colorTokens, limits, parseTheme, type CheckedTheme } from '../shared/theme'

export const MAX_CANDIDATES = 4

export const THEME_SYSTEM = `You design colour themes for the user interface of a web browser called Antimony, for people with specific visual needs. Answer with JSON only, no prose and no code fences.

Usability guidance to apply:
- WCAG 2.2: body and secondary text need at least 4.5:1 contrast (AAA 7:1 helps low vision); focus rings, field borders and chart colours at least 3:1 against what they sit on.
- Astigmatism: light themes are usually easier (dark backgrounds make bright text halate and blur). Prefer a soft off-white background, dark grey (not pure black) text, and calm, not neon, accents. If a dark theme is wanted, use dark grey (#1e1e1e or lighter), not pure black, and light grey text, not pure white.
- Light sensitivity / photophobia / migraine: dark themes with low overall luminance, no large bright areas, muted accents; still meet 4.5:1 for text.
- Low vision: high contrast (aim for 7:1), a strong, clearly visible focus ring, distinct borders.
- Dyslexia: off-white, cream or pastel backgrounds instead of pure white; dark grey text; contrast within AA but not harsh.
- Colour-vision deficiency: never rely on red versus green alone; make error and ok differ clearly in lightness too; prefer blue/orange for distinctions.
- Keep hues purposeful: one accent colour, error clearly reddish/warm, ok clearly distinct from error.

Tokens (each a #rrggbb colour):
- toolbar-bg: window background behind panels; panel-bg: side panel background; card-bg: cards and dialogs; field-bg: text fields; code-bg: code and keyboard-key background
- text: main text; muted: secondary text; field-border: borders of fields and cards
- accent: buttons and highlights (also used as text); accent-text: text on accent buttons
- focus: keyboard focus ring and links; error; ok
- cloud-0 … cloud-4: five distinct colours for keyword clouds on card-bg

Answer: {"candidates":[{"name":"…","rationale":"…","scheme":"light"|"dark","colors":{"toolbar-bg":"#…",…}}]} with ${MAX_CANDIDATES - 1} or ${MAX_CANDIDATES} candidates that differ meaningfully (e.g. warmer/cooler, softer/stronger, light/dark when the need allows both). name: at most 4 words. rationale: one sentence (under 160 characters) on why it suits the need.`

/** The request text: only the user's description and the token names. */
export function themePrompt(description: string): string {
  return `Need: ${description}\n\nGive every token: ${colorTokens.join(', ')}.`
}

/** Throws a TypeError unless `value` is a usable description: trimmed, non-empty, short. */
export function parseDescription(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('the description must be text')
  const text = value.trim()
  if (!text) throw new TypeError('Describe the theme you need.')
  if (text.length > limits.description) {
    throw new TypeError(`Keep the description under ${limits.description} characters.`)
  }
  return text
}

/** The first JSON object in the answer (models sometimes wrap it in fences or prose). */
function jsonObject(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

/**
 * The candidates in the model's answer that parse and pass (or can be repaired to pass) the
 * contrast rules, at most MAX_CANDIDATES; null when the answer isn't the JSON asked for.
 */
export function parseCandidates(answer: string): CheckedTheme[] | null {
  const json = jsonObject(answer) as { candidates?: unknown } | null
  if (!json || !Array.isArray(json.candidates)) return null
  const checked: CheckedTheme[] = []
  for (const raw of json.candidates) {
    try {
      const result = checkTheme(parseTheme(raw))
      if (result) checked.push(result)
    } catch {
      // A malformed candidate is skipped; the others may still be fine.
    }
    if (checked.length === MAX_CANDIDATES) break
  }
  return checked
}

export type Complete = (request: {
  system: string
  text: string
  signal?: AbortSignal
}) => Promise<{ text: string }>

/**
 * Asks the model (once more if the answer isn't JSON) and returns the valid candidates; throws an
 * Error meant for the user when there are none.
 */
export async function generateThemes(
  complete: Complete,
  description: string,
  signal?: AbortSignal,
): Promise<CheckedTheme[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const answer = await complete({
      system: THEME_SYSTEM,
      text: themePrompt(description),
      ...(signal && { signal }),
    })
    const candidates = parseCandidates(answer.text)
    if (candidates === null) continue
    if (candidates.length === 0) {
      throw new Error('None of the proposed themes could be made readable enough. Try again.')
    }
    return candidates
  }
  throw new Error("The model didn't answer with themes. Try again.")
}
