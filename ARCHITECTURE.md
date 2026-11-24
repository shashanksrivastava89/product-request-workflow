# Product Request — Tech Stack & Architecture

Internal Acme Japan application for raising, routing and approving **sample requests** and
**product returns / credit memos**. A requester fills in a wizard; the server builds an approval
chain from master data held in Postgres; approvers act either inside the app or straight from an
emailed link; a fully approved request is handed off by email to the order-taking desk.

> This file is generated documentation, not a spec. It is git-ignored (`*.md` in `.gitignore`).

---

## 1. Stack at a glance

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript 5.6, Vite 5, React Router 6, Tailwind 3, react-hook-form, zod, axios |
| Auth (browser) | `@azure/msal-browser` + `@azure/msal-react` (Microsoft Entra ID, SPA redirect flow) |
| Backend | Node 18, Express 4, TypeScript 5.6 |
| Auth (server) | Entra Bearer token verified against JWKS (`jwks-rsa` + `jsonwebtoken`); legacy `X-User-Email` header mode |
| ORM / DB | Prisma 6 → PostgreSQL |
| Email | Microsoft Graph (app-only) preferred, Nodemailer/SMTP fallback |
| Files | `multer` (memory storage) for spreadsheet import and form attachments; `xlsx` for parsing |
| Validation | `zod` on both sides |
| Packaging | Docker multi-stage; frontend served by nginx (which also proxies `/api`) |
| Tests | None to speak of — one hand-rolled `node:assert` script (see §11) |

Two independent npm projects, no monorepo tooling:

```
/                → frontend (package.json, vite.config.ts, tailwind.config.cjs)
/backend         → API server (package.json, prisma/, src/)
```

The root `tsconfig.json` is frontend-only (`"include": ["src"]`, `noEmit`, path alias `@/* → src/*`).
The backend has its own `tsconfig.json` and emits to `backend/dist`.

---

## 2. Repository layout

```
product-request/
├── src/                          # React SPA
│   ├── main.tsx                  # provider stack + every route (single file router)
│   ├── auth/, config/            # MSAL instance + configuration
│   ├── providers/                # AuthContext, FormContext, ReturnFormContext, I18nContext
│   ├── pages/                    # route components (+ pages/admin/*)
│   ├── components/               # Wizard.tsx (4.3k lines), ReturnWizard.tsx (2.3k), admin/*
│   ├── hooks/                    # useReturnReview (service-review mode of the return wizard)
│   ├── services/api.service.ts   # the entire HTTP surface, grouped by domain
│   ├── constants/, utils/, data/ # domain enums, pure helpers, JSON-backed fallback lists
│   └── styles/print.css          # print sheet for approval/PDF views
│
├── backend/
│   ├── prisma/schema.prisma      # ~889 lines, 30 migrations
│   ├── src/
│   │   ├── server.ts             # Express app + route mounting
│   │   ├── middleware/           # auth, error, uploads, import validation
│   │   ├── routes/               # 12 routers, one per API prefix
│   │   ├── controllers/          # request/response + zod parsing
│   │   ├── services/             # business logic (approval, email, import, static-data, prisma)
│   │   ├── utils/                # tokens, email templates, role labels, SSO email mapping
│   │   └── constants/            # return-form labels, app-setting keys
│   ├── scripts/                  # ~108 one-off ts-node ops scripts (migrations, audits, seeds)
│   └── all_product_*.md, all_customer_data.md   # versioned master-data dumps for import
│
├── Dockerfile, backend/Dockerfile, nginx.conf
├── docker-compose.yml (dev), docker-compose.prod.yml
└── scripts/                      # shell/SQL deploy + data helpers
```

---

## 3. Domain model

### Request types (`FormType`)

| Code | Meaning |
|---|---|
| `ZSAM` | Sales promotion sample |
| `ZNC` | Installation |
| `ZNCCLAIM` | Claim replacement (the only type with attachments) |
| `ZINT` | QC test |
| `RETURN` | Product return / credit-debit memo |

All five live in **one** `sales_forms` table. Return-specific columns (`returnType`, `isService`,
`originalOrderNumber`, `invoiceDate`, `isStandingOrder`, `orderReason`, `justification`,
`salesOrderNumber`, …) are nullable on that table rather than in a side table, so every existing
reader — approval emails, approval pages, admin export — keeps working with no extra join.

### Core tables

- **`users`** — people + their approval hierarchy. Hierarchy exists twice: legacy name strings
  (`salesManager`, `technicalManager`, …) kept for backward compatibility, and the current FK
  columns (`salesManagerId` → `users.id`, seven self-relations in total). Two capability flags sit
  alongside `role`: `isSuperApprover` and `isServiceAdmin` (flags, not roles, because the same
  people also raise requests).
- **`requester_groups` / `requesters`** — the requester directory. A person holds *one requester row
  per team*, deliberately not unique on `userId`. `formScope` on both tables separates the Sample
  and Return worlds (`NULL` = both; only `ret-…` groups are return-only).
- **`sales_forms` → `form_products`, `form_invoice_dates`, `form_attachments`, `form_review_edits`**
- **`approvals`** — one row per chain step, `@@unique([formId, level])`, each carrying its own
  `approvalToken` for email approval.
- **Approval matrices**, one table per flow: `zsamm_`, `zint_`, `znc_`, `zncclaim_`, and
  `return_approval_mapping`. All keyed by `(requesterName, businessUnit[, teamName])` with
  uppercase names.
- **`approval_chain_config`** — the *rules*, in the database: per form type, a level, a role label,
  which mapping column to read, and a condition (`ALWAYS`, `AMOUNT_LTE`, `AMOUNT_GT`,
  `SERVICE_ONLY`).
- **Master data** — `customers` (SOLD-TO / direct-delivery / end-user, split by `firstDigit`),
  `product_catalog`, plus `*_history` tables holding full row snapshots and a JSON field-level diff.
- **`app_settings`** — key/value UI copy edited from the admin area.

---

## 4. Approval engine

`backend/src/services/approval.service.ts` (~1.5k lines) is the heart of the system.

```
submit form
   └─ calculateApprovalPath(form)
        ├─ load approval_chain_config rows for form.formType        (rules from DB)
        ├─ load the requester's row from the matching *_approval_mapping table
        ├─ for each config row: evaluate condition (ALWAYS / amount / SERVICE_ONLY),
        │   read hierarchy[mapping_field], resolve name → {name, email}
        └─ post-process: drop self-approvals, drop repeated approvers,
           renumber to a gapless 1..n sequence
   └─ createApprovalWorkflow(form)  → one `approvals` row per level, each with a token
   └─ sendApprovalRequestNotification(level 1)
```

Then `processApproval` advances the chain on each decision: mark the step, notify the next approver
(or the requester on rejection), and on the final approval send the **order-taking hand-off mail**
routed by business unit — `CDG → AZURE_CGD_MAIL_TO`, `LSG → AZURE_LSG_MAIL_TO`,
`Service → AZURE_SERVICE_MAIL_TO`.

Notable behaviours:

- **Config-driven, with a hardcoded fallback.** If `approval_chain_config` has no rows for a form
  type, `calculateApprovalPath` falls back to in-code rules.
- **Amount thresholds** come from config rows (e.g. ZNC adds LFC + DCM above ¥3M; ZINT/ZNCCLAIM add
  Global RAQA above ¥1.5M).
- **Super approvers** can act on another person's step; the acting user is recorded in
  `approvals.actualActorUserId` so the audit trail stays honest.
- **Service review step (RETURN).** A `SERVICE_ONLY` config row puts a *reviewer* ahead of every
  approver for service returns. The reviewer is usually a shared mailbox, so the whole Service Admin
  team is notified and any `isServiceAdmin` user may action it. Gated by
  `RETURN_REVIEW_STEP_ENABLED`.
- **Review-window edits.** A reviewer may correct someone else's request; every change is written to
  `form_review_edits` as a field diff, and the *first* edit stores a full `beforeSnapshot` so the
  whole set of corrections can be discarded back to what the requester submitted. Downstream
  approvers see the diff (`routeAfterReview` / `rebuildRouteAfterReviewEdit` rebuild the chain when
  the correction changes requester, unit or service flag).

### Token approval (no login)

Every `approvals` row gets a 32-byte base64url token with a 30-day expiry. Emails link to
`/approval/approve|reject|view?token=…`, served by `/api/public/approvals/*` — the only unauthenticated
routes in the app. Attachments are reachable through the same token.

---

## 5. Authentication & authorization

**Browser.** `getMsalInstance()` returns a singleton `PublicClientApplication`, or `null` when
`VITE_AZURE_TENANT_ID` / `VITE_AZURE_CLIENT_ID` are absent — `main.tsx` renders with or without
`MsalProvider` accordingly. The axios request interceptor acquires a Microsoft token per request
when `auth_mode === 'sso'`; `VITE_SSO_HEADER_FALLBACK=true` degrades to `X-User-Email` headers.
A 401 response stashes the server's message in `sessionStorage` and redirects to `/login`.

**Server** (`middleware/auth.middleware.ts`):

1. `Authorization: Bearer …` → `verifyMicrosoftIdentityToken` (JWKS) → email claim →
   `mapIncomingSsoEmailToDbEmail` (`SSO_EMAIL_MAP`) → `users` lookup.
2. Otherwise `X-User-Email`, allowed unless `ALLOW_SSO_HEADER_AUTH=false`.
3. Password login is **disabled** (`/api/auth/login` returns a "password login disabled" response).

Guards layered on top:

- `requireProvisionedUser` — blocks SSO users with no `users` row. When
  `ALLOW_UNPROVISIONED_SSO` is on they authenticate as a synthetic `UNPROVISIONED` user and are sent
  to `/pending-access`.
- `authorize(...roles)` — role check, with `SUPER_APPROVER` satisfied by the `isSuperApprover` flag.
- `forbidCustomerSupportWrites` — `CUSTOMER_SUPPORT` is read-only everywhere.
- `requireSecureImportAuth` — admin spreadsheet import can be forced to Bearer-only via
  `ADMIN_IMPORT_REQUIRE_BEARER`.

Frontend mirrors this with `ProtectedRoute`, `ProtectedAdminRoute`, `ProtectedStrictAdminRoute`
and `CustomerSupportRouteGuard`.

**Roles**: `REQUESTER`, `SALES_MANAGER`, `DISTRICT_SALES_MANAGER`, `NATIONAL_SALES_MANAGER`,
`FINANCE_CONTROLLER`, `DIRECTOR_COMMERCIAL`, `ADMIN`, `SUPER_APPROVER`, `CUSTOMER_SUPPORT`
— plus the two orthogonal flags `isSuperApprover` / `isServiceAdmin`.

**Local dev**: `?devUser=<email>` signs in without the Microsoft round trip and `?devLogout` clears
it (`src/utils/devSignIn.ts`); both are compiled out of production builds and must run before the
first render because `AuthContext` reads `localStorage` on mount.

---

## 6. API surface

Mounted in `backend/src/server.ts`. All prefixes except `/api/public/*` and `/health` require
`authenticate`; most also require `requireProvisionedUser`.

| Prefix | Purpose |
|---|---|
| `/api/auth` | `/me`, `/logout` (login/register disabled) |
| `/api/forms` | CRUD + `submit`, `copy-from-rejected`, `revert-review-edits`, `sales-order-number`, attachments |
| `/api/approvals` | inbox, history, `approve`, `reject`, `reopen-rejection`, `notify-approver` |
| `/api/public/approvals` | token-based view/approve/reject + attachment download (**no auth**) |
| `/api/catalog` | products, channel partners, end users, sales reps |
| `/api/requests` | pending requests for the requester |
| `/api` (static-data) | requester groups, sales reps, approver lookups per flow, customers, product catalog, `my-requester-scope`, `my-return-matrix-roles` |
| `/api/admin` | customers, products, hierarchy, requester directory, approval mappings, users, bulk import, reconciliation, change history, app settings |
| `/api/support` | read-only approved-request views for `CUSTOMER_SUPPORT` |
| `/api/reports` | ZNC-claim approved report |
| `/api/app-settings` | UI copy read |
| `/api/test` | email smoke test |
| `/health` | DB ping + a canary user lookup (used to diagnose "which DB am I actually on?") |

`/api/admin`, `/api/support` and `/api/reports` all set `Cache-Control: no-store` so the UI always
reflects current DB state.

---

## 7. Frontend architecture

**Provider stack** (`main.tsx`):

```
I18nProvider → [MsalProvider] → AuthProvider → FormProvider → ReturnFormProvider → BrowserRouter → Shell
```

- **`I18nContext`** — hand-rolled EN/JA dictionary (~517 lines), `t('key')`. No i18n library. Tailwind's
  font stack leads with Meiryo for Japanese rendering.
- **`FormContext` / `ReturnFormContext`** — the in-progress wizard state for each flow. Drafts
  persist to **`sessionStorage`** (`formDraftStorage.ts`), deliberately not `localStorage`: the old
  behaviour resurrected a submitted request days later.
- **`AuthContext`** — the signed-in user, MSAL-aware.

**Two wizards, three steps each.** `Wizard.tsx` (sample) and `ReturnWizard.tsx` (return) each run
step 1 → 2 → 3 with per-step gating and a "next field to fill" hint. The return wizard has a second
**mode**: `useReturnReview` turns the same wizard into the service-review screen, so the reviewer
edits the exact fields the requester sees rather than a parallel copy — adding a field to the
requester journey gives it to the reviewer for free.

**Route sharing.** The Return section reuses the mature approval pages (`InboxRoute`,
`PendingApprovals`, `ApprovedRequests`) with `scope="return"` instead of maintaining its own copies.
`MailboxChooser` sits behind the top-nav `/inbox`, `/pending`, `/approved` entries and asks which
section before handing off.

**`api.service.ts`** is one 2.2k-line module exposing `authApi`, `appSettingsApi`, `reportsApi`,
`approvalsApi`, `requestsApi`, `formsApi`, `staticDataApi`, `adminApi` — every network call in the
app goes through it.

---

## 8. Bulk import pipeline

Admin-only, two-phase, eight entity types (`src/constants/importEntities.ts` — customers, products,
users, and the five hierarchy/matrix sheets).

```
POST /api/admin/import/sheet-info   → discover sheets/columns
POST /api/admin/import/validate     → parse + per-entity validator, report problems, no writes
POST /api/admin/import/execute      → upsert
```

Uploads are **chunked**: the UAT/production edge (AWS WAF `SizeRestrictions_BODY`) rejects request
bodies over ~8KB, so the browser slices the file with `File.slice()` and posts the pieces to
`/import/chunk/{begin,…,finalize}`; `chunked-upload.service.ts` reassembles them on disk and hands
the parser exactly what a single multipart upload would have produced. Session ids are generated
server-side and bound to the uploading user (an id is a path component, so a client-supplied one
would be a traversal hole).

Files are held in multer **memory storage** until `validateImportUpload` magic-byte-checks them and
writes a validated copy to `backend/tmp/import`. Form attachments land in
`backend/uploads/form-attachments` (both directories are git-ignored).

---

## 9. Email

`services/email.service.ts` picks a transport at send time:

1. **Microsoft Graph** (app-only) when `AZURE_TENANT_ID` + `AZURE_CLIENT_ID` + `AZURE_CLIENT_SECRET`
   + `AZURE_MAIL_FROM` are set — this is the production path.
2. **Nodemailer / SMTP** otherwise.

`AZURE_MAIL_TO` is BCC'd on every message as an audit copy. **`MAIL_TEST=true`** disables that BCC,
prefixes subjects with `[MAIL_TEST]`, lets addresses on `MAIL_TEST_ALLOWLIST` receive real mail (so
UAT routes exactly as production will) and redirects everyone else to `AZURE_MAIL_TO` with a note
naming the intended recipient.

Templates live in `utils/email.templates.ts` (~1.8k lines), bilingual, and render the approval chain
as a step list showing who approved, who rejected and who holds it now.

---

## 10. Configuration

Frontend (`VITE_*`, **inlined at build time** — passed as Docker `--build-arg`, not `docker run -e`):

`VITE_API_URL`, `VITE_AZURE_TENANT_ID`, `VITE_AZURE_CLIENT_ID`, `VITE_AZURE_REDIRECT_URI`,
`VITE_AZURE_API_SCOPE`, `VITE_SSO_HEADER_FALLBACK`

Backend:

| Group | Variables |
|---|---|
| Core | `DATABASE_URL`, `PORT`, `NODE_ENV`, `FRONTEND_URL`, `APP_URL` |
| Entra / SSO | `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_API_AUDIENCE`, `SSO_EMAIL_MAP`, `ALLOW_SSO_HEADER_AUTH`, `ALLOW_UNPROVISIONED_SSO`, `ADMIN_IMPORT_REQUIRE_BEARER` |
| Mail | `AZURE_MAIL_FROM`, `AZURE_MAIL_TO`, `AZURE_CGD_MAIL_TO`, `AZURE_LSG_MAIL_TO`, `AZURE_SERVICE_MAIL_TO`, `AZURE_RETURN_ALWAYS_MAIL_TO`, `AZURE_RETURN_FINAL_CC`, `MAIL_TEST`, `MAIL_TEST_ALLOWLIST`, `MAIL_ENV_LABEL`, `MAIL_UNROUTED_APPROVER_TO`, `SMTP_*`, `EMAIL_FROM` |
| Feature flags | `RETURN_REVIEW_STEP_ENABLED`, `APPROVAL_MAPPING_SKIP_DIRECTORY_VALIDATION`, `ALLOW_PUBLIC_REGISTRATION` |
| Legacy | `JWT_SECRET`, `JWT_EXPIRES_IN` (password login is disabled) |

`server.ts` loads `backend/.env` by absolute path, not from cwd, so `AZURE_*` resolves even when the
process is started from the repo root.

---

## 11. Build, run, deploy

**Local dev** (`.claude/launch.json` defines both):

```bash
npm run dev                 # Vite on :5173
cd backend && npm run dev   # nodemon + ts-node on :3000
```

`docker compose up` runs both in containers against a host Postgres (`japanautomation`) via
`host.docker.internal`; `--profile postgres` brings up a containerised DB instead.

**Build**: `npm run build` = `tsc -b && vite build` (frontend); `tsc` → `dist/` (backend).

**Production images**:

- *Frontend* — multi-stage: Node 18 build → `nginx:alpine`. `nginx.conf` serves the SPA with
  `try_files … /index.html`, sends `no-store` for HTML (content-hashed assets get `immutable` for a
  year), restates the security headers inside `location /` (a location-level `add_header` *replaces*
  the server-level set), and proxies `/api` upstream with `client_max_body_size 25M`.
- *Backend* — multi-stage: build + `prisma generate` → production image running as a non-root
  `nodejs` user, with a build-time assertion that `jwks-rsa` and the compiled Entra auth util exist.
  Both images carry `HEALTHCHECK`s.

`docker-compose.prod.yml` wires Postgres + backend + frontend and must forward **every** mail
variable explicitly — a stack missing them silently falls back to SMTP and sends no order-taking
hand-off.

**Migrations**: `npx prisma migrate deploy` (30 migrations). The dev compose runs
`prisma generate && prisma migrate deploy` on start.

**Tests**: there is no test framework. The only automated check is
`backend/src/utils/sso-email-from-claims.util.test.ts`, a plain `node:assert` script run via
`npm run test:sso-email-claims`. Verification otherwise happens through `backend/scripts/*.ts`
(~108 ts-node audit, check, seed and migration scripts) and manual UAT.

---

## 12. Conventions worth knowing

- **Rules live in the database, not the code.** Approval chains are `approval_chain_config` rows;
  approver identities are matrix-table rows; UI copy is `app_settings`. Changing who approves what
  is usually a data change, not a deploy.
- **Names are the join key.** Approval matrices key on `requesterName` in **UPPER CASE**, matched
  against the directory. Casing and name normalisation are load-bearing.
- **Comments explain *why*, and cite the person who asked.** Many schema fields and modules carry a
  paragraph naming the reviewer and the date behind a decision. Match that density when editing
  those files; don't strip the rationale.
- **Soft deletes and full history.** Master data uses `isActive` plus `*_history` snapshot tables
  with JSON field diffs — prefer deactivating to deleting.
- **`git`**: `master` is the default remote HEAD but is stale; `main` is trunk. Work here is on
  `return`.
- **Two big files carry most of the UI.** `Wizard.tsx` (4,307 lines) and `ReturnWizard.tsx` (2,311)
  are the main entry points for form-behaviour changes; `approval.service.ts` (1,492) and
  `email.templates.ts` (1,846) are their server-side counterparts.
