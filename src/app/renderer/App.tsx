import { ActingFrame } from '../../features/agent/ui/ActingFrame'
import { Conversation } from '../../features/agent/ui/Conversation'
import { DebugPanel } from '../../features/agent/ui/DebugPanel'
import { AppearanceView } from '../../features/appearance/ui/AppearanceView'
import { ThemeApplier } from '../../features/appearance/ui/ThemeApplier'
import { ThemePicker } from '../../features/appearance/ui/ThemePicker'
import { HistoryView } from '../../features/history/ui/HistoryView'
import { MapView } from '../../features/history/ui/MapView'
import { RecallView } from '../../features/history/ui/RecallView'
import { PageArea } from '../../features/navigation/ui/PageArea'
import { AssistantPanel } from '../../features/prompt/ui/AssistantPanel'
import { ConfigView } from '../../features/skills/ui/ConfigView'
import { StackHeader } from '../../features/stacks/ui/StackHeader'
import { WelcomeView } from '../../features/welcome/ui/WelcomeView'

/**
 * The chrome UI: page area on the left (the page view is laid over it), then the debugger, then
 * the assistant panel on the right. Features mount their UI here.
 */
export function App() {
  const { chrome, electron } = window.antimony.versions
  return (
    <div className="shell">
      <ThemeApplier />
      <div className="workspace">
        <ActingFrame>
          <PageArea>
            <p>
              Chromium {chrome} · Electron {electron}
            </p>
          </PageArea>
        </ActingFrame>
        <RecallView />
        <MapView />
        <ConfigView />
        <WelcomeView themeStep={<ThemePicker />} />
        <AppearanceView />
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
