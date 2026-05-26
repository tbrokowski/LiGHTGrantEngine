/**
 * Resolve the backend API origin for browser and SSR requests.
 * NEXT_PUBLIC_API_URL must be an absolute URL in production; bare hostnames
 * (e.g. backend-production-ebb3.up.railway.app) are normalized to https.
 */
export function getApiBaseUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').trim();
  if (!raw) return 'http://localhost:8000';

  if (/^https?:\/\//i.test(raw)) {
    return raw.replace(/\/+$/, '');
  }

  // Avoid relative paths like "/backend..." which would hit the frontend host.
  const host = raw.replace(/^\/+/, '').replace(/\/+$/, '');
  return `https://${host}`;
}
