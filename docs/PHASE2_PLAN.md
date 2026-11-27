# Phase 2 — Crew app & bill of lading (plan, 2026-11-27)

Owner decisions (2026-11-27): movers see job basics only (no prices, no customer phone); crew-leader discount up to
**20% of the whole job total** (labor + service charge + add-ons, before discount); crew time edits lock once the job is
completed **and the crew has recorded full payment** (office can still correct, with a reason, audited);
**online with retry** (no offline mode in v1). Earlier: crew leaders see prices and customer info; crew leaders and
movers can take photos; owner's labor = $0; all crew 1099 contractors.

Built and released in four parts, each with tests, preview and owner sign-off.

## 2A — Crew job screens (phone-first)
- **Security change first:** today assigned crew can read the full `jobs` row (incl. prices) through the API. Narrow
  `job_read` to office; crew get data only through SECURITY DEFINER functions:
  - `crew_jobs(company, from, to)`: my assigned jobs (date, window, status, service type, truck, crew names)
  - `crew_job_detail(company, job)`: + stops with access notes, general instructions; **crew leader** also gets customer
    name/phones/email and pricing; **movers** never get prices or customer contact.
- Screens (mobile-first, large touch targets): **My jobs** (today / upcoming), **Job** page with addresses (tap to open
  Maps), access notes, crew, truck.
- **Start job / Finish job** (crew leader or office): booked → in_progress → completed; server timestamps.
- **Notes**: crew notes on the job (`job_notes`: author, time, text; office sees all; crew see their job's notes).
- **Photos**: phone camera upload to the existing private `job-photos` bucket (policy already allows assigned crew),
  compressed in the browser, category (before / after / damage / other); office-only delete.

## 2B — Bill of lading: pricing & time
- Tabs **Customer Info · Pricing · Contract**; ☰ menu → Notes, Camera, Photos.
- Pricing page 1: hourly rate (from quote), service charge, **start / finish times** (crew leader, office), **clock rollback**
  minutes for breaks/damages (reason required).
- Pricing page 2: add-on quantities on site (piano, safes, packing materials) using the price list (`job_line_items`).
- **Discount**: amount or %, reason required; crew leader ≤ 20% of the total before discount (server-enforced); office any.
- **Final totals** stored alongside the quote: billed minutes (minimum + increments), labor, service, add-ons, discount,
  final total, balance due.
- **Time lock**: when status = completed and recorded payments ≥ final total, crew can no longer change times/discount;
  office can, with a reason. Everything audited (who/when/before/after).
- New job fields: `actual_start_at`, `actual_end_at`, `rollback_minutes`, `rollback_reason`, `discount_cents`,
  `discount_reason`, `final_*` snapshot, `bol_status`.

## 2C — Contract & signatures
- **Contract templates** (office, Settings → Contract): ordered pages (title, text, "requires signature"), versioned.
  Needs the owner's current bill of lading / contract wording; content to be checked against TxDMV (intrastate household
  goods) and FMCSA (interstate) requirements before relying on it.
- **Signing** on the crew phone/tablet: customer draws signature + types name; pages that require a signature can't be
  skipped; **final signature after the finish time**.
- Each signature stores signer name, time, the exact page text signed (frozen), template version and who collected it;
  the image goes to a private `job-signatures` bucket.
- **Customer copy**: emailed via Resend (Edge Function `movers-bol-copy`, `RESEND_API_KEY` secret) from
  no-reply@themoverz.com, plus a printable view for the office.

## 2D — Payments page (last BOL page)
- Crew leader records **cash / Zelle / check** (check # required) → `payment_records` status "reported"; office confirms
  or voids; amounts immutable after confirmation (fixes SEC-3); deposits count toward the balance.
- Balance due on the BOL; **daily collection summary** per crew leader for the office.
- Card payments (Square) are Phase 3.

## Tests (per part)
Database: crew can only see their assigned jobs; movers never receive prices/contact; discount cap; time lock; payment
rules; signature immutability. App: final-total math (minimum, increments, rollback, add-ons, discount), window/time
formatting. Owner preview test on a phone before each release.

## Needed from the owner
1. Current bill of lading / contract wording (Word/PDF/photo) for 2C.
2. A phone (and tablet, if used on jobs) to test the crew screens.
