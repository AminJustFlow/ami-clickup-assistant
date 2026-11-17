'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { workday } from '@/lib/brief/workday';

export async function markBriefReviewed() {
  const current = workday();
  await prisma.workdayBrief.upsert({
    where: { day: current.day },
    create: { day: current.day, completedAt: new Date() },
    update: { completedAt: new Date() }
  });
  revalidatePath('/');
  redirect('/');
}

export async function markBriefItemDone(formData: FormData) {
  const itemKey = String(formData.get('itemKey') ?? '');
  const taskId = Number(formData.get('taskId'));
  const fingerprint = String(formData.get('fingerprint') ?? '').slice(0, 256) || null;
  if (!/^[A-Z_]+:\d+:[\w:.-]+$/.test(itemKey) || !Number.isSafeInteger(taskId) || taskId < 1) throw new Error('Invalid brief item.');
  const current = workday();
  await prisma.briefItemReview.upsert({
    where: { day_itemKey: { day: current.day, itemKey } },
    create: { day: current.day, itemKey, taskId, sourceFingerprint: fingerprint, decision: 'DONE_TODAY' },
    update: { taskId, sourceFingerprint: fingerprint, decision: 'DONE_TODAY', reviewedAt: new Date() }
  });
  revalidatePath('/');
  redirect('/');
}

export async function markEntityReviewed(formData: FormData) {
  const entityType = String(formData.get('entityType') ?? '');
  const entityKey = String(formData.get('entityKey') ?? '').slice(0, 150);
  const returnTo = String(formData.get('returnTo') ?? '');
  if (!['CLIENT', 'EMPLOYEE'].includes(entityType) || !entityKey || !/^\/(clients|employees)\/[\w%-]+$/.test(returnTo)) throw new Error('Invalid review checkpoint.');
  await prisma.entityReviewCheckpoint.upsert({
    where: { entityType_entityKey: { entityType, entityKey } },
    create: { entityType, entityKey }, update: { reviewedAt: new Date() }
  });
  revalidatePath(returnTo);
  redirect(returnTo);
}
