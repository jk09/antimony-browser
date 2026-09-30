#!/usr/bin/env node
// Blocks "done" while the active spec or feature docs lag behind the code (Stop hook).
// Exit 2 + stderr sends Claude back to work. With --base <ref> it checks <ref>...HEAD instead
// of the working tree, so CI can run the same check on a PR.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { findActiveSpec } from './find-active-spec.mjs'

const { base } = parseArgs({ options: { base: { type: 'string' } } }).values
const root = process.env.CLAUDE_PROJECT_DIR || process.cwd()
const featuresRoot = 'src/features'
const testPattern = /(^|\/)(tests?|__tests__|e2e)\/|\.(test|spec)\.[^/]+$/i

if (!base && !process.stdin.isTTY) {
  let hookInput = null
  try {
    hookInput = JSON.parse(readFileSync(0, 'utf8'))
  } catch {
    // Not run as a hook.
  }
  // Claude already went back to work once because of this hook; don't loop.
  if (hookInput?.stop_hook_active) process.exit(0)
}

const git = (...args) => {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .filter(Boolean)
  } catch {
    return []
  }
}

const changed = [
  ...new Set(
    base
      ? git('diff', '--name-only', `${base}...HEAD`)
      : [
          ...git('diff', '--name-only', 'HEAD'),
          ...git('ls-files', '--others', '--exclude-standard'),
        ],
  ),
].sort()

// Code = anything that isn't Markdown or tooling/docs.
const code = changed.filter((f) => !f.endsWith('.md') && !/^(docs|\.claude|\.github)\//.test(f))
const problems = []

// 1. Feature code changed (not only tests) without a README update.
const featureDirPattern = new RegExp(
  `^${featuresRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[^/]+(?=/)`,
)
const featureDirs = [
  ...new Set(
    code
      .filter((f) => !testPattern.test(f))
      .map((f) => f.match(featureDirPattern)?.[0])
      .filter(Boolean),
  ),
].sort()
for (const dir of featureDirs) {
  if (existsSync(join(root, dir))) {
    if (!changed.includes(`${dir}/README.md`)) {
      problems.push(
        `Feature code in ${dir} changed but its README.md didn't - run the document-feature skill.`,
      )
    }
  } else if (!changed.includes('docs/features.md')) {
    problems.push(
      `Feature ${dir} was removed but docs/features.md wasn't updated - run the document-feature skill.`,
    )
  }
}

// 2. Code changed while a spec is active, but the spec wasn't touched.
const spec = findActiveSpec(root)
if (spec && code.length > 0 && !changed.includes(spec.path)) {
  problems.push(
    `Code changed but the active spec ${spec.path} wasn't updated (acceptance criteria, section 14) - run the ship skill.`,
  )
}

if (problems.length > 0) {
  console.error(
    [
      'Not done yet:',
      ...problems.map((p) => `- ${p}`),
      'Fix these, or tell the user why no update is needed.',
    ].join('\n'),
  )
  process.exit(2)
}
