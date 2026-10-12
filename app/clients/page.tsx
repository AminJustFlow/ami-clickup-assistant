import { prisma } from '@/lib/db/prisma';
import { groupClientFolders, needsClientAttribution } from '@/lib/clients/grouping';
import { AppNav } from '../components/app-nav';

export const dynamic = 'force-dynamic';

export default async function ClientsDirectory() {
  const folders = await prisma.client.findMany({
    where: { active: true, space: { name: 'JF Corporate' } },
    select: { id: true, name: true, slug: true, clickupFolderId: true }
  });
  const groups = groupClientFolders(folders).filter(group => !needsClientAttribution(group.canonical.name)).sort((a,b) => a.canonical.name.localeCompare(b.canonical.name));
  const counts = await prisma.task.groupBy({ by: ['clientId'], where: { deleted: false, client: { active: true, space: { name: 'JF Corporate' } } }, _count: { _all: true } });
  const byId = new Map(counts.map(row => [row.clientId, row._count._all]));
  return <main className="ops-shell dashboard-shell" id="main-content">
    <AppNav current="clients" />
    <header className="detail-hero"><p className="eyebrow">CLIENT DIRECTORY</p><h1>All clients</h1><p>Browse every active client. Open a client to review imported tasks and available intelligence.</p></header>
    <section className="clean-panel directory-panel"><div className="panel-heading"><div><h2>Client accounts</h2><p>Grouped ClickUp folders are shown as one client.</p></div><span className="panel-count">{groups.length}</span></div>
      <div className="directory-grid">{groups.map(group => <a className="directory-entry" key={group.canonical.slug} href={`/clients/${group.canonical.slug}`}><span className="entity-avatar">{group.canonical.name[0]?.toUpperCase() ?? '?'}</span><span><strong>{group.canonical.name}</strong><small>{group.folders.reduce((sum,folder) => sum + (byId.get(folder.id) ?? 0),0).toLocaleString()} imported tasks</small></span><span aria-hidden="true">↗</span></a>)}</div>
    </section>
  </main>;
}
