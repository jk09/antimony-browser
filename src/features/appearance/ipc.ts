import type { CheckedTheme, Theme } from './shared/theme'

export type { CheckedTheme, Theme } from './shared/theme'

export const channels = {
  get: 'appearance:get',
  set: 'appearance:set',
  generate: 'appearance:generate',
  capture: 'appearance:capture',
  // /settings theme, File → Appearance…: the UI asks main to open the page (main relays it).
  requestOpen: 'appearance:request-open',
  // main → UI
  changed: 'appearance:changed',
  open: 'appearance:open',
} as const

/** What opens the appearance page: a usability need to generate themes for, or none. */
export interface OpenRequest {
  description: string
}

/** Usability needs offered as suggestions (welcome step, /settings theme). */
export const themeNeeds = [
  {
    name: 'astigmatism',
    label: 'Light, for astigmatism',
    description: 'a light theme suitable for astigmatism',
  },
  {
    name: 'low-glare',
    label: 'Dark, low glare',
    description: 'a dark theme with low glare for light sensitivity',
  },
  {
    name: 'high-contrast',
    label: 'High contrast',
    description: 'a high-contrast theme for low vision',
  },
  { name: 'dyslexia', label: 'Dyslexia-friendly', description: 'a calm, dyslexia-friendly theme' },
  {
    name: 'colour-blind',
    label: 'Colour-blind safe',
    description: 'a theme that is safe for colour-vision deficiency',
  },
] as const

export interface AppearanceApi {
  /** The stored theme, or null for the system default. */
  get(): Promise<Theme | null>
  /** Stores and applies a theme (checked again in main), or the system default with null. */
  set(theme: Theme | null): Promise<Theme | null>
  onChanged(listener: (theme: Theme | null) => void): () => void
  /** Theme candidates for a usability need, from the selected model, contrast-checked. */
  generate(description: string): Promise<CheckedTheme[]>
  /** A JPEG data URL of the browser window as it looks now (the chrome UI only), or null. */
  capture(): Promise<string | null>
  /** Opens the appearance page, optionally generating themes for a need right away. */
  requestOpen(request?: OpenRequest): Promise<void>
  onOpen(listener: (request: OpenRequest) => void): () => void
}
