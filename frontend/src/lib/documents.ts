import { api } from './api';

/**
 * Open a document's stored file (PDF, DOCX, etc.) in a new tab via presigned URL redirect.
 */
export async function openDocumentContent(docId: string, fileName?: string): Promise<boolean> {
  try {
    const res = await api.get(`/documents/${docId}/content`, {
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
    });
    const targetUrl = res.headers.location || res.request?.responseURL;
    if (targetUrl) {
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
      return true;
    }
    return false;
  } catch (err: unknown) {
    const axiosErr = err as { response?: { headers?: { location?: string } } };
    const redirect = axiosErr.response?.headers?.location;
    if (redirect) {
      window.open(redirect, '_blank', 'noopener,noreferrer');
      return true;
    }
    console.error('Failed to open document', fileName ?? docId, err);
    return false;
  }
}
