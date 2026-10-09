import { prisma } from '@/lib/db/prisma';
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ ok: true, service: 'ami-clickup-assistant', database: 'ok' });
  } catch {
    return Response.json({ ok: false, service: 'ami-clickup-assistant', database: 'unavailable' }, { status: 503 });
  }
}
