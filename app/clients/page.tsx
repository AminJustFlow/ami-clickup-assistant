import { prisma } from '@/lib/db/prisma';
import { groupClientFolders, needsClientAttribution } from '@/lib/clients/grouping';
import { AppNav } from '../components/app-nav';

export const dynamic = 'force-dynamic';

export default async function ClientsDirectory({ searchParams }: {
  searchParams: Promise<{ q?: string; sort?: string }>;
}) {
  const { q = '', sort = 'name' } = await searchParams;
  const folders = await prisma.client.findMany({
    where: { active: true, space: { name: 'JF Corporate' } },
    select: { id: true, name: true, slug: true, clickupFolderId: true }
  });
  const groups = groupClientFolders(folders).filter(group => !needsClientAttribution(group.canonical.name));
  const counts = await prisma.task.groupBy({
    by: ['clientId'], where: { deleted: false, client: { active: true, space: { name: 'JF Corporate' } } },
    _count: { _all: true }
  });
  const byId = new Map(counts.map(row => [row.clientId, row._count._all]));
  const entries = groups.map(group => ({
    slug: group.canonical.slug, name: group.canonical.name,
    imported: group.folders.reduce((sum, folder) => sum + (byId.get(folder.id) ?? 0), 0)
  }));
  const search = q.trim().toLowerCase();
  const filtered = entries.filter(entry => entry.name.toLowerCase().includes(search)).sort((a, b) =>
    sort === 'tasks' ? b.imported - a.imported || a.name.localeCompare(b.name) : a.name.localeCompare(b.name)
  );
  return <main className="ops-shell dashboard-shell" id="main-content">
    <AppNav current="clients" />
    <header className="detail-hero"><p className="eyebrow">CLIENT DIRECTORY</p><h1>All clients</h1>
      <p>Find a client and explore imported ClickUp work and available AI analysis.</p></header>
    <section className="clean-panel directory-panel">
      <div className="panel-heading"><div><h2>Client accounts</h2><p>Related ClickUp folders appear under one client.</p></div>
        <span className="panel-count">{entries.length}</span></div>
      <form className="filter-bar clean-filters directory-filters" method="GET">
        <label className="search-label">Search clients<input type="search" name="q" defaultValue={q} placeholder="Client name…" /></label>
        <label>Sort by<select name="sort" defaultValue={sort}><option value="name">Client name</option><option value="tasks">Most imported tasks</option></select></label>
        <button type="submit">Apply</button><a href="/clients">Clear</a>
      </form>
      <p className="directory-result-count">{filtered.length} of {entries.length} clients · Counts include imported historical tasks, not just active work.</p>
      <div className="directory-grid">{filtered.map(entry => <a className="directory-entry" key={entry.slug} href={`/clients/${entry.slug}`}>
        <span className="entity-avatar">{entry.name[0]?.toUpperCase() ?? '?'}</span>
        <span><strong>{entry.name}</strong><small>{entry.imported.toLocaleString()} imported tasks</small></span>
        <span aria-hidden="true">↗</span></a>)}
      </div>
      {filtered.length === 0 && <p className="simple-empty directory-empty">No clients match your search.</p>}
    </section>
  </main>;
}
