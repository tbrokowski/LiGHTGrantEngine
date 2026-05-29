/**
 * Tracks in-progress call analysis jobs (background Celery on the server).
 * Survives SPA navigation via in-memory flag and page refresh via localStorage.
 */
import { grantWriting } from '@/lib/api';

const MAX_STALE_MS = 20 * 60 * 1000;
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_MS = 15 * 60 * 1000;

const analyzing = new Set<string>();

function lsKey(grantId: string): string {
  return `call_analysis_${grantId}`;
}

export function startAnalysis(grantId: string): void {
  analyzing.add(grantId);
  try {
    localStorage.setItem(lsKey(grantId), JSON.stringify({ status: 'running', startedAt: Date.now() }));
  } catch {
    // ignore
  }
}

export function completeAnalysis(grantId: string): void {
  analyzing.delete(grantId);
  try {
    localStorage.removeItem(lsKey(grantId));
  } catch {
    // ignore
  }
}

export function failAnalysis(grantId: string): void {
  analyzing.delete(grantId);
  try {
    localStorage.removeItem(lsKey(grantId));
  } catch {
    // ignore
  }
}

export function isMarkedAnalyzing(grantId: string): boolean {
  if (analyzing.has(grantId)) return true;
  try {
    const raw = localStorage.getItem(lsKey(grantId));
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { status: string; startedAt: number };
    if (parsed.status !== 'running') return false;
    if (Date.now() - parsed.startedAt > MAX_STALE_MS) {
      localStorage.removeItem(lsKey(grantId));
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export type CallAnalysisStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface AIThinkingStepData {
  id: string;
  label: string;
  status: 'done' | 'active' | 'pending' | 'error';
  detail?: string;
  subSteps?: string[];
}

export interface WritingStatusPayload {
  call_analysis?: Record<string, unknown>;
  call_requirements?: string;
  call_analysis_status?: CallAnalysisStatus;
  call_analysis_error?: string | null;
  call_analysis_steps?: AIThinkingStepData[];
  has_call_analysis?: boolean;
  has_draft?: boolean;
  overview_figure_url?: string | null;
  overview_figure_alt?: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll /writing/status until analysis completes, fails, or times out.
 */
export async function pollCallAnalysisUntilDone(
  grantId: string,
  onProgress?: (data: WritingStatusPayload) => void,
): Promise<WritingStatusPayload> {
  const started = Date.now();
  while (Date.now() - started < MAX_POLL_MS) {
    const res = await grantWriting.status(grantId);
    const data = res.data as WritingStatusPayload;
    onProgress?.(data);

    const status = data.call_analysis_status || 'idle';
    if (
      status === 'completed' ||
      (status === 'idle' && data.has_call_analysis && data.call_analysis)
    ) {
      completeAnalysis(grantId);
      return data;
    }
    if (status === 'failed') {
      failAnalysis(grantId);
      throw new Error(data.call_analysis_error || 'Call analysis failed');
    }
    await sleep(POLL_INTERVAL_MS);
  }
  // Soft timeout — job may still be running on the worker; keep localStorage flag
  // so a refresh resumes polling. Surface a non-fatal message instead of an error.
  const SOFT_TIMEOUT_MSG = 'Analysis is taking longer than expected. The job is still running in the background — you can leave this page and refresh later to see the results.';
  throw new Error(SOFT_TIMEOUT_MSG);
}

/** Start analysis: POST enqueue + poll until done. */
export async function runCallAnalysisJob(
  grantId: string,
  trigger: () => Promise<unknown>,
  onProgress?: (data: WritingStatusPayload) => void,
): Promise<WritingStatusPayload> {
  startAnalysis(grantId);
  try {
    await trigger();
    return await pollCallAnalysisUntilDone(grantId, onProgress);
  } catch (err) {
    // POST may fail with network error while worker still runs — try polling briefly
    if (isMarkedAnalyzing(grantId) || formatAnalysisError(err).includes('Connection lost')) {
      try {
        return await pollCallAnalysisUntilDone(grantId, onProgress);
      } catch (pollErr) {
        failAnalysis(grantId);
        throw pollErr;
      }
    }
    failAnalysis(grantId);
    throw err;
  }
}

export function formatAnalysisError(err: unknown): string {
  const ax = err as { code?: string; message?: string; response?: { data?: { detail?: string } } };
  if (!ax.response && (ax.code === 'ERR_NETWORK' || ax.message === 'Network Error')) {
    return 'Connection lost while analyzing. The job may still be running — wait a moment or refresh the page.';
  }
  return ax.response?.data?.detail || ax.message || 'Call analysis failed. Please try again.';
}
