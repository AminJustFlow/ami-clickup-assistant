import crypto from 'node:crypto';
import { prisma } from '@/lib/db/prisma';

export async function POST(request: Request) {
  const raw = await request.text();
  const secret = process.env.CLICKUP_WEBHOOK_SECRET;
  if (!secret) return new Response('Webhook secret not configured', { status: 500 });
  const signature = request.headers.get('x-signature') ?? '';
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const a = Buffer.from(signature); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return new Response('Invalid signature', { status: 401 });
  const payload = JSON.parse(raw);
  const eventKey = `${payload.webhook_id ?? 'unknown'}:${payload.history_items?.[0]?.id ?? payload.event ?? 'event'}:${payload.task_id ?? ''}`;
  try {
    await prisma.taskEvent.create({ data: { eventKey, eventType: payload.event ?? 'unknown', rawPayload: payload, occurredAt: new Date() } });
  } catch (e: any) {
    if (e?.code === 'P2002') return Response.json({ ok: true, duplicate: true });
    throw e;
  }
  // V1: event is persisted. Next milestone will enqueue/debounce task refresh + intelligence analysis.
  return Response.json({ ok: true });
}
