import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { claudeModels, type AgentSettings, type CliCheck, type CliCheckStep } from '../../agent/ipc'

const steps = [
  { id: 'cli', title: 'Claude Code CLI' },
  { id: 'test', title: 'Test' },
  { id: 'model', title: 'Model' },
  { id: 'prompt', title: 'Prompt' },
  { id: 'skills', title: 'Skills' },
] as const
type StepId = (typeof steps)[number]['id']

type Platform = 'mac' | 'windows' | 'linux'

function platformOf(userAgent: string): Platform {
  if (/Windows/i.test(userAgent)) return 'windows'
  if (/Mac OS X|Macintosh/i.test(userAgent)) return 'mac'
  return 'linux'
}

const mod = (platform: Platform) => (platform === 'mac' ? 'Cmd' : 'Ctrl')

function Command({ children }: { children: string }) {
  return (
    <pre className="welcome-command">
      <code>{children}</code>
    </pre>
  )
}

/** Install and login steps for the user's system. */
function InstallSteps({ platform }: { platform: Platform }) {
  return (
    <div className="welcome-install" aria-label="Install the Claude Code CLI">
      <p>Install it from a terminal:</p>
      {platform === 'windows' ? (
        <>
          <p className="welcome-note">In PowerShell:</p>
          <Command>irm https://claude.ai/install.ps1 | iex</Command>
        </>
      ) : (
        <Command>curl -fsSL https://claude.ai/install.sh | bash</Command>
      )}
      <p className="welcome-note">Or, with Node.js 18 or newer:</p>
      <Command>npm install -g @anthropic-ai/claude-code</Command>
      <p>Then start it once and log in with your Claude account:</p>
      <Command>claude</Command>
      <p className="welcome-note">
        Antimony looks for <code>claude</code> on your PATH and in the installers&rsquo; folders. If
        it&rsquo;s somewhere else, start Antimony with <code>CLAUDE_CLI_PATH</code> set to it.
      </p>
    </div>
  )
}

const fixes: Record<'found' | 'loggedIn' | 'answered', string> = {
  found: 'Install the Claude Code CLI (step 1), or set CLAUDE_CLI_PATH, then test again.',
  loggedIn: 'Run claude in a terminal, log in, then test again.',
  answered:
    'Check that your Claude plan includes this model, or pick another one in the next step.',
}

function CheckLine({
  label,
  step,
  fix,
  running,
  detail,
}: {
  label: string
  step: CliCheckStep | null | undefined
  fix: string
  running: boolean
  detail?: string
}) {
  const state = step ? (step.ok ? 'ok' : 'failed') : running ? 'running' : 'skipped'
  const mark = { ok: '✓', failed: '✗', running: '…', skipped: '–' }[state]
  return (
    <li className={`welcome-check ${state}`} data-state={state}>
      <span className="welcome-check-mark" aria-hidden="true">
        {mark}
      </span>
      <div>
        <span>
          {label}
          {state === 'ok' && detail ? ` ${detail}` : ''}
          {state === 'running' ? ' – checking…' : ''}
          {state === 'skipped' ? ' – not checked' : ''}
        </span>
        {step && !step.ok && (
          <>
            <p className="welcome-error">{step.error}</p>
            <p className="welcome-note">{fix}</p>
          </>
        )}
      </div>
    </li>
  )
}

/** Runs the agent's CLI check and shows each part of it. */
function CliTest({ check, running }: { check: CliCheck | null; running: boolean }) {
  const label = (id: string | undefined) =>
    claudeModels.find((model) => model.id === id)?.label ?? 'the selected model'
  const answered = check?.answered
  return (
    <ul className="welcome-checks" role="status" aria-label="Claude Code CLI test">
      <CheckLine
        label="Claude Code CLI found"
        step={check?.found}
        fix={fixes.found}
        running={running}
      />
      <CheckLine
        label="Logged in"
        step={check?.loggedIn}
        fix={fixes.loggedIn}
        running={running && !check}
      />
      <CheckLine
        label={`Answers with ${label(answered?.model)}`}
        step={answered}
        fix={fixes.answered}
        running={running && !check}
        detail={answered?.ms !== undefined ? `in ${(answered.ms / 1000).toFixed(1)} s` : undefined}
      />
    </ul>
  )
}

/**
 * The welcome page over the page area (the page view is hidden meanwhile): sets up the Claude Code
 * CLI, tests it, picks the model strength and explains the prompt and skills. Opens on the first
 * launch and with /welcome or File → Welcome; closing or finishing it marks it done.
 */
export function WelcomeView() {
  const api = window.antimony
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<StepId>('cli')
  const [installed, setInstalled] = useState<boolean | null>(null)
  const [check, setCheck] = useState<CliCheck | null>(null)
  const [checking, setChecking] = useState(false)
  const [settings, setSettings] = useState<AgentSettings | null>(null)
  const view = useRef<HTMLElement>(null)
  const platform = platformOf(navigator.userAgent)

  const show = useCallback(() => {
    setOpen(true)
    setStep('cli')
    setInstalled(null)
    setCheck(null)
  }, [])

  useEffect(() => {
    api.welcome
      .state()
      .then((state) => {
        if (!state.done) show()
      })
      .catch((reason: unknown) => console.error(reason))
    return api.welcome.onOpen(show)
  }, [api, show])
  useEffect(() => {
    api.agent
      .settings()
      .then(setSettings)
      .catch((reason: unknown) => console.error(reason))
    return api.agent.onSettingsChanged(setSettings)
  }, [api])
  useEffect(() => {
    if (open) view.current?.focus()
  }, [open, step])

  const runCheck = useCallback(() => {
    setChecking(true)
    setCheck(null)
    api.agent
      .checkCli()
      .then(setCheck)
      .catch((reason: unknown) =>
        setCheck({
          found: { ok: false, error: reason instanceof Error ? reason.message : String(reason) },
          loggedIn: null,
          answered: null,
        }),
      )
      .finally(() => setChecking(false))
  }, [api])

  if (!open) return null

  const close = () => {
    setOpen(false)
    api.welcome.setDone(true).catch((reason: unknown) => console.error(reason))
  }
  const go = (next: StepId) => {
    setStep(next)
    if (next === 'test' && !check && !checking) runCheck()
  }
  const index = steps.findIndex((s) => s.id === step)
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }
  const nav = (next: ReactNode = null) => (
    <div className="welcome-nav">
      {index > 0 && (
        <button type="button" onClick={() => go(steps[index - 1]!.id)}>
          Back
        </button>
      )}
      <span className="welcome-spacer" />
      {next ??
        (index < steps.length - 1 ? (
          <button type="button" className="primary" onClick={() => go(steps[index + 1]!.id)}>
            Next
          </button>
        ) : (
          <button type="button" className="primary" onClick={close}>
            Start browsing
          </button>
        ))}
    </div>
  )
  const key = mod(platform)

  return (
    <section
      ref={view}
      className="welcome-view"
      aria-label="Welcome"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <header className="welcome-header">
        <h2>Welcome to Antimony</h2>
        <button
          type="button"
          className="assistant-hide"
          aria-label="Close welcome page"
          onClick={close}
        >
          ×
        </button>
      </header>
      <ol className="welcome-steps" aria-label="Steps">
        {steps.map((s, i) => (
          <li key={s.id} aria-current={s.id === step ? 'step' : undefined}>
            <button type="button" onClick={() => go(s.id)}>
              {i + 1} · {s.title}
            </button>
          </li>
        ))}
      </ol>
      <div className="welcome-body">
        {step === 'cli' && (
          <section aria-labelledby="welcome-cli">
            <h3 id="welcome-cli">Do you have the Claude Code CLI installed?</h3>
            <p>
              Antimony&rsquo;s assistant runs on Claude through the Claude Code CLI on this
              computer, signed in with your own Claude account. Antimony never sees your login.
            </p>
            <div className="welcome-choices">
              <button
                type="button"
                aria-pressed={installed === true}
                onClick={() => {
                  setInstalled(true)
                  go('test')
                }}
              >
                Yes, it&rsquo;s installed
              </button>
              <button
                type="button"
                aria-pressed={installed === false}
                onClick={() => setInstalled(false)}
              >
                No, not yet
              </button>
            </div>
            {installed === false && (
              <>
                <InstallSteps platform={platform} />
                {nav(
                  <button type="button" className="primary" onClick={() => go('test')}>
                    I&rsquo;ve installed it – test it
                  </button>,
                )}
              </>
            )}
          </section>
        )}
        {step === 'test' && (
          <section aria-labelledby="welcome-test">
            <h3 id="welcome-test">Is it responding?</h3>
            <p>
              Antimony starts the CLI, checks that it&rsquo;s logged in and sends it a one-line
              request. No browsing data is sent.
            </p>
            <CliTest check={check} running={checking} />
            <div className="welcome-choices">
              <button type="button" onClick={runCheck} disabled={checking}>
                {check ? 'Test again' : 'Test'}
              </button>
            </div>
            {check && !check.found.ok && <InstallSteps platform={platform} />}
            {nav()}
          </section>
        )}
        {step === 'model' && (
          <section aria-labelledby="welcome-model">
            <h3 id="welcome-model">How strong should the model be?</h3>
            <p>
              Stronger models handle longer, trickier tasks but answer more slowly and use more of
              your plan. You can change it any time with the picker under the prompt or{' '}
              <code>/model</code>.
            </p>
            <div className="welcome-models" role="radiogroup" aria-label="Model">
              {claudeModels.map((model) => (
                <label key={model.id} className="welcome-model">
                  <input
                    type="radio"
                    name="welcome-model"
                    value={model.id}
                    checked={settings?.model === model.id}
                    onChange={() => {
                      // Shown at once; the stored settings follow.
                      setSettings((current) => current && { ...current, model: model.id })
                      api.agent
                        .updateSettings({ model: model.id })
                        .then(setSettings)
                        .catch((reason: unknown) => console.error(reason))
                    }}
                  />
                  <span>
                    <strong>{model.label}</strong>
                    <span className="welcome-note">{model.description}</span>
                  </span>
                </label>
              ))}
            </div>
            {nav()}
          </section>
        )}
        {step === 'prompt' && (
          <section aria-labelledby="welcome-prompt">
            <h3 id="welcome-prompt">Using the prompt</h3>
            <p>
              The prompt at the bottom of the assistant panel on the right is your address bar and
              your assistant in one.
            </p>
            <ul className="welcome-list">
              <li>
                <kbd>{key}+L</kbd> focuses it, <kbd>{key}+I</kbd> opens it over the page,{' '}
                <kbd>{key}+B</kbd> shows or hides the panel.
              </li>
              <li>
                Type an address (<code>wikipedia.org</code>) to open it. Anything else is a request
                for the assistant: &ldquo;find a recipe for pancakes&rdquo;, &ldquo;open the page I
                read about lions last week&rdquo;.
              </li>
              <li>
                Stacks are your tabs. <code>@name</code> refers to a stack (or a page in it) in a
                request or as an argument.
              </li>
              <li>
                The assistant sees only the page address and title until you turn on{' '}
                <code>/page-access on</code> (or the button under the prompt). Every click and every
                bit of typing waits for your approval.
              </li>
              <li>
                It can search the pages you visited; <code>/history-access off</code> stops that.
                Paste or attach images to ask about them.
              </li>
              <li>
                <code>/new</code> starts a new conversation; <code>Esc</code> stops a run.
              </li>
            </ul>
            {nav()}
          </section>
        )}
        {step === 'skills' && (
          <section aria-labelledby="welcome-skills">
            <h3 id="welcome-skills">Skills and macros</h3>
            <ul className="welcome-list">
              <li>
                Type <code>/</code> to list commands and skills; they run at once, without the
                model. <code>/reload</code> and <code>/stop</code> are built in; <code>/menu</code>{' '}
                reaches every menu item.
              </li>
              <li>
                Make your own macros by asking: &ldquo;search wikipedia for lions and store it as
                /wiki&rdquo;. The assistant saves the steps, and words you want to change each time
                become parameters: <code>/wiki tigers</code>.
              </li>
              <li>
                <code>/skills</code> lists your macros, <code>/config</code> shows every command,
                skill and macro with its steps, and <code>/forget name</code> deletes one.
              </li>
              <li>
                <code>/welcome</code> brings this page back.
              </li>
            </ul>
            {nav()}
          </section>
        )}
      </div>
    </section>
  )
}
