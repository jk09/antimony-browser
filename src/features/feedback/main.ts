import { homedir, release } from 'node:os'
import { join } from 'node:path'
import { app, dialog, shell } from 'electron'
import type { MainContext } from '../../app/main/features'
import { buildCommit } from '../../shared/build-info'
import { channels, FEEDBACK_REPO, MAX_FEEDBACK } from './ipc'
import { createCrashStore } from './main/crash-store'
import { ghCommand, ghCreateIssue, sendIssue } from './main/github'
import {
  crashIssue,
  crashLine,
  feedbackIssue,
  scrubHome,
  type CrashReport,
  type Environment,
  type Issue,
} from './shared/report'

/** Renderers that went away on purpose. */
const IGNORED_REASONS = new Set(['clean-exit', 'killed'])

function errorInfo(value: unknown): NonNullable<CrashReport['error']> {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack ?? '' }
  }
  return { name: 'Error', message: String(value), stack: '' }
}

export function register({ window, ipc }: MainContext): void {
  const home = homedir()
  const environment = (): Environment => ({
    version: app.getVersion(),
    commit: buildCommit,
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    os: `${process.platform} ${release()}`,
    arch: process.arch,
  })
  const send = (issue: Issue) =>
    sendIssue(FEEDBACK_REPO, issue, {
      create: (repo, created) => ghCreateIssue(repo, created, { command: ghCommand(process.env) }),
      openExternal: (url) => shell.openExternal(url),
    })

  ipc.handle(channels.send, async (text) => {
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_FEEDBACK) {
      throw new TypeError(`feedback must be 1 to ${MAX_FEEDBACK} characters`)
    }
    return send(feedbackIssue(text, environment()))
  })

  const store = createCrashStore(join(app.getPath('userData'), 'crash-reports.json'))
  let asking = false

  /** Asks whether to send the pending reports; one popup at a time, once the window shows. */
  const offer = async () => {
    if (asking || window.isDestroyed() || !window.isVisible()) return
    const pending = store.get()
    if (pending.length === 0) return
    asking = true
    try {
      const { response } = await dialog.showMessageBox(window, {
        type: 'warning',
        title: 'Antimony crashed',
        message: 'Antimony crashed. Send a crash report to the developers?',
        detail: [
          ...pending.map(crashLine),
          '',
          `The report becomes a public issue in github.com/${FEEDBACK_REPO} with these errors, their stack traces and your Antimony, Electron and OS versions. No pages or history are sent.`,
        ].join('\n'),
        buttons: ['Send report', 'Don’t send'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      // Crashes recorded while the popup was open go (or are dropped) with it.
      const reports = store.get()
      store.clear()
      if (response !== 0 || reports.length === 0) return
      const result = await send(crashIssue(reports, environment()))
      if (window.isDestroyed()) return
      await dialog.showMessageBox(window, {
        type: 'info',
        title: 'Crash report',
        message: result.via === 'gh' ? 'Crash report sent. Thank you!' : 'Almost there',
        detail:
          result.via === 'gh'
            ? result.url
            : 'GitHub’s new issue form opened in your browser with the report filled in. Submit it there.',
      })
    } catch (error) {
      console.error('Could not send the crash report', error)
    } finally {
      asking = false
    }
  }

  const record = (report: Omit<CrashReport, 'at'>) => {
    const error = report.error && {
      name: report.error.name,
      message: scrubHome(report.error.message, home),
      stack: scrubHome(report.error.stack, home),
    }
    store.add({ at: new Date().toISOString(), ...report, ...(error && { error }) })
    void offer()
  }

  // Replaces Electron's own error box for the main process: the popup offers the report instead.
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception in the main process', error)
    record({ process: 'main', reason: 'uncaught-exception', error: errorInfo(error) })
  })
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection in the main process', reason)
    record({ process: 'main', reason: 'unhandled-rejection', error: errorInfo(reason) })
  })
  app.on('render-process-gone', (_event, contents, details) => {
    if (IGNORED_REASONS.has(details.reason)) return
    record({
      process: contents === window.webContents ? 'chrome UI' : 'page',
      reason: details.reason,
      exitCode: details.exitCode,
    })
  })

  // Reports from a run that died before the user could answer.
  window.once('show', () => void offer())
}
