import { ActingFrame } from '../../features/agent/ui/ActingFrame'
import { Conversation } from '../../features/agent/ui/Conversation'
import { DebugPanel } from '../../features/agent/ui/DebugPanel'
import { HistoryView } from '../../features/history/ui/HistoryView'
import { PageArea } from '../../features/navigation/ui/PageArea'
import { AssistantPanel } from '../../features/prompt/ui/AssistantPanel'
import { SaveSkill } from '../../features/skills/ui/SaveSkill'

/**
 * The chrome UI: page area on the left (the page view is laid over it), then the debugger, then
 * the assistant panel on the right. Features mount their UI here.
 */
export function App() {
  const { chrome, electron } = window.antimony.versions
  return (
    <div className="shell">
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
      <AssistantPanel
        conversation={<Conversation />}
        form={<SaveSkill />}
        overlay={<HistoryView />}
      />
    </div>
  )
}
