'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { DAILY_BRIEF_COOKIE } from '@/lib/brief/daily-brief';

export async function markBriefReviewed() {
  const now = new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('Unable to record the brief review time.');
  const jar = await cookies();
  jar.set(DAILY_BRIEF_COOKIE, now.toISOString(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365
  });
  redirect('/');
}
