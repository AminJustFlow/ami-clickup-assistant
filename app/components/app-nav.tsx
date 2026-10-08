export function AppNav({ current }: { current: 'overview' | 'activity' | 'clients' | 'team' }) {
  return <><a className="skip-link" href="#main-content">Skip to content</a><nav className="app-nav" aria-label="Main navigation">
    <a className="app-brand" href="/"><img className="brand-logo" src="/just-flow-logo.png" alt="Just Flow Events & Marketing" /><span className="brand-product">Intelligence</span></a>
    <div className="app-nav-links">
      <a href="/" aria-current={current === 'overview' ? 'page' : undefined}>Dashboard</a>
      <a href="/changes" aria-current={current === 'activity' ? 'page' : undefined}>Recent updates</a>
      <a href="/#clients" aria-current={current === 'clients' ? 'page' : undefined}>Clients</a>
      <a href="/#team" aria-current={current === 'team' ? 'page' : undefined}>Team</a>
    </div>
    <details className="tools-menu"><summary>Developer tools</summary><div><a href="/review">AI quality review</a><a href="/debug/voth/intelligence">Evidence explorer</a></div></details>
  </nav></>;
}
