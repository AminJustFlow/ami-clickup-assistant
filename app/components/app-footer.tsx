export function AppFooter() {
  return <footer className="app-footer" aria-label="Application footer">
    <div className="app-footer-inner">
      <span>Just Flow Intelligence</span>
      <details className="footer-dev-tools">
        <summary>Developer tools</summary>
        <div className="footer-dev-links">
          <a href="/review">AI quality review</a>
          <a href="/debug/voth/intelligence">Evidence explorer</a>
        </div>
      </details>
    </div>
  </footer>;
}
