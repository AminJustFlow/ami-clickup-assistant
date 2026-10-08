'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type TaskDetails = {
  id: number;
  name: string;
  description: string | null;
  clickupUrl: string | null;
  clickupStatus: string | null;
  clickupUpdatedAt: string | null;
  dueDate: string | null;
  client: { name: string; slug: string };
  list: { name: string };
  intelligence: {
    agentState: string;
    needsAmi: boolean;
    amiAction: string | null;
    currentSummary: string | null;
    waitingOnName: string | null;
    waitingOnType: string;
    lastMeaningfulChange: string | null;
    lastMeaningfulChangeAt: string | null;
    confidence: number | null;
    analyzedAt: string | null;
  } | null;
  assignees: string[];
  comments: { id: number; authorName: string | null; body: string; clickupCreatedAt: string | null }[];
};

function formatDate(value: string | null): string {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function stateLabel(state: string | undefined) {
  if (!state) return 'Not analyzed';
  return state.toLowerCase().replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase());
}

export function TaskDetailsButton({ taskId, label = 'View details' }: { taskId: number; label?: string }) {
  const [open, setOpen] = useState(false);
  const [task, setTask] = useState<TaskDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setTask(null);
    fetch(`/api/tasks/${taskId}/details`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('Unable to load task details. Please try again.');
        return response.json() as Promise<TaskDetails>;
      })
      .then(data => { if (!controller.signal.aborted) setTask(data); })
      .catch(() => { if (!controller.signal.aborted) setError('Unable to load task details. Please try again.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, taskId]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
      if (event.key !== 'Tab') return;
      const dialog = closeRef.current?.closest('[role="dialog"]');
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], summary, [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      triggerRef.current?.focus();
    };
  }, [open]);

  return <>
    <button ref={triggerRef} type="button" className="task-details-trigger" onClick={() => setOpen(true)} aria-haspopup="dialog">{label} <span aria-hidden="true">→</span></button>
    {mounted && open && createPortal(
      <div className="task-drawer-overlay" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}>
        <section className="task-drawer" role="dialog" aria-modal="true" aria-label={task ? `Task details: ${task.name}` : 'Task details'} aria-busy={loading}>
          <header className="task-drawer-header">
            <div><p className="eyebrow">TASK DETAILS</p><span>{task?.client.name || 'Just Flow Intelligence'}</span></div>
            <button ref={closeRef} type="button" className="task-drawer-close" onClick={() => setOpen(false)} aria-label="Close task details">×</button>
          </header>
          <div className="task-drawer-body">
            {loading && <p role="status" className="task-drawer-message">Loading task details…</p>}
            {error && <div role="alert" className="task-drawer-message"><p>{error}</p><button type="button" onClick={() => { setOpen(false); requestAnimationFrame(() => setOpen(true)); }}>Try again</button></div>}
            {task && <>
              <div className="task-drawer-title">
                <span className="status-pill">{stateLabel(task.intelligence?.agentState)}</span>
                <h2>{task.name}</h2>
                <p>{task.client.name} · {task.list.name}</p>
              </div>

              {task.intelligence?.needsAmi && <section className="task-drawer-action">
                <p className="next-step-label">What Ami needs to do</p>
                <p>{task.intelligence.amiAction || 'Review this task and decide on the next step.'}</p>
              </section>}

              <section className="task-drawer-section">
                <h3>Current situation</h3>
                <p>{task.intelligence?.currentSummary || 'No AI summary available for this task yet.'}</p>
              </section>

              <section className="task-drawer-section">
                <h3>Who's responsible?</h3>
                <div className="task-drawer-facts">
                  <div><span>Assigned to</span><strong>{task.assignees.length ? task.assignees.join(', ') : 'Unassigned'}</strong></div>
                  <div><span>Waiting on</span><strong>{task.intelligence?.waitingOnName || (task.intelligence?.waitingOnType && task.intelligence.waitingOnType !== 'NONE' ? stateLabel(task.intelligence.waitingOnType) + ' (name not specified)' : 'Nobody identified')}</strong></div>
                  <div><span>Due date</span><strong>{task.dueDate ? formatDate(task.dueDate) : 'No due date'}</strong></div>
                </div>
              </section>

              <section className="task-drawer-section">
                <h3>Recent ClickUp comments <span className="task-drawer-count">{task.comments.length}</span></h3>
                {task.comments.length ? <div className="task-drawer-comments">{task.comments.map(comment => <div className="task-drawer-comment" key={comment.id}>
                  <div className="comment-byline"><strong>{comment.authorName?.trim() || 'Unknown author'}</strong><small>{formatDate(comment.clickupCreatedAt)}</small></div>
                  <p>{comment.body}</p>
                </div>)}</div> : <p>No comments available.</p>}
                {task.comments.length === 10 && <small className="task-drawer-muted">Showing the 10 most recent comments.</small>}
              </section>

              <details className="task-drawer-evidence">
                <summary>More context and AI evidence</summary>
                <dl>
                  <dt>ClickUp status</dt><dd>{task.clickupStatus || 'Not available'}</dd>
                  <dt>Last ClickUp update</dt><dd>{formatDate(task.clickupUpdatedAt)}</dd>
                  <dt>Latest meaningful change</dt><dd>{task.intelligence?.lastMeaningfulChange || 'Not available'}</dd>
                  <dt>AI analyzed</dt><dd>{formatDate(task.intelligence?.analyzedAt || null)}</dd>
                </dl>
                {task.description && <div className="task-drawer-description"><h4>Task description</h4><p>{task.description}</p></div>}
              </details>
            </>}
          </div>
          <footer className="task-drawer-footer">
            {task?.clickupUrl && <a href={task.clickupUrl} target="_blank" rel="noopener noreferrer" className="task-drawer-primary">Open in ClickUp ↗</a>}
            <button type="button" className="task-drawer-secondary" onClick={() => setOpen(false)}>Close</button>
          </footer>
        </section>
      </div>,
      document.body
    )}
  </>;
}
