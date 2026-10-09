'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';

export async function setAttentionDecision(formData: FormData) {
  const taskId = Number(formData.get('taskId'));
  const decision = formData.get('decision');
  const fingerprint = formData.get('fingerprint');
  const returnTo = formData.get('returnTo');
  const safeReturn = typeof returnTo === 'string' && /^\/attention(?:\?(?!\/)[^#]*)?$/.test(returnTo)
    ? returnTo : '/attention';

  if (!Number.isSafeInteger(taskId) || taskId < 1 ||
      (decision !== 'REVIEWED' && decision !== 'DISMISSED') ||
      typeof fingerprint !== 'string' || fingerprint.length > 256) {
    throw new Error('Invalid inbox review request.');
  }

  const task = await prisma.task.findFirst({
    where: { id: taskId, deleted: false },
    select: { intelligence: { select: { needsAmi: true, agentState: true, sourceFingerprint: true, analyzedAt: true } } }
  });
  const intel = task?.intelligence;
  const currentFingerprint = intel?.sourceFingerprint ?? `analyzed:${intel?.analyzedAt?.toISOString() ?? 'unknown'}`;
  if (!intel?.needsAmi || intel.agentState === 'COMPLETED' || currentFingerprint !== fingerprint) {
    redirect('/attention?notice=stale');
  }

  await prisma.attentionDisposition.upsert({
    where: { taskId },
    create: { taskId, decision, sourceFingerprint: currentFingerprint },
    update: { decision, sourceFingerprint: currentFingerprint }
  });
  revalidatePath('/attention');
  redirect(safeReturn);
}
