import type { Skill } from '../ipc'

const builtin = (name: string, tool: string, description: string): Skill => ({
  name,
  description,
  params: [],
  steps: [{ tool, input: {} }],
  builtin: true,
})

/** Skills shipped with the app (mostly one step); they replay like saved ones. */
export const builtinSkills: Skill[] = [
  builtin('reload', 'reload', 'Reload the page'),
  builtin('stop', 'stop', 'Stop loading the page'),
  {
    name: 'open',
    description: 'Open a URL in a new stack',
    params: [{ name: 'url', hint: 'address to open' }],
    steps: [
      { tool: 'new_stack', input: {} },
      { tool: 'navigate', input: { url: '{{url}}' } },
    ],
    builtin: true,
  },
]
