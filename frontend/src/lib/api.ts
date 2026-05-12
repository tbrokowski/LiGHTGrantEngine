/**
 * API client — all calls to the FastAPI backend.
 * Base URL configured via NEXT_PUBLIC_API_URL environment variable.
 */
import axios from 'axios';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export const api = axios.create({
  baseURL: `${API_BASE}/api/v1`,
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT token from localStorage
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('access_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Auth ────────────────────────────────────────────────────────────────────
export const auth = {
  login: (email: string, password: string) =>
    api.post('/auth/token', new URLSearchParams({ username: email, password }), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }),
  me: () => api.get('/auth/me'),
};

// ── Opportunities ────────────────────────────────────────────────────────────
export const opportunities = {
  list: (params?: Record<string, unknown>) => api.get('/opportunities/', { params }),
  queue: () => api.get('/opportunities/queue'),
  get: (id: string) => api.get(`/opportunities/${id}`),
  create: (data: Record<string, unknown>) => api.post('/opportunities/', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/opportunities/${id}`, data),
  submitReview: (id: string, data: Record<string, unknown>) => api.post(`/opportunities/${id}/reviews`, data),
  convertToGrant: (id: string) => api.post(`/opportunities/${id}/convert-to-grant`),
};

// ── Active Grants ────────────────────────────────────────────────────────────
export const grants = {
  list: (params?: Record<string, unknown>) => api.get('/grants/', { params }),
  get: (id: string) => api.get(`/grants/${id}`),
  create: (data: Record<string, unknown>) => api.post('/grants/', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/grants/${id}`, data),
  createTask: (grantId: string, data: Record<string, unknown>) => api.post(`/grants/${grantId}/tasks`, data),
  applyTemplate: (grantId: string) => api.post(`/grants/${grantId}/apply-template`),
  updateTask: (grantId: string, taskId: string, data: Record<string, unknown>) =>
    api.patch(`/grants/${grantId}/tasks/${taskId}`, data),
};

// ── Archive ──────────────────────────────────────────────────────────────────
export const archive = {
  list: (params?: Record<string, unknown>) => api.get('/archive/', { params }),
  get: (id: string) => api.get(`/archive/${id}`),
  create: (data: Record<string, unknown>) => api.post('/archive/', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/archive/${id}`, data),
};

// ── Sources ──────────────────────────────────────────────────────────────────
export const sources = {
  list: () => api.get('/sources/'),
  create: (data: Record<string, unknown>) => api.post('/sources/', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/sources/${id}`, data),
  runNow: (id: string) => api.post(`/sources/${id}/run-now`),
};

// ── Tasks ────────────────────────────────────────────────────────────────────
export const tasks = {
  myTasks: () => api.get('/tasks/my-tasks'),
  overdue: () => api.get('/tasks/overdue'),
  dueSoon: (days?: number) => api.get('/tasks/due-soon', { params: { days } }),
};

// ── Analytics ────────────────────────────────────────────────────────────────
export const analytics = {
  dashboard: () => api.get('/analytics/dashboard'),
  pipeline: () => api.get('/analytics/pipeline'),
  successRate: () => api.get('/analytics/success-rate'),
};

// ── Notifications ────────────────────────────────────────────────────────────
export const notifications = {
  list: () => api.get('/notifications/'),
  markRead: (id: string) => api.post(`/notifications/${id}/read`),
};

// ── AI Assistant ─────────────────────────────────────────────────────────────
export const ai = {
  analyzeCall: (data: { opportunity_id: string; call_text?: string }) =>
    api.post('/ai/analyze-call', data),
  scoreOpportunity: (opportunityId: string) =>
    api.post(`/ai/score-opportunity?opportunity_id=${opportunityId}`),
  goNoGo: (data: { opportunity_id: string; team_context?: string }) =>
    api.post('/ai/go-no-go', data),
  proposalOutline: (data: { grant_id: string; team_preferences?: string }) =>
    api.post('/ai/proposal-outline', data),
  draftSection: (data: Record<string, unknown>) => api.post('/ai/draft-section', data),
  complianceCheck: (data: { grant_id: string; proposal_draft: string }) =>
    api.post('/ai/compliance-check', data),
  findSimilarGrants: (data: { query: string; section_type?: string; top_k?: number }) =>
    api.post('/ai/find-similar-grants', data),
  analyzeFeedback: (data: Record<string, unknown>) => api.post('/ai/analyze-feedback', data),
  processForMemory: (archiveId: string) =>
    api.post('/ai/process-for-memory', { archive_id: archiveId }),
};
