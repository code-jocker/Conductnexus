# ConductNexus Frontend Usability Audit

**Audit date:** 2026-11-25
**Scope:** `frontend/` (React 18 + TypeScript + Vite + Tailwind)
**Branch:** `feat/mobile-first-usability`
**Repository:** code-jocker/Conductnexus

---

## Summary

The frontend is a well-structured React 18 application with a solid design system, permission-aware routing, role-based dashboards, PWA support, and offline incident drafts. The mobile bottom navigation exists but has layout defects. The i18n dictionary is minimal (46 keys). The critical documented defect — offline incident drafts saving only `students[0]` — is confirmed in `IncidentNew.tsx`.

---

## Phase 1 Findings

| # | Finding | File | Severity | User Impact | Recommended Solution | Backend Required | Test Approach |
|---|---------|------|----------|-------------|---------------------|-----------------|---------------|
| 1 | Offline draft saves only `students[0].id`; evidence files not persisted | `frontend/src/pages/IncidentNew.tsx:97-116` | Critical | Multi-student incident reports lose all but the first student when saved offline; evidence attachments are silently discarded | Store all `studentIds` array and evidence file metadata (name, size, type, base64 or IndexedDB Blob) in the draft; restore all on load | No (frontend-only draft storage); backend sync endpoint `/sync/incidents` must accept multiple student IDs | Unit test `buildDraft()` output; integration test sync with 2+ students |
| 2 | Bottom nav and More menu both positioned `bottom-0` | `frontend/src/components/layout/MobileBottomNav.tsx:81-113` | High | The fixed bottom navigation bar and the floating "More" button overlap on small screens, hiding controls | Separate the More button into the bottom nav bar itself, or position the More button above the nav with proper padding; ensure `pb-16` on main content | No | Visual test at 320–430px widths; automated snapshot of rendered DOM |
| 3 | i18n dictionary has only 46 keys | `frontend/src/lib/i18n.tsx:5-45` | High | Nearly all UI text is hardcoded English; switching to Kinyarwanda changes almost nothing | Expand `DICTIONARY` with all navigation, form labels, buttons, alerts, empty states, and dashboard labels | No | Render each major page in both languages; verify no hardcoded English remains |
| 4 | Access token stored in localStorage | `frontend/src/lib/api.ts:3-17` | High | XSS payload can exfiltrate the JWT; no HttpOnly cookie protection | Evaluate cookie-based auth after inspecting backend refresh/login/logout contracts; document recommendation | Yes — backend must support HttpOnly cookie token transport | Security review; no token exfiltration via XSS test |
| 5 | Mobile drawer lacks focus management and Escape key | `frontend/src/components/layout/AppShell.tsx:147-153,228-233` | Medium | Keyboard/screen-reader users cannot close the mobile sidebar drawer reliably | Add Escape key listener, focus trap, and `aria-modal` to the mobile drawer | No | Keyboard navigation test; screen-reader announcement check |
| 6 | Students view toggle does not recalculate on resize | `frontend/src/pages/Students.tsx:119-122` | Medium | On foldable/resizable devices, card vs table view stays locked to initial width | Add `useEffect` with `window.addEventListener('resize', ...)` to recompute view breakpoint | No | Resize simulation test; verify view switches at 768px |
| 7 | Students filter controls cramped on mobile | `frontend/src/pages/Students.tsx:351-406` | Medium | Six filter Selects stacked in a grid are hard to tap on phones | Collapse filters into a collapsible "Filters" section on mobile; make search prominent at top | No | Touch target audit at 320px; verify 44px minimum |
| 8 | No confirmation before incident submission | `frontend/src/pages/IncidentNew.tsx:410-420` | Medium | Users can accidentally submit drafts without review | Add a confirmation dialog before "Submit for review" on mobile | No | Click-submission test; verify dialog appears |
| 9 | Duplicate socket notification listener | `frontend/src/lib/auth.tsx:108-124` + `NotificationsPanel.tsx:59-69` | Medium | Both AuthProvider and NotificationsPanel listen to `notification:new`, causing double unread count increments | Consolidate socket listener into a single shared hook or context | No | Socket event test; verify count increments once |
| 10 | Drafts page uses `window.confirm` | `frontend/src/pages/Drafts.tsx:139-143` | Low | Browser dialog is jarring and not branded; no edit affordance for drafts | Replace with Modal component; add "Edit draft" action that returns to IncidentNew with draft prefilled | No | Modal render test; verify discard confirmation |
| 11 | No per-student submission progress in incident flow | `frontend/src/pages/IncidentNew.tsx:128-170` | Medium | When submitting multiple students, user sees only success/failure at the end | Show per-student status (pending/synced/failed) during batch submission | No | Batch submission test with mixed success/failure |
| 12 | Tables lack consistent horizontal scroll on mobile | `Dashboard.tsx`, `Students.tsx`, `Approvals.tsx` | Low | Wide tables overflow or compress unreadably on phones | Wrap all data tables in `<div className="overflow-x-auto">` | No | Overflow test at 320–430px |
| 13 | No online/offline status indicator in page content | `frontend/src/components/PwaBanner.tsx` | Low | Users only learn they are offline from the top banner, not within forms | Add a small online/offline chip in incident and student forms | No | Network toggle test |
| 14 | No search in More menu | `MobileBottomNav.tsx:125-140` | Low | On mobile, finding a buried navigation item requires scrolling the whole list | Add a search input at the top of the More menu overlay | No | Menu search test |

---

## Phase 2 — Mobile Application Experience (Planned Improvements)

### AppShell
- Keep desktop sidebar unchanged.
- Mobile drawer: add Escape key close, focus trap on open, `aria-modal="true"`, restore focus on close.
- Main content: `pb-16` to prevent content hiding behind fixed bottom nav.
- Logout accessible from user menu (already present) and mobile More menu (already present).

### MobileBottomNav
- Reposition More button inside the bottom nav row to eliminate `bottom-0` overlap.
- Add search input to More menu overlay.
- Keep permission-aware filtering (already present).
- Keep role-aware sets: Teacher (Home, Students, Quick Log/Incidents, Alerts/Communications, More), Discipline Officer (Home, Incidents, Approvals, Alerts, More), Administrator (Home, Students, Incidents, Approvals, More), Parent (Children/Portal, Alerts, Profile, More).
- Active states via `NavLink` `isActive` (already present).

### Role-aware navigation sets
Map existing routes to the recommended sets:
- Teacher: `/` (Dashboard), `/students`, `/incidents/new`, `/communications`, More
- Discipline Officer: `/`, `/incidents`, `/approvals`, `/communications`, More
- Administrator: `/`, `/students`, `/incidents`, `/approvals`, More (admin functions in More: `/users`, `/audit`, `/settings`, `/monitoring`)
- Parent: `/portal`, `/communications`, `/profile`, More

---

## Phase 3 — Incident Reporting (Planned)

- Fix `buildDraft()` to store `studentIds: students.map(s => s.id)` instead of `students[0].id`.
- Store evidence file metadata in draft; reattach on reload using IndexedDB Blob storage.
- Add confirmation dialog before submit.
- Show per-student submission status.
- Preserve form data on validation failure (already works — uncontrolled state).
- Evidence upload progress, file type/size validation, retry (partially present — needs retry per file).
- Backend contract check: `/sync/incidents` must accept `studentIds[]` and evidence metadata. Document if insufficient.

---

## Phase 4 — Student Register and Profiles (Planned)

- Search prominent at top; filters collapsible on mobile.
- Reset-filters action (already present).
- Server-side pagination preserved (already present).
- Card/table views responsive; recalculate on resize.
- Identity, class, stream, status, risk visibility (already present).
- Empty/loading/error/no-results states (already present).
- Bulk selection and export (already present).
- Destructive action confirmation (already present via modal).
- Long names/identifiers: `truncate` classes already used; verify no overflow.

---

## Phase 5 — Approvals (Planned)

- Pending approvals clearly identified (already present with badge count).
- Show type, student, requester, date, reason (already present).
- Mobile approval details: full-screen modal on small screens (Modal already uses `sm:items-center`).
- Consequences of approve/reject explained (partially — add explanatory text).
- Require meaningful reasons for reject/request-info (already enforced).
- Prevent double submission: disable button during `decide.isPending` (already present); add `isPending` guard in `mutate()`.
- Refresh queries after decision (already present).
- Preserve separation of duties (already backend-enforced).

---

## Phase 6 — Dashboards (Planned)

- Role dashboards already implemented via `roleDashboards.ts` with real API data.
- No hardcoded statistics; all numbers from `/analytics/dashboard`.
- Role sets: Admin, Headteacher, Deputy, Teacher, IT, Patron, Matron, Bursar, DOS, Librarian, Secretary, Parent (already mapped).

---

## Phase 7 — Notifications and Communications (Planned)

- Unread counts (already present via `useUnreadCount`).
- Read/unread indicators (already present with blue dot).
- Navigation to records via `item.link` (already present).
- Loading/empty/error states (already present).
- WhatsApp/SMS delivery states (partially — dashboard shows WhatsApp status).
- Mobile readability and touch targets (needs audit).
- Prevent duplicate UI notifications (fix duplicate socket listener).

---

## Phase 8 — Localization (Planned)

- Extend `DICTIONARY` in `i18n.tsx` with all user-facing text.
- Language change updates interface without reload (already works via context).
- No translation of API values/database identifiers.
- Flag uncertain Kinyarwanda translations for review.

---

## Phase 9 — Responsive Design and Accessibility (Planned)

- Audit at 320, 360, 390, 430, 768, 1024, 1366, 1920px.
- 44px touch targets.
- 16px mobile input font size (prevents iOS zoom).
- Readable tables with `overflow-x-auto`.
- Full-screen dialogs on mobile for complex forms.
- Focus indicators and keyboard navigation.
- Accessible labels and button names.
- Contrast in light/dark themes.
- Reduced-motion preference.
- Safe-area insets (`pb-safe` / `env(safe-area-inset-bottom)`).

---

## Phase 10 — Performance (Planned)

- Debounced search already present (`useDebounced`).
- Pagination already present.
- Lazy route splitting already present (all pages lazy-loaded).
- Bundle splitting already configured in `vite.config.ts`.
- Skeletons and loading feedback (already present).
- No polling (refetchOnWindowFocus: false).
- Socket realtime preserved.

---

## Phase 11 — Authentication and Security (Planned)

- Token in localStorage — document cookie-based recommendation.
- Do NOT migrate frontend-only; backend must support HttpOnly cookies first.
- Preserve: password login, Google login, email verification, 2FA, trusted devices, refresh, logout, sockets, permissions.

---

## Phase 12 — Testing (Planned)

Run:
- `npm ci --prefix frontend`
- `npm --prefix frontend run typecheck`
- `npm --prefix frontend run test`
- `npm --prefix frontend run build`

Add tests for: mobile navigation, permission filtering, logout, incident multi-student drafts, offline retry/idempotency, evidence upload failure, student filters, responsive states, approval decisions, localization, auth regressions.

---

## Phase 13 — Documentation

Create `docs/FRONTEND_IMPLEMENTATION_REPORT.md` after implementation.

---

## Known Pre-existing Issues (not regressions)

- 5 test failures in `notification-preferences.test.ts` (backend, unrelated to frontend).
- `SMTP_PASS` empty in `.env` — email delivery may fail in production.
- No `vitest` setup for frontend yet (only `import.test.ts` exists).
