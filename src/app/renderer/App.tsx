/** The chrome UI: toolbar on top, web content below. Features mount their UI here. */
export function App() {
  const { chrome, electron } = window.antimony.versions
  return (
    <div className="shell">
      <header className="toolbar" data-testid="toolbar">
        <span className="brand">Antimony</span>
      </header>
      <main className="content" data-testid="content">
        <p>
          Chromium {chrome} · Electron {electron}
        </p>
      </main>
    </div>
  )
}
