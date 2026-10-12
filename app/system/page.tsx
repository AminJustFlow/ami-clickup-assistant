import { prisma } from '@/lib/db/prisma';
import { AppNav } from '../components/app-nav';

export const dynamic = 'force-dynamic';

export default async function SystemStatus() {
  const [syncState, workers, jobs, usage, clients] = await Promise.all([
    prisma.client.aggregate({ where: { active: true }, _min: { lastSyncedAt: true } }),
    prisma.workerHeartbeat.findMany({ orderBy: { name: 'asc' } }),
    prisma.analysisJob.groupBy({ by: ['status'], _count: true }),
    prisma.aiBudgetDay.findUnique({ where: { day: new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z') } }),
    prisma.client.count({ where: { active: true } })
  ]);
  const lastSync = syncState._min.lastSyncedAt;
  return <main className="ops-shell dashboard-shell" id="main-content">
    <AppNav current="overview" />
    <header className="detail-hero"><p className="eyebrow">OPERATIONS / SYSTEM</p><h1>System status</h1><p>Synchronization, background workers, and estimated AI usage. These diagnostics are separate from Ami's daily decisions.</p></header>
    <div className="system-status-grid">
      <section className="clean-panel"><div className="panel-heading"><div><p className="eyebrow">CLICKUP</p><h2>Synchronization</h2></div></div>
        <div className="system-status-content"><p><strong>{clients}</strong> active imported folders</p><p>Oldest successful sync: {lastSync ? lastSync.toLocaleString('en-US', { timeZone: 'America/New_York' }) + ' ET' : 'Not yet synced'}</p><p className="dashboard-note">An old timestamp may indicate one or more clients have not synchronized recently.</p></div></section>
      <section className="clean-panel"><div className="panel-heading"><div><p className="eyebrow">AUTOMATION</p><h2>Worker health</h2></div></div>
        <div className="system-status-content">{workers.length ? workers.map(worker => <p key={worker.name}><strong>{worker.name}</strong>: {worker.status} · last seen {worker.lastSeenAt.toLocaleString('en-US', { timeZone: 'America/New_York' })} ET{worker.lastError ? <span className="system-error"> · {worker.lastError}</span> : null}</p>) : <p>No worker heartbeat recorded.</p>}</div></section>
      <section className="clean-panel"><div className="panel-heading"><div><p className="eyebrow">QUEUE</p><h2>Analysis jobs</h2></div></div><div className="system-status-content">{jobs.map(job => <p key={job.status}>{job.status.replaceAll('_', ' ').toLowerCase()}: <strong>{job._count}</strong></p>)}</div></section>
      <section className="clean-panel"><div className="panel-heading"><div><p className="eyebrow">UTC TODAY</p><h2>AI usage estimates</h2></div></div>
        <div className="system-status-content"><p>Reserved: <strong>${Number(usage?.reservedUsd ?? 0).toFixed(4)}</strong></p><p>Estimated actual: <strong>${Number(usage?.actualEstimatedUsd ?? 0).toFixed(4)}</strong></p><p>Tokens: {String(usage?.inputTokens ?? 0)} input / {String(usage?.outputTokens ?? 0)} output</p><p className="dashboard-note">These figures are application estimates, not guaranteed provider billing limits.</p></div></section>
    </div>
  </main>;
}
