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
  let payload: Record<string, any>;
  try { payload = JSON.parse(raw); } catch { return new Response('Invalid JSON', { status: 400 }); }
  const eventKey = crypto.createHash('sha256').update(raw).digest('hex');
  try {
    await prisma.taskEvent.create({ data: { eventKey, eventType: payload.event ?? 'unknown', rawPayload: payload, occurredAt: new Date() } });
  } catch (e: any) {
    if (e?.code === 'P2002') return Response.json({ ok: true, duplicate: true });
    throw e;
  }
  // The refresh worker consumes this event and only acknowledges it after successful refresh.
  return Response.json({ ok: true });
}
