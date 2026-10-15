'use client';

import { useState } from 'react';

type ClientWorkload = { id: number; name: string; open: number; overdue: number; attention: number };

export function EmployeeClientDirectory({ clients, employeeId }: { clients: ClientWorkload[]; employeeId: number }) {
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState('');
  const remaining = clients.slice(8);
  const matches = remaining.filter(client => client.name.toLowerCase().includes(search.trim().toLowerCase()));
  const link = (client: ClientWorkload) => `/employees/${employeeId}?client=${client.id}#employee-task-list`;
  const metrics = (client: ClientWorkload) => <span className="employee-client-metrics">
    <span>{client.open} open</span><span>{client.overdue} past due</span>
    {client.attention > 0 && <span>{client.attention} Needs Ami</span>}
  </span>;

  return <div className="employee-directory">
    {clients.length > 0 ? <div className="employee-directory-featured">
      {clients.slice(0, 8).map(client => <a key={client.id} href={link(client)} className="employee-directory-card">
        <strong>{client.name}</strong>{metrics(client)}
      </a>)}
    </div> : <p className="simple-empty">No open assignments found.</p>}
    {remaining.length > 0 && <div className="employee-directory-more">
      <button type="button" className="employee-directory-toggle" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
        {expanded ? 'Hide other clients' : `Browse ${remaining.length} other clients`} <span aria-hidden="true">{expanded ? '−' : '+'}</span>
      </button>
      {expanded && <div className="employee-directory-expanded">
        <label className="employee-directory-search">Find a client
          <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search remaining clients…" />
        </label>
        <p className="employee-directory-result">{matches.length} of {remaining.length} other clients</p>
        <div className="employee-directory-list">
          {matches.slice(0, 12).map(client => <a key={client.id} href={link(client)} className="employee-directory-row">
            <strong>{client.name}</strong>{metrics(client)}<span aria-hidden="true">→</span>
          </a>)}
        </div>
        {matches.length > 12 && <p className="employee-directory-result">Showing the first 12 matches. Search by client name to find others.</p>}
        {matches.length === 0 && <p className="simple-empty">No matching clients.</p>}
      </div>}
    </div>}
  </div>;
}
