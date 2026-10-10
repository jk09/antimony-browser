import type { Skill } from '../ipc'

const builtin = (name: string, tool: string, description: string): Skill => ({
  name,
  description,
  params: [],
  steps: [{ tool, input: {} }],
  builtin: true,
})

/** One-step skills shipped with the app; they replay like saved ones. */
export const builtinSkills: Skill[] = [
  {
    name: 'import-edge',
    description:
      'Import the browsing data exported from Edge (a .csv file) into history, with related pages in stacks',
    params: [{ name: 'file', hint: 'path to the Edge export (.csv)' }],
    steps: [{ tool: 'import_browsing_data', input: { path: '{{file}}' } }],
    builtin: true,
  },
  builtin('reload', 'reload', 'Reload the page'),
  builtin('stop', 'stop', 'Stop loading the page'),
]
