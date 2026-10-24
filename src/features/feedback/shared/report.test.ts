import { describe, expect, it } from 'vitest'
import {
  crashIssue,
  feedbackIssue,
  MAX_FORM_URL,
  MAX_PENDING,
  newIssueUrl,
  parseReports,
  scrubHome,
  type CrashReport,
  type Environment,
} from './report'

const env: Environment = {
  version: '0.1.0',
  commit: 'abc1234',
  electron: '40.0.0',
  chrome: '140.0.0.0',
  os: 'linux 6.8.0',
  arch: 'x64',
}

const pageCrash: CrashReport = {
  at: '2026-10-24T10:00:00.000Z',
  process: 'page',
  reason: 'crashed',
  exitCode: 139,
}

describe('feedback issues', () => {
  it('titles feedback by its first line and adds only the environment', () => {
    const issue = feedbackIssue(`  ${'x'.repeat(80)}\nmore`, env)
    expect(issue.title).toBe(`Feedback: ${'x'.repeat(60)}…`)
    expect(issue.body).toContain('more')
    expect(issue.body).toContain('Antimony 0.1.0 (abc1234)')
    expect(issue.body).toContain('Electron 40.0.0, Chromium 140.0.0.0')
    expect(issue.body).toContain('linux 6.8.0 x64')
  })
})

describe('crash issues', () => {
  it('holds every report, titled by the first', () => {
    const issue = crashIssue(
      [
        {
          at: '2026-10-24T09:00:00.000Z',
          process: 'main',
          reason: 'uncaught-exception',
          error: { name: 'TypeError', message: 'boom', stack: 'TypeError: boom\n    at x' },
        },
        pageCrash,
      ],
      env,
    )
    expect(issue.title).toBe('Crash: main TypeError')
    expect(issue.body).toContain('### Crash 1: main')
    expect(issue.body).toContain('TypeError: boom\n    at x')
    expect(issue.body).toContain('### Crash 2: page')
    expect(issue.body).toContain('Exit code: 139')
    expect(issue.body).toContain('### Environment')
  })

  it('replaces the home folder with ~', () => {
    expect(scrubHome('at /home/jo/app/main.js and /home/jo/x', '/home/jo')).toBe(
      'at ~/app/main.js and ~/x',
    )
    expect(scrubHome('/x', '/')).toBe('/x')
  })
})

describe('newIssueUrl', () => {
  it('prefills the repository’s new-issue form', () => {
    const url = new URL(newIssueUrl('jk09/antimony-browser', { title: 'T', body: 'B & c' }))
    expect(url.origin + url.pathname).toBe('https://github.com/jk09/antimony-browser/issues/new')
    expect(url.searchParams.get('title')).toBe('T')
    expect(url.searchParams.get('body')).toBe('B & c')
  })

  it('shortens a long body to keep the URL under the limit', () => {
    const url = newIssueUrl('a/b', { title: 'T', body: 'ü'.repeat(20_000) })
    expect(url.length).toBeLessThanOrEqual(MAX_FORM_URL)
    expect(new URL(url).searchParams.get('body')).toMatch(/… \(shortened\)$/)
  })
})

describe('parseReports', () => {
  it('keeps valid reports, the newest few', () => {
    const many = Array.from({ length: MAX_PENDING + 2 }, (_, i) => ({ ...pageCrash, exitCode: i }))
    expect(parseReports(many).map((r) => r.exitCode)).toEqual([2, 3, 4, 5, 6])
    expect(parseReports([pageCrash, { process: 'gpu' }, { ...pageCrash, error: {} }])).toEqual([
      pageCrash,
    ])
    expect(parseReports({})).toEqual([])
  })
})
