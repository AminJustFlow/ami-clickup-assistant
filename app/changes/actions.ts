'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const KEY = 'ami_intelligence_last_checked';

export async function markDigestChecked() {
  const jar = await cookies();
  jar.set(KEY, new Date().toISOString(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365
  });
  redirect('/changes');
}
