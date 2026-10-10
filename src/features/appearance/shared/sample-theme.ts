// Test fixture: a light theme that passes the contrast rules as is.
import type { Theme } from './theme'

export const sampleTheme = (name = 'Soft daylight'): Theme => ({
  name,
  rationale: 'Off-white background and dark grey text reduce glare.',
  scheme: 'light',
  colors: {
    'toolbar-bg': '#e8e6e1',
    'panel-bg': '#f7f5f0',
    'card-bg': '#fbfaf6',
    'field-bg': '#fbfaf6',
    'code-bg': '#ebe8e1',
    text: '#26282b',
    muted: '#555a60',
    'field-border': '#80858c',
    accent: '#1f5fa8',
    'accent-text': '#ffffff',
    focus: '#1f5fa8',
    error: '#a3261d',
    ok: '#22693f',
    'cloud-0': '#1f5fa8',
    'cloud-1': '#a35200',
    'cloud-2': '#22693f',
    'cloud-3': '#7a3e9d',
    'cloud-4': '#8a5a00',
  },
})
