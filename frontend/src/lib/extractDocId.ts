/** Extract document ID if url is our internal content/stream endpoint, else null. */
export function extractDocId(url: string): string | null {
  const m = url.match(/\/documents\/([^/]+)\/(?:content|stream)/);
  return m ? m[1] : null;
}
