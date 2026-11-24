# Product Request Workflow

A bilingual (Japanese and English) workflow app for product requests in a regional sales organisation: samples, installation units, claim replacements, QC units and customer returns with credit memos. Each request type has its own approval hierarchy.

> **About this repository.** Built for a Fortune-500 life-sciences company and running in production there after security review and change-advisory-board (CAB) approval. This public copy is anonymised: the client's name and branding are replaced with the placeholder "Acme", and every person, customer, product, price, address and identifier in the seed data is synthetic. Internal hostnames, cloud resource names, credentials and deployment runbooks have been removed. Some test fixtures that were exports of real business files were not published, so a few tests are expected to fail (listed under **Tests**).

Live in production after security review and CAB approval.

## The problem

Each request type had its own paper or Excel form, approval chain and owners. Sales reps re-typed customer and product details, approvers could not see the history, and returns and credit memos were reconciled by hand against the ERP.

## What it does

- **One wizard, many request types.** Covers sample (ZSAM), installation (ZNC), claim replacement, QC (ZINT) and returns. Each type has its own fields, completeness rules and reference numbering.
- **Approval hierarchies as data.** Each request type has its own approval mapping (sales manager → district → national → finance → commercial director), imported in bulk from Excel and checked before it is applied.
- **Returns and credit memos.** Covers return reasons, amount rules, review steps and customer-care routing.
- **Master-data sync.** Customer and product catalogues are imported with parsing, validation, row-level diffs and dry runs.
- **Bilingual UI and emails** in Japanese and English, with print and email views of each form.
- **Entra ID SSO** (MSAL) with role-based admin screens. People who leave are offboarded with their approvals reassigned.

## Architecture

```
React + Vite + Tailwind (src/)  ──►  Express + TypeScript API (backend/)  ──►  PostgreSQL (Prisma)
        │                                   │
        └─► MSAL (Entra ID)                  ├─► import/sync pipelines (xlsx)
                                            └─► email notifications (nodemailer)
```

## Stack

TypeScript, React 18, Vite, Tailwind CSS, react-hook-form, Zod, MSAL, Node.js, Express, Prisma, PostgreSQL, nodemailer, Docker, nginx.

## Running locally (synthetic data)

```bash
docker compose up -d                       # local PostgreSQL
cd backend && npm install && cp .env.example .env 2>/dev/null; npx prisma migrate deploy && npx prisma db seed && npm run dev
cd .. && npm install && npm run dev
```

The requester and approver mappings (`requesters_mapped.json`, `zsamm_approval_mapping.json`) and the customer lists in `src/data/` are synthetic.

## Tests

| Suite | Result on this public copy |
|---|---|
| Backend unit tests (import parser, product validation, product-sync diff and run-rows, offboarding, SSO claims, zip) | 7 / 7 test files pass |
| Frontend unit test (`node --test`) | 8 / 8 passed |

## License

MIT. See [LICENSE](LICENSE). Architecture notes are in [`ARCHITECTURE.md`](ARCHITECTURE.md).
