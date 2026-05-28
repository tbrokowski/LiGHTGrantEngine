/**
 * API client — all calls to the FastAPI backend.
 * Base URL configured via NEXT_PUBLIC_API_URL environment variable.
 */
import axios from 'axios';
import { getApiBaseUrl } from './api-base-url';

const API_BASE = getApiBaseUrl();

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

// Redirect to login on 401
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('access_token');
      document.cookie = 'has_session=; path=/; max-age=0; SameSite=Strict';
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

// ── Auth ────────────────────────────────────────────────────────────────────
export const auth = {
  login: (email: string, password: string) =>
    api.post('/auth/token', new URLSearchParams({ username: email, password }), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }),
  register: (data: {
    name: string;
    email: string;
    password: string;
    institution_id?: string;
    institution_name?: string;
    institution_domain?: string;
    join_message?: string;
  }) => api.post('/auth/register', data),
  me: () => api.get('/auth/me'),
  searchInstitutions: (q?: string) => api.get('/auth/institutions', { params: { q } }),
  validateInvite: (token: string) => api.get(`/auth/invite/${token}`),
  acceptInvite: (data: { token: string; name: string; password: string }) =>
    api.post('/auth/accept-invite', data),
  sendVerification: () => api.post('/auth/send-verification'),
  verifyEmail: (token: string) => api.get('/auth/verify-email', { params: { token } }),
  googleStart: () => api.get('/auth/google'),
  googleDisconnect: () => api.post('/auth/google/disconnect'),
};

// ── Users ────────────────────────────────────────────────────────────────────
// (additional methods beyond the existing users object)
export const userOnboarding = {
  complete: (data: {
    grant_categories?: string[];
    keywords?: string[];
    workflow_type?: string;
  }) => api.post('/users/me/onboarding/complete', data),
  getAiUsage: () => api.get('/users/me/ai-usage'),
};

// ── Organizations ─────────────────────────────────────────────────────────────
export const organizations = {
  list: (q?: string) => api.get('/organizations/', { params: { q } }),
  get: (id: string) => api.get(`/organizations/${id}`),
  create: (data: { name: string; domain?: string }) => api.post('/organizations/', data),
  members: (id: string) => api.get(`/organizations/${id}/members`),
  updateMember: (orgId: string, userId: string, data: {
    role: string;
    institution_role?: string;
    module_permissions?: Record<string, boolean>;
  }) =>
    api.patch(`/organizations/${orgId}/members/${userId}`, data),
  removeMember: (orgId: string, userId: string) =>
    api.delete(`/organizations/${orgId}/members/${userId}`),
  orgGrants: (institutionId: string) =>
    api.get(`/organizations/${institutionId}/grants`),
  getMemberGrantMemberships: (orgId: string, userId: string) =>
    api.get(`/organizations/${orgId}/members/${userId}/grant-memberships`),
  setMemberGrantMemberships: (orgId: string, userId: string, grantIds: string[]) =>
    api.put(`/organizations/${orgId}/members/${userId}/grant-memberships`, { grant_ids: grantIds }),
  joinRequests: (id: string) => api.get(`/organizations/${id}/join-requests`),
  approveRequest: (orgId: string, reqId: string) =>
    api.post(`/organizations/${orgId}/join-requests/${reqId}/approve`),
  rejectRequest: (orgId: string, reqId: string) =>
    api.post(`/organizations/${orgId}/join-requests/${reqId}/reject`),
  generateAccessCode: (id: string) =>
    api.post(`/organizations/${id}/access-code/generate`),
  joinByCode: (code: string) => api.post('/organizations/join-by-code', { code }),
  invite: (orgId: string, data: { email: string; role: string }) =>
    api.post(`/organizations/${orgId}/invite`, data),
  requestToJoin: (orgId: string, message?: string) =>
    api.post(`/organizations/${orgId}/join-requests`, { institution_id: orgId, message }),
  getGrantProfile: (id: string) => api.get(`/organizations/${id}/grant-profile`),
  updateGrantProfile: (id: string, data: Record<string, unknown>) =>
    api.patch(`/organizations/${id}/grant-profile`, data),
  preseedStatus: (id: string) => api.get(`/organizations/${id}/preseed-status`),
  listOrgSources: (id: string) => api.get(`/organizations/${id}/sources`),
  toggleOrgSource: (orgId: string, sourceId: string, isEnabled: boolean) =>
    api.patch(`/organizations/${orgId}/sources/${sourceId}`, { is_enabled: isEnabled }),
  addOrgSource: (orgId: string, data: Record<string, unknown>) =>
    api.post(`/organizations/${orgId}/sources`, data),
  completeOnboarding: (id: string, data: Record<string, unknown>) =>
    api.post(`/organizations/${id}/onboarding/complete`, data),
  aiAugmentProfile: (id: string, data: { raw_interests: string; org_name?: string; description?: string }) =>
    api.post(`/organizations/${id}/onboarding/ai-augment`, data),
  triggerLlmRank: (id: string) =>
    api.post(`/organizations/${id}/llm-rank`),
};

// ── Users ────────────────────────────────────────────────────────────────────
export const users = {
  list: () => api.get('/users/'),
  get: (id: string) => api.get(`/users/${id}`),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/users/${id}`, data),
  deactivate: (id: string) => api.delete(`/users/${id}`),
  getGrantPreferences: () => api.get('/users/me/grant-preferences'),
  updateGrantPreferences: (data: Record<string, unknown>) =>
    api.patch('/users/me/grant-preferences', data),
};

// ── Opportunities ────────────────────────────────────────────────────────────
export const opportunities = {
  list: (params?: Record<string, unknown>) => api.get('/opportunities/', { params }),
  queue: (params?: { unread_only?: boolean }) => api.get('/opportunities/queue', { params }),
  queueCounts: () => api.get('/opportunities/queue/counts'),
  shortlist: () => api.get('/opportunities/shortlist'),
  orgShortlist: () => api.get('/opportunities/org-shortlist'),
  graphData: (params?: Record<string, unknown>) => api.get('/opportunities/graph-data', { params }),
  get: (id: string) => api.get(`/opportunities/${id}`),
  create: (data: Record<string, unknown>) => api.post('/opportunities/', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/opportunities/${id}`, data),
  submitReview: (id: string, data: Record<string, unknown>) => api.post(`/opportunities/${id}/reviews`, data),
  convertToGrant: (id: string) => api.post(`/opportunities/${id}/convert-to-grant`),
  markRead: (id: string) => api.post(`/opportunities/${id}/mark-read`),
  markUnread: (id: string) => api.post(`/opportunities/${id}/mark-unread`),
  addToShortlist: (id: string) => api.post(`/opportunities/${id}/add-to-shortlist`),
  removeFromShortlist: (id: string) => api.post(`/opportunities/${id}/remove-from-shortlist`),
  promoteToOrgShortlist: (id: string) => api.post(`/opportunities/${id}/promote-to-org-shortlist`),
  removeFromOrgShortlist: (id: string) => api.post(`/opportunities/${id}/remove-from-org-shortlist`),
};

// ── Active Grants ────────────────────────────────────────────────────────────
export const grants = {
  list: (params?: Record<string, unknown>) => api.get('/grants/', { params }),
  get: (id: string) => api.get(`/grants/${id}`),
  create: (data: Record<string, unknown>) => api.post('/grants/', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/grants/${id}`, data),
  updateStage: (id: string, data: { stage: string; notes?: string; award_amount?: number; lessons_learned?: string; outcome?: string }) =>
    api.patch(`/grants/${id}/stage`, data),
  updateReporting: (id: string, deadlines: unknown[]) =>
    api.patch(`/grants/${id}/reporting`, { reporting_deadlines: deadlines }),
  archive: (id: string) => api.post(`/grants/${id}/archive`),
  delete: (id: string) => api.delete(`/grants/${id}`),
  promote: (id: string) => api.post(`/grants/${id}/promote`),
  applyTemplate: (grantId: string) => api.post(`/grants/${grantId}/apply-template`),
  // Editor sections
  getSections: (grantId: string) => api.get(`/grants/${grantId}/sections`),
  upsertSection: (grantId: string, sectionId: string, data: Record<string, unknown>) =>
    api.put(`/grants/${grantId}/sections/${sectionId}`, data),
  deleteSection: (grantId: string, sectionId: string) =>
    api.delete(`/grants/${grantId}/sections/${sectionId}`),
  replaceAllSections: (grantId: string, sections: Record<string, unknown>) =>
    api.put(`/grants/${grantId}/sections`, { sections }),
  // Workspace summary
  workspaceSummary: (grantId: string) => api.get(`/grants/${grantId}/workspace-summary`),
  // Tasks (workspace)
  listTasks: (grantId: string, params?: Record<string, unknown>) =>
    api.get(`/grants/${grantId}/tasks`, { params }),
  createTask: (grantId: string, data: Record<string, unknown>) =>
    api.post(`/grants/${grantId}/tasks`, data),
  updateTask: (grantId: string, taskId: string, data: Record<string, unknown>) =>
    api.patch(`/grants/${grantId}/tasks/${taskId}`, data),
  deleteTask: (grantId: string, taskId: string) =>
    api.delete(`/grants/${grantId}/tasks/${taskId}`),
  // Milestones
  listMilestones: (grantId: string) => api.get(`/grants/${grantId}/milestones`),
  createMilestone: (grantId: string, data: Record<string, unknown>) =>
    api.post(`/grants/${grantId}/milestones`, data),
  updateMilestone: (grantId: string, milestoneId: string, data: Record<string, unknown>) =>
    api.patch(`/grants/${grantId}/milestones/${milestoneId}`, data),
  deleteMilestone: (grantId: string, milestoneId: string) =>
    api.delete(`/grants/${grantId}/milestones/${milestoneId}`),
  // Gantt
  listGantt: (grantId: string) => api.get(`/grants/${grantId}/gantt`),
  createGanttItem: (grantId: string, data: Record<string, unknown>) =>
    api.post(`/grants/${grantId}/gantt`, data),
  updateGanttItem: (grantId: string, itemId: string, data: Record<string, unknown>) =>
    api.patch(`/grants/${grantId}/gantt/${itemId}`, data),
  deleteGanttItem: (grantId: string, itemId: string) =>
    api.delete(`/grants/${grantId}/gantt/${itemId}`),
  generateGantt: (grantId: string) => api.post(`/grants/${grantId}/gantt/generate`),
  // Workspace sections (proposal tracker)
  listWorkspaceSections: (grantId: string) => api.get(`/grants/${grantId}/workspace-sections`),
  createWorkspaceSection: (grantId: string, data: Record<string, unknown>) =>
    api.post(`/grants/${grantId}/workspace-sections`, data),
  updateWorkspaceSection: (grantId: string, sectionId: string, data: Record<string, unknown>) =>
    api.patch(`/grants/${grantId}/workspace-sections/${sectionId}`, data),
  deleteWorkspaceSection: (grantId: string, sectionId: string) =>
    api.delete(`/grants/${grantId}/workspace-sections/${sectionId}`),
  // Checklist
  listChecklist: (grantId: string) => api.get(`/grants/${grantId}/checklist`),
  createChecklistItem: (grantId: string, data: Record<string, unknown>) =>
    api.post(`/grants/${grantId}/checklist`, data),
  updateChecklistItem: (grantId: string, itemId: string, data: Record<string, unknown>) =>
    api.patch(`/grants/${grantId}/checklist/${itemId}`, data),
  deleteChecklistItem: (grantId: string, itemId: string) =>
    api.delete(`/grants/${grantId}/checklist/${itemId}`),
  generateChecklist: (grantId: string) => api.post(`/grants/${grantId}/checklist/generate`),
  // Files
  listFiles: (grantId: string) => api.get(`/grants/${grantId}/files`),
  addFile: (grantId: string, data: Record<string, unknown>) =>
    api.post(`/grants/${grantId}/files`, data),
  updateFile: (grantId: string, fileId: string, data: Record<string, unknown>) =>
    api.patch(`/grants/${grantId}/files/${fileId}`, data),
  deleteFile: (grantId: string, fileId: string) =>
    api.delete(`/grants/${grantId}/files/${fileId}`),
  // Workspace partners
  listWorkspacePartners: (grantId: string) => api.get(`/grants/${grantId}/workspace-partners`),
  createWorkspacePartner: (grantId: string, data: Record<string, unknown>) =>
    api.post(`/grants/${grantId}/workspace-partners`, data),
  updateWorkspacePartner: (grantId: string, partnerId: string, data: Record<string, unknown>) =>
    api.patch(`/grants/${grantId}/workspace-partners/${partnerId}`, data),
  deleteWorkspacePartner: (grantId: string, partnerId: string) =>
    api.delete(`/grants/${grantId}/workspace-partners/${partnerId}`),
  addPartnerMaterial: (grantId: string, partnerId: string, data: Record<string, unknown>) =>
    api.post(`/grants/${grantId}/workspace-partners/${partnerId}/materials`, data),
  updatePartnerMaterial: (grantId: string, partnerId: string, materialId: string, data: Record<string, unknown>) =>
    api.patch(`/grants/${grantId}/workspace-partners/${partnerId}/materials/${materialId}`, data),
  deletePartnerMaterial: (grantId: string, partnerId: string, materialId: string) =>
    api.delete(`/grants/${grantId}/workspace-partners/${partnerId}/materials/${materialId}`),
  // Budget
  getBudget: (grantId: string) => api.get(`/grants/${grantId}/budget`),
  updateBudget: (grantId: string, data: Record<string, unknown>) =>
    api.patch(`/grants/${grantId}/budget`, data),
  parseBudgetSpreadsheet: (grantId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post(`/grants/${grantId}/budget/parse-spreadsheet`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  generateBudgetLineItems: (grantId: string) =>
    api.post(`/grants/${grantId}/budget/generate-line-items`),
  // Google Drive
  createDriveFolder: (grantId: string) =>
    api.post(`/grants/${grantId}/drive/create-folder`),
  // Unified editor document
  saveDocument: (grantId: string, contentHtml: string, syncSections = true) =>
    api.patch(`/grants/${grantId}/editor-document`, { content_html: contentHtml, sync_sections: syncSections }),
  // Google Docs sync
  getDocsStatus: (grantId: string) =>
    api.get(`/grants/${grantId}/docs/status`),
  createGoogleDoc: (grantId: string) =>
    api.post(`/grants/${grantId}/docs/create`),
  linkGoogleDoc: (grantId: string, docUrl: string) =>
    api.post(`/grants/${grantId}/docs/link`, { doc_url: docUrl }),
  unlinkGoogleDoc: (grantId: string) =>
    api.delete(`/grants/${grantId}/docs/unlink`),
  pushToGoogleDoc: (grantId: string) =>
    api.post(`/grants/${grantId}/docs/push`),
  pullFromGoogleDoc: (grantId: string) =>
    api.post(`/grants/${grantId}/docs/pull`),
  getGoogleDocContent: (grantId: string) =>
    api.get(`/grants/${grantId}/docs/content`),
  getDocsRemoteStatus: (grantId: string) =>
    api.get(`/grants/${grantId}/docs/remote-status`),
  // Activity log
  getActivity: (grantId: string, limit?: number) =>
    api.get(`/grants/${grantId}/activity`, { params: { limit } }),
  // Grant members / collaborators
  listMembers: (grantId: string) => api.get(`/grants/${grantId}/members`),
  inviteMember: (grantId: string, data: { email: string; role?: string }) =>
    api.post(`/grants/${grantId}/members`, data),
  removeMember: (grantId: string, memberId: string) =>
    api.delete(`/grants/${grantId}/members/${memberId}`),
};

// ── Grant Writing Studio ─────────────────────────────────────────────────────
export const grantWriting = {
  status: (grantId: string) => api.get(`/grants/${grantId}/writing/status`),
  saveIdea: (grantId: string, data: { grant_idea: string; writing_phase?: string }) =>
    api.patch(`/grants/${grantId}/writing/idea`, data),
  uploadCall: (grantId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post(`/grants/${grantId}/writing/upload-call`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  analyzeCall: (grantId: string) => api.post(`/grants/${grantId}/writing/analyze-call`),
  generateSkeleton: (grantId: string) => api.post(`/grants/${grantId}/writing/generate-skeleton`),
  updateSkeleton: (grantId: string, data: { proposal_skeleton: Record<string, unknown>; writing_phase?: string }) =>
    api.patch(`/grants/${grantId}/writing/skeleton`, data),
  runReview: (grantId: string) => api.post(`/grants/${grantId}/writing/review`),
  searchCitations: (grantId: string, data: { query: string; section_title?: string; max_results?: number }) =>
    api.post(`/grants/${grantId}/writing/citations/search`, data),
  listCitations: (grantId: string) => api.get(`/grants/${grantId}/writing/citations`),
};

// ── Documents ────────────────────────────────────────────────────────────────
export { openDocumentContent } from './documents';

// ── Archive ──────────────────────────────────────────────────────────────────
export const archive = {
  list: (params?: Record<string, unknown>) => api.get('/archive/', { params }),
  get: (id: string) => api.get(`/archive/${id}`),
  create: (data: Record<string, unknown>) => api.post('/archive/', data),
  createWithDocument: (formData: FormData) =>
    api.post('/archive/create-with-document', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 90_000,
    }),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/archive/${id}`, data),
  ingest: (archiveId: string, data?: Record<string, unknown>) =>
    api.post(`/archive/${archiveId}/ingest`, data || {}),
  reindexStyle: (archiveId: string, data?: Record<string, unknown>) =>
    api.post(`/archive/${archiveId}/reindex-style`, data || {}),
  graphData: (params?: Record<string, unknown>) =>
    api.get('/archive/graph-data', { params }),
};

// ── Sources ──────────────────────────────────────────────────────────────────
export const sources = {
  list: () => api.get('/sources/'),
  create: (data: Record<string, unknown>) => api.post('/sources/', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/sources/${id}`, data),
  delete: (id: string) => api.delete(`/sources/${id}`),
  toggle: (id: string) => api.post(`/sources/${id}/toggle`),
  runNow: (id: string) => api.post(`/sources/${id}/run-now`),
  runAll: () => api.post('/sources/run-all'),
  getRuns: (id: string) => api.get(`/sources/${id}/runs`),
  recentRuns: (limit = 20) => api.get(`/sources/status/recent-runs?limit=${limit}`),
  summary: () => api.get('/sources/status/summary'),
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

// ── Partners (CRM) ───────────────────────────────────────────────────────────
export const partners = {
  list: (params?: Record<string, unknown>) => api.get('/partners/', { params }),
  get: (id: string) => api.get(`/partners/${id}`),
  create: (data: Record<string, unknown>) => api.post('/partners/', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/partners/${id}`, data),
  delete: (id: string) => api.delete(`/partners/${id}`),
  listUpdates: (id: string) => api.get(`/partners/${id}/updates`),
  addUpdate: (id: string, data: Record<string, unknown>) => api.post(`/partners/${id}/updates`, data),
  listLinks: (id: string) => api.get(`/partners/${id}/links`),
  addLink: (id: string, data: Record<string, unknown>) => api.post(`/partners/${id}/links`, data),
  deleteLink: (id: string, linkId: string) => api.delete(`/partners/${id}/links/${linkId}`),
  upcomingContacts: (days?: number) => api.get('/partners/upcoming-contacts', { params: { days } }),
  recommendForGrant: (entity_type: string, entity_id: string, top_n?: number) =>
    api.post('/ai/recommend-partners', { entity_type, entity_id, top_n }),
};

// ── AI Assistant ─────────────────────────────────────────────────────────────
export const ai = {
  analyzeCall: (data: { opportunity_id: string; call_text?: string }) =>
    api.post('/ai/analyze-call', data),
  scoreOpportunity: (opportunityId: string) =>
    api.post(`/ai/score-opportunity?opportunity_id=${opportunityId}`),
  deepReview: (opportunityId: string) =>
    api.post(`/ai/deep-review/${opportunityId}`),
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
  processForMemory: (archiveId: string, data?: Record<string, unknown>) =>
    api.post(`/archive/${archiveId}/ingest`, data || {}),
  improveSelection: (data: {
    grant_id: string;
    selected_text: string;
    instruction: string;
    section_name?: string;
    section_type?: string;
    document_context?: string;
  }) => api.post('/ai/improve-selection', data),
};

// ── Web proxy (in-editor browser pane) ───────────────────────────────────────
export const proxy = {
  fetchPage: (url: string) =>
    api.get<{ title: string; html: string; url: string }>('/proxy/web', { params: { url } }),
};

// ── Streaming AI chat (uses native fetch for SSE) ─────────────────────────────
export function streamEditorChat(
  data: {
    grant_id: string;
    messages: Array<{ role: string; content: string }>;
    document_context?: string;
    selected_text?: string;
    active_section?: string;
  },
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (err: string) => void,
): AbortController {
  const controller = new AbortController();
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  const baseUrl = getApiBaseUrl();

  fetch(`${baseUrl}/api/v1/ai/editor-chat-stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(data),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body) throw new Error('No response body');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') { onDone(); return; }
          try {
            const parsed = JSON.parse(payload);
            if (parsed.error) { onError(parsed.error); return; }
            if (parsed.content) onChunk(parsed.content);
          } catch { /* ignore malformed */ }
        }
      }
      onDone();
    })
    .catch((err) => {
      if (err.name !== 'AbortError') onError(err.message || 'Stream failed');
    });

  return controller;
}

export function streamWritingChat(
  grantId: string,
  data: {
    messages: Array<{ role: string; content: string }>;
    document_context?: string;
    selected_text?: string;
    active_section?: string;
    writing_phase?: string;
  },
  onChunk: (text: string, contextChips?: string[]) => void,
  onDone: () => void,
  onError: (err: string) => void,
): AbortController {
  const controller = new AbortController();
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  const baseUrl = getApiBaseUrl();

  fetch(`${baseUrl}/api/v1/grants/${grantId}/writing/chat-stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(data),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body) throw new Error('No response body');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') { onDone(); return; }
          try {
            const parsed = JSON.parse(payload);
            if (parsed.error) { onError(parsed.error); return; }
            if (parsed.content) onChunk(parsed.content, parsed.context_chips);
          } catch { /* ignore */ }
        }
      }
      onDone();
    })
    .catch((err) => {
      if (err.name !== 'AbortError') onError(err.message || 'Stream failed');
    });

  return controller;
}

export function streamDraftGeneration(
  grantId: string,
  onEvent: (event: Record<string, unknown>) => void,
  onDone: () => void,
  onError: (err: string) => void,
): AbortController {
  const controller = new AbortController();
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  const baseUrl = getApiBaseUrl();

  fetch(`${baseUrl}/api/v1/grants/${grantId}/writing/generate-draft`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body) throw new Error('No response body');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') { onDone(); return; }
          try {
            const parsed = JSON.parse(payload);
            if (parsed.error) { onError(parsed.error); return; }
            onEvent(parsed);
          } catch { /* ignore */ }
        }
      }
      onDone();
    })
    .catch((err) => {
      if (err.name !== 'AbortError') onError(err.message || 'Stream failed');
    });

  return controller;
}
