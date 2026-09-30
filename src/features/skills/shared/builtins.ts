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
  builtin('back', 'go_back', 'Go back'),
  builtin('forward', 'go_forward', 'Go forward'),
  builtin('reload', 'reload', 'Reload the page'),
  builtin('stop', 'stop', 'Stop loading the page'),
]
