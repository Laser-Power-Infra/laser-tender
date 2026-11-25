# laser-enquiry-platform — build package

Reference code + brief for replacing Smartsheet (Sales Enquiry 3 + Item List) and Power BI with the in-house dashboard, including the costing and PV logic. Hand `docs/BUILD_BRIEF.md` to the Claude that builds the dashboard.

```
docs/BUILD_BRIEF.md      what to build, in what order, decisions taken, verified vs unverified   <- START HERE
docs/COSTING_RULES.md    CLAUDE COSTINGS rules + PV logic (formulas, date rules, TO VERIFY list)
docs/OPEN_QUESTIONS.md   15 open questions with owners
docs/POWERBI_PAGE_MAP.md Power BI page -> new module map
db/schema.sql            Postgres schema (generated from real Smartsheet columns + hand-written half)
db/columns.json          Smartsheet title <-> db column mapping, types, picklist flags, owner hints
seed/picklists.json      2,512 parties, 633 utilities, 3,028 ERP items, countries, small dropdowns
sync/                    smartsheet_sync, mirror_to_smartsheet, gsheets_sync, attachments_sync, parity_check, seed (+ tests)
sync/sheets.config.json  Smartsheet sheet ids + Google Sheet ids/tabs (incl. PV tabs)
costing/                 rules.ts, engine.ts, pv.ts, parity.ts (+ tests)
```

## Quick start
```
npm install
npm test            # 31 tests (PGlite, no external services)
npm run typecheck
createdb laser && psql laser -f db/schema.sql
export DATABASE_URL=postgres://... SMARTSHEET_TOKEN=... GOOGLE_APPLICATION_CREDENTIALS=/path/sa.json
npm run db:seed
npm run sync:smartsheet -- --sheet all      # one-time import (add --dry-run to test against an in-memory DB)
npm run db:seed                              # again: aligns docket_counter
npm run sync:gsheets
npm run sync:attachments
npm run parity                               # exit 1 if Smartsheet and DB differ
```
Requires Node 20+ (tsx). Sync scripts were tested against fixtures and PGlite only — not against live Smartsheet/Google APIs.
