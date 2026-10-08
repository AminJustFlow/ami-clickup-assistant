'use server';

import { prisma } from '@/lib/db/prisma';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export async function saveReview(formData: FormData) {
  const taskId = Number(formData.get('taskId'));
  const verdict = String(formData.get('verdict') ?? '');
  const notes = String(formData.get('notes') ?? '').trim();
  const filter = String(formData.get('filter') ?? 'disagreements');
  if (!Number.isSafeInteger(taskId) || taskId < 1) throw new Error('Invalid task');
  if (!['CORRECT', 'INCORRECT', 'INVESTIGATE'].includes(verdict)) throw new Error('Invalid verdict');
  if (notes.length > 2000) throw new Error('Notes exceed 2000 characters');
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { intelligence: true } });
  if (!task || !task.intelligence) throw new Error('Task intelligence not found');
  await prisma.intelligenceReview.upsert({
    where: { taskId },
    create: { taskId, verdict, notes: notes || null, analyzedAt: task.intelligence.analyzedAt },
    update: { verdict, notes: notes || null, analyzedAt: task.intelligence.analyzedAt }
  });
  revalidatePath('/review');
  redirect('/review?filter=' + (['all', 'critical', 'disagreements'].includes(filter) ? filter : 'disagreements') + '#task-' + taskId);
}
