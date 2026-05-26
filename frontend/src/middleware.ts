import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Route protection middleware.
 *
 * All routes under /(app)/* are protected. We check for the `has_session`
 * cookie (a plain cookie set by the client after successful login/register).
 * If the cookie is absent, the user is redirected to /login.
 *
 * Note: The actual JWT is stored in localStorage and attached by the axios
 * interceptor on every API call. The `has_session` cookie is purely a
 * presence signal for this middleware so we can avoid a client-side flash
 * on unauthenticated page loads.
 *
 * Public routes (login, register, invite, root) are always accessible.
 */

const PUBLIC_PATHS = ['/login', '/register', '/invite', '/verify-email'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  // Allow Next.js internals and static assets
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.includes('.') // static files (favicon, images, etc.)
  ) {
    return NextResponse.next();
  }

  // Allow the root path
  if (pathname === '/') {
    return NextResponse.next();
  }

  // Check for session cookie
  const hasSession = request.cookies.get('has_session');
  if (!hasSession) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
