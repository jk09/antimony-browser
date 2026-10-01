import { ActingFrame } from '../../features/agent/ui/ActingFrame'
import { Conversation } from '../../features/agent/ui/Conversation'
import { DebugPanel } from '../../features/agent/ui/DebugPanel'
import { PageArea } from '../../features/navigation/ui/PageArea'
import { Prompt } from '../../features/prompt/ui/Prompt'
import { SaveSkill } from '../../features/skills/ui/SaveSkill'

/**
 * The chrome UI: prompt on top, page area below (the page view is laid over it), debugger on the
 * right. Features mount their UI here.
 */
export function App() {
  const { chrome, electron } = window.antimony.versions
  return (
    <div className="shell">
      <header className="toolbar" data-testid="toolbar">
        <Prompt conversation={<Conversation />} />
        <SaveSkill />
      </header>
      <div className="workspace">
        <ActingFrame>
          <PageArea>
            <p>
              Chromium {chrome} · Electron {electron}
            </p>
          </PageArea>
        </ActingFrame>
        <DebugPanel />
      </div>
    </div>
  )
}
