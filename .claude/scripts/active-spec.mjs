#!/usr/bin/env node
// Prints the active spec; stdout is added to Claude's context (SessionStart hook)
import { findActiveSpec } from './find-active-spec.mjs'

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd()
const spec = findActiveSpec(root)

console.log(spec ? `Active spec (${spec.path}):\n${spec.content}` : 'No active spec.')
