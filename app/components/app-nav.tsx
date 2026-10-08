export function AppNav({ current }: { current: 'overview' | 'activity' | 'clients' | 'team' }) {
  return <nav className="app-nav" aria-label="Main navigation">
    <a className="app-brand" href="/"><span className="brand-mark">JF</span><span>Just Flow <small>Intelligence</small></span></a>
    <div className="app-nav-links">
      <a href="/" aria-current={current === 'overview' ? 'page' : undefined}>Overview</a>
      <a href="/changes" aria-current={current === 'activity' ? 'page' : undefined}>Activity</a>
      <a href="/#clients" aria-current={current === 'clients' ? 'page' : undefined}>Clients</a>
      <a href="/#team" aria-current={current === 'team' ? 'page' : undefined}>Team</a>
    </div>
    <details className="tools-menu"><summary>Tools</summary><div><a href="/review">AI quality review</a><a href="/debug/voth/intelligence">Evidence explorer</a></div></details>
  </nav>;
}
