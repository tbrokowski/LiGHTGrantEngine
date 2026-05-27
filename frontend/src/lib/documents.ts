import { api } from './api';

/**
 * Open a document's stored file (PDF, DOCX, etc.) in a new tab via presigned URL.
 * The backend returns {"url": presignedUrl} or {"text": parsedText} as JSON.
 */
export async function openDocumentContent(docId: string, fileName?: string): Promise<boolean> {
  try {
    const res = await api.get(`/documents/${docId}/content`);
    const url: string | undefined = res.data?.url;
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
      return true;
    }
    const text: string | undefined = res.data?.text;
    if (text) {
      const blob = new Blob([text], { type: 'text/plain' });
      window.open(URL.createObjectURL(blob), '_blank', 'noopener,noreferrer');
      return true;
    }
    return false;
  } catch (err) {
    console.error('Failed to open document', fileName ?? docId, err);
    return false;
  }
}
