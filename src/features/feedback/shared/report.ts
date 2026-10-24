/** Versions and platform, the only context sent with feedback and crash reports. */
export interface Environment {
  version: string
  commit: string
  electron: string
  chrome: string
  /** Platform and release, e.g. `linux 6.8.0`. */
  os: string
  arch: string
}

export type CrashProcess = 'main' | 'chrome UI' | 'page'

/** One crash, as stored until the user answers the popup. */
export interface CrashReport {
  /** ISO time. */
  at: string
  process: CrashProcess
  /** `render-process-gone`'s reason, or `uncaught-exception` / `unhandled-rejection`. */
  reason: string
  exitCode?: number
  error?: { name: string; message: string; stack: string }
}

export interface Issue {
  title: string
  body: string
}

export const MAX_PENDING = 5
/** GitHub rejects longer new-issue URLs. */
export const MAX_FORM_URL = 8000
const MAX_TITLE_TEXT = 60
const MAX_STACK = 4000

/** Replaces the user's home folder with `~`, so reports don't carry the user name. */
export function scrubHome(text: string, home: string): string {
  return home.length > 1 ? text.split(home).join('~') : text
}

function environmentSection(env: Environment): string {
  return [
    '### Environment',
    '',
    `- Antimony ${env.version} (${env.commit})`,
    `- Electron ${env.electron}, Chromium ${env.chrome}`,
    `- ${env.os} ${env.arch}`,
  ].join('\n')
}

const shorten = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max).trimEnd()}…` : text

export function feedbackIssue(text: string, env: Environment): Issue {
  const firstLine = text.trim().split('\n')[0]!.trim()
  return {
    title: `Feedback: ${shorten(firstLine, MAX_TITLE_TEXT)}`,
    body: `${text.trim()}\n\n${environmentSection(env)}\n`,
  }
}

/** One line per crash: what crashed and why. */
export const crashLine = (report: CrashReport) =>
  [
    `${report.process} – ${report.reason}`,
    report.exitCode !== undefined ? `exit code ${report.exitCode}` : '',
    report.error ? `${report.error.name}: ${report.error.message}` : '',
  ]
    .filter(Boolean)
    .join(', ')

export function crashIssue(reports: CrashReport[], env: Environment): Issue {
  const first = reports[0]!
  const sections = reports.map((report, index) =>
    [
      `### Crash ${index + 1}: ${report.process}`,
      '',
      `- Time: ${report.at}`,
      `- Reason: ${report.reason}`,
      ...(report.exitCode !== undefined ? [`- Exit code: ${report.exitCode}`] : []),
      ...(report.error
        ? [
            `- Error: ${report.error.name}: ${report.error.message}`,
            '',
            '```',
            shorten(report.error.stack, MAX_STACK),
            '```',
          ]
        : []),
    ].join('\n'),
  )
  return {
    title: `Crash: ${first.process} ${shorten(first.error?.name ?? first.reason, MAX_TITLE_TEXT)}`,
    body: `${sections.join('\n\n')}\n\n${environmentSection(env)}\n`,
  }
}

/** GitHub's new-issue form, prefilled; the body is shortened so the URL stays under the limit. */
export function newIssueUrl(repo: string, issue: Issue): string {
  const build = (body: string) =>
    `https://github.com/${repo}/issues/new?${new URLSearchParams({ title: issue.title, body })}`
  let body = issue.body
  let url = build(body)
  while (url.length > MAX_FORM_URL && body.length > 0) {
    body = body.slice(0, Math.floor(body.length * 0.9))
    url = build(`${body}\n\n… (shortened)`)
  }
  return url
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const processes: CrashProcess[] = ['main', 'chrome UI', 'page']

/** Stored pending reports; anything malformed is dropped. */
export function parseReports(raw: unknown): CrashReport[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (item): item is CrashReport =>
        isRecord(item) &&
        typeof item['at'] === 'string' &&
        processes.includes(item['process'] as CrashProcess) &&
        typeof item['reason'] === 'string' &&
        (item['exitCode'] === undefined || typeof item['exitCode'] === 'number') &&
        (item['error'] === undefined ||
          (isRecord(item['error']) &&
            ['name', 'message', 'stack'].every(
              (key) => typeof (item['error'] as Record<string, unknown>)[key] === 'string',
            ))),
    )
    .slice(-MAX_PENDING)
}
