/**
 * Helpers to keep a `has_session` cookie in sync with the JWT stored in
 * localStorage.  The cookie is NOT httpOnly so it can be set from the browser,
 * but it lets the Next.js middleware (which runs server-side before the page is
 * rendered) know that a session exists and redirect unauthenticated visitors to
 * /login without a client-side flash.
 *
 * The actual JWT is still read from localStorage for API calls.
 *
 * Note: A full httpOnly migration would require the backend to set Set-Cookie
 * on /auth/token and all SSE endpoints to use `credentials: 'include'`.  That
 * is tracked separately; this is the incremental step.
 */

const COOKIE_NAME = 'has_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days (same lifetime as the JWT)

export function setAuthSession(token: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('access_token', token);
  // Set a simple presence cookie the middleware can read
  document.cookie = `${COOKIE_NAME}=1; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Strict`;
}

export function clearAuthSession(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('access_token');
  document.cookie = `${COOKIE_NAME}=; path=/; max-age=0; SameSite=Strict`;
}
