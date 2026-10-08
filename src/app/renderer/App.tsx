import { ActingFrame } from '../../features/agent/ui/ActingFrame'
import { Conversation } from '../../features/agent/ui/Conversation'
import { DebugPanel } from '../../features/agent/ui/DebugPanel'
import { HistoryView } from '../../features/history/ui/HistoryView'
import { RecallView } from '../../features/history/ui/RecallView'
import { PageArea } from '../../features/navigation/ui/PageArea'
import { AssistantPanel } from '../../features/prompt/ui/AssistantPanel'
import { ConfigView } from '../../features/skills/ui/ConfigView'
import { StackHeader } from '../../features/stacks/ui/StackHeader'

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
        <RecallView />
        <ConfigView />
        <DebugPanel />
      </div>
      <AssistantPanel
        header={<StackHeader />}
        conversation={<Conversation />}
        overlay={<HistoryView />}
      />
    </div>
  )
}
