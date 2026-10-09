import { NextRequest, NextResponse } from 'next/server';

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === '/api/health' || path === '/api/webhooks/clickup') return NextResponse.next();
  const user = process.env.APP_AUTH_USER;
  const password = process.env.APP_AUTH_PASSWORD;
  if (!user || !password) return new NextResponse('Application authentication is not configured', { status: 503 });
  const header = request.headers.get('authorization');
  if (header?.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator >= 0 && decoded.slice(0, separator) === user && decoded.slice(separator + 1) === password) return NextResponse.next();
  }
  return new NextResponse('Authentication required', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Ami Assistant", charset="UTF-8"' } });
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp)$).*)'] };
