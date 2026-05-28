# Google Integrations Roadmap

## Currently Live

- Google OAuth (user token-based) ✓
- Google Docs create / link / push / pull / real-time sync ✓
- Google Drive folder creation ✓

---

## Tier 1 — High Impact, Builds on Existing Infrastructure

### 1. Google Drive File Picker (workspace Files tab)

The `WorkspaceFile` model already has `source_type: GOOGLE_DRIVE` — anticipated but never built. Researchers have grant-related files (CVs, letters of support, budget templates, IRB approvals) already in Drive. Today they download and re-upload. A Drive file picker lets them browse and attach Drive files directly to the workspace without leaving the app.

- **APIs:** Drive `files.list` + `files.get`
- **Auth:** Already works with existing user tokens
- **Files to change:** `backend/app/routers/grant_workspace.py`, `frontend/src/components/grant-editor/FileLibrary.tsx`

---

### 2. Google Sign-In SSO (merge OAuth + account creation)

Currently "sign in with Google" and "connect Google account" are two separate flows. EPFL and similar institutions run Google Workspace. A "Sign in with Google" button on login/register would create the account AND connect Google in one step — eliminating email verification friction entirely.

- **APIs:** OAuth userinfo endpoint (already called in callback)
- **Auth:** OAuth client and callback handler already built — just needs a new code path that creates/looks up a user instead of only storing tokens
- **Files to change:** `backend/app/routers/auth.py`, `frontend/src/app/login/page.tsx`, `frontend/src/app/register/page.tsx`

---

### 3. Google Calendar sync for deadlines

Grant deadlines and task due dates are the most critical data in the app. Deadline fields exist on `Opportunity`, `ActiveGrant`, `Task`, and `Milestone`. One-click "Add to Calendar" or auto-sync creates Google Calendar events for submission deadlines, internal review milestones, and task due dates. Could also create a shared grant team calendar per active grant.

- **APIs:** Calendar `events.insert`, `calendars.insert`
- **Auth:** Requires adding `https://www.googleapis.com/auth/calendar.events` to the OAuth scope
- **Files to change:** `backend/app/routers/auth.py` (scope), new `backend/app/services/google_calendar.py`, `frontend/src/components/grant-editor/TasksHub.tsx`

---

## Tier 2 — High Impact, New Surface Area

### 4. Google Sheets for budget tracking

Researchers manage budgets in Sheets natively. Creating a linked Google Sheet when a grant is activated — pre-populated with the app's budget line items — and syncing changes back would eliminate copy-paste. Could auto-share the Sheet with grant collaborators on invite.

- **APIs:** Sheets `spreadsheets.create`, `values.get`, `values.update`
- **Auth:** Requires adding `https://www.googleapis.com/auth/spreadsheets` scope
- **Files to change:** `backend/app/routers/grant_workspace.py`, `backend/app/models/active_grant.py` (add `google_sheet_id` field), `frontend/src/components/grant-editor/BudgetPanel.tsx`

---

### 5. Drive folder file listing in Files tab

The Files tab only shows `workspace_files` table records. If a grant has a linked Drive folder, the Files tab could also show actual files inside that folder using Drive `files.list` — letting users open Drive files directly. Makes the Drive folder the true file hub with the app providing a unified view.

- **APIs:** Drive `files.list` (with folder as parent)
- **Auth:** Already works with existing user tokens
- **Files to change:** `backend/app/routers/grant_workspace.py`, `frontend/src/components/grant-editor/FileLibrary.tsx`

---

## Tier 3 — Medium Impact

### 6. Auto-backup proposal versions to Drive on push

When the user pushes the proposal to the linked Google Doc, also auto-upload a timestamped copy (PDF or DOCX) to the grant's Drive folder. Creates automatic version history without manual effort.

- **APIs:** Drive `files.create` (multipart upload)
- **Files to change:** `backend/app/routers/grant_workspace.py` (push endpoint), `backend/app/services/google_drive.py`

---

### 7. Google Meet links via Calendar events

When creating a Calendar event for a grant meeting (extension of #3), generate a Google Meet link using Calendar API's `conferenceData` field. Adds a "Schedule team meeting" action to the grant workspace.

- **APIs:** Calendar `events.insert` with `conferenceData`
- **Files to change:** Extension of the Calendar service built in #3

---

### 8. Gmail correspondence tracking

The `GrantActivityLog` exists. The Gmail API (`messages.list` with a query like `from:funder@agency.gov OR subject:"grant name"`) could surface relevant email threads on the grant's activity feed — keeping funder correspondence in institutional memory without manual logging.

- **APIs:** Gmail `messages.list`, `messages.get`
- **Auth:** Requires adding `https://www.googleapis.com/auth/gmail.readonly` scope
- **Files to change:** New `backend/app/services/google_gmail.py`, `backend/app/routers/grant_workspace.py`

---

## Tier 4 — Technical Improvement to Existing Feature

### 9. Google Drive push notifications (replace polling)

The current real-time sync uses 30-second polling (`GET /docs/remote-status`). Google Drive's push notifications API (`drive.files.watch`) sends a webhook to the server the moment a file is modified — making sync truly real-time and eliminating ~1,440 API calls per day per linked doc. Requires a public HTTPS endpoint (Railway has this) and periodic channel renewal.

- **APIs:** Drive `files.watch`, `channels.stop`
- **Files to change:** `backend/app/routers/grant_workspace.py` (add webhook receiver), `frontend/src/components/grant-editor/GrantEditor.tsx` (remove polling, use server-sent events or websocket instead)

---

## Priority Summary

| # | Integration | Impact | Complexity |
|---|---|---|---|
| 1 | Drive File Picker | Files tab — eliminates download/re-upload | Low (model already exists) |
| 2 | Google Sign-In SSO | Onboarding — one-click account + Google connect | Low (auth handler already built) |
| 3 | Google Calendar sync | Deadlines/tasks — never miss a submission | Medium |
| 4 | Google Sheets budget | Budget tab — sync with native tool | Medium |
| 5 | Drive folder file listing | Files tab — unified view | Low |
| 6 | Auto-backup to Drive | Proposal versions — automatic history | Low |
| 7 | Google Meet via Calendar | Team workspace — instant meeting links | Low (extension of Calendar) |
| 8 | Gmail tracking | Activity feed — funder correspondence | Medium |
| 9 | Drive push notifications | Replace polling — true real-time sync | High |

The three with the highest ROI relative to effort are **Drive File Picker**, **Google Sign-In SSO**, and **Google Calendar sync** — all build directly on the OAuth tokens already stored on the user model.
