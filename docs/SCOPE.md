# The Movers — Platform Scope (as of 2026-11-23)

Inputs: the delivered packages in `projects/my-project/` (latest cumulative: `The_Movers_Twilio_Connection_Test/`) and the owner's *The Movers Software Features.docx*. Owner decisions from 2026-11-23 are in §7.

## 1. What's built

Stack: React 19 + Vite static site on Vercel (`the-movers/the-movers-login-dev`), Supabase (Postgres, Auth, Storage, Edge Functions; project `yohmygccqdomiynnkobn`), Twilio for SMS.

| Delivery | What it added | Tests claimed |
|---|---|---|
| `01_database_setup.sql` | Multi-tenant schema: companies, members (owner/office_admin/crew_leader/mover), settings, crew rates, customers, jobs, office notes, assignments, time entries, payment records, photos. RLS on every table. Private `job-photos` bucket. The Movers rates seeded. | 29 PG |
| Independent Login | Email/password auth, owner claim, company selector, role-aware nav, staff registration | 3 app |
| `02_estimates.sql` + UI | Customers + client-side search (name/email/phone), estimate editor, server-side pricing (2-hr min, 15-min increments, weekday/weekend, service charge $1.20/mi rounded up to $5, flat rate, deposits), booking | 42 PG + 9 app |
| `03_dispatch.sql` + UI | Trucks, scheduled duration, daily/weekly/monthly calendar, truck/crew assignment with server conflict checks, optimistic locking, cancel | 61 PG + 13 app |
| `04_sms_connection.sql` + 2 Edge Functions | Twilio check + own-number test SMS, rate limits, idempotency, signed callbacks, test-number STOP/START | 80 PG + 17 edge + 13 app |

Strengths worth keeping: authorization in RLS and SECURITY DEFINER RPCs, composite tenant FKs, server-side pricing, Twilio signature checks, secrets only in Edge Function Secrets, CSP and frame-deny headers.

## 2. Gaps in the current build
- Crew can only *view* assigned jobs: no time entry, photos, notes, status changes, bill of lading or signatures. No RPC moves a job to `in_progress` or `completed`.
- The owner can't be assigned to a job as crew. `save_dispatch_job` accepts only `mover`/`crew_leader` roles.
- No final invoice (actual time, materials, piano/safe fees, discounts, balance due).
- `payment_records` has no UI, and Square/QuickBooks are not integrated.
- No import of old customer records. They are in an Excel file, so the Excel import tool (feature 10) covers this.
- No email at all. Customer SMS is deliberately off.
- Ops: no Git, no migration history, no CI, no separate production environment, custom SMTP not confirmed.

## 3. Feature list status map

Status: ✅ built · 🟡 partial · ⬜ not started. Phase refers to §5.

| # | Feature (from owner's list) | Status | Notes | Phase |
|---|---|---|---|---|
| 1a | Customer first/last name, email, ≥2 phones, office-only access, edit later | 🟡 | Single `name`, 1 email, 1 phone; office-only RLS ✅; editing via estimate ✅ | 1 |
| 1b | Up to 5 addresses per job, each with type (house/townhouse/apartment/high-rise/storage/office/warehouse), bedrooms, floor | ⬜ | Schema has only `pick_up_address`/`drop_off_address`. Needs a `job_stops` table. Feeds dispatch capacity rules and BOL | 1 |
| 1c | Referral / "how did you hear about us" | ⬜ | Field + picklist. Links to the referral portal | 1 |
| 1d | Search by name, phone, email, **address** | 🟡 | Name/email/phone only, done in the browser. Needs server-side search with an address index | 1 |
| 1e | Staff records: name, email, phone, address, hourly wage, SSN, signed docs | ⬜ | Members have name/role only. **Decided:** SSNs stay in QuickBooks Online, never in this app (SEC-9) | 6 |
| 2 | WordPress quote form → lead in app + push alert to admin | ⬜ | Public lead endpoint (Edge Function with anti-spam) + `leads` table + web push | 7 |
| 3 | AI agent (SMS/email, maybe calls): office first, AI after hours, uses real pricing/availability, books within rules, escalates with summary | ⬜ | Feasible on top of existing `save_estimate`/dispatch RPCs. Highest compliance risk. Last phase | 9 |
| 4a | Drag-and-drop professional email templates | ⬜ | Use an embedded builder + transactional email provider; don't hand-build one | 7 |
| 4b | Drip campaign to un-booked quotes; deposit, pre-move and post-move emails | ⬜ | Needs an event/scheduler + unsubscribe handling (CAN-SPAM) | 7 |
| 4c | Auto-resend updated written proposal when date/time/address changes | ⬜ | Hooks into `save_dispatch_job`/`write_job_quote` + proposal PDF | 7 |
| 5 | Square: auto $50 deposit request on booking (in-town); out-of-town manual | ⬜ | Deposit amounts already computed. `square` method allowed in schema | 3 |
| 6 | QuickBooks Online: sales + contractor labor costs | ⬜ | Needs final invoices (Ph 2) and labor cost (Ph 6) first | 8 |
| 7a | Truck colors (customizable) + truck/crew availability | 🟡 | Trucks ✅. No color or availability/time-off | 5 |
| 7b | Capacity rules per truck/day: ≤2 one/two-bedroom apartments; 1 house (1-bed house counts as apartment); flat-rate unrestricted; no-truck job = one 1-bedroom apartment for its crew; arrival windows (8–9, 12–2); warning + admin override | 🟡 | Overlap conflicts ✅. No windows (single `arrival_time`), no bedroom/location data, no override log | 5 (needs 1b) |
| 7c | Crew leader GPS; auto ETA text to customer when they start navigation | ⬜ | **Decided:** location only while the app is open ("while using the app" permission). One location reading when the crew leader taps *Navigate to customer* → ETA text → hand-off to Google/Apple Maps. Needs customer SMS consent (SMS-1) | 9 |
| 7d | Driving-habit monitoring (speeding, off-route) | ⏸ | **Deferred (owner, 2026-11-24).** If needed later: a GPS tracker installed in each truck (the phone can't track while Maps is in front), with the app pulling its speed/route reports. See GPS-1/2 | Later |
| 7e | Crew texted 1 day before assignment, report time = earliest window − 1 hr; ASAP if <24 h; skip for 2nd job same day | ⬜ | Staff-facing SMS (staff consent still needed) + scheduler | 5 |
| 8a | Onboarding/training: admin-managed documents + videos, e-sign, must finish before working a job | ⬜ | Gate assignment in `save_dispatch_job` on completion. Get classification advice first (GPS-2) | 6 |
| 8b | Staff see their earnings per job/week/month | ⬜ | Needs pay rates + locked time entries | 6 |
| 9 | Referral portal (realtors/apartment managers): login, track referred jobs, rewards | ⬜ | New external role, scoped strictly to their own referrals. See REF-1 | 9 |
| 10 | Import customers from Excel (also for future software buyers) | ⬜ | The old customer records are in Excel, so this tool *is* the migration | 4 |
| 11 | Custom multi-page mobile BOL: tabs *Customer Info / Pricing / Contract*, hamburger → Notes, Camera; editable start/finish; piano/safe fees; packing materials with quantities (S/M/L/D/W boxes, paper, bubble wrap, tape); discounts and break/damage clock rollback; required signatures can't be skipped; final signature after finish; last page payments; job photos | ⬜ | Core of the crew app. Tables for time/photos/payments exist. Photo upload by any assigned crew member is already allowed by storage policy | 2 |
| 12 | Profit dashboard: sales by day/week/month/year, labor cost per job, miles per job | ⬜ | Needs final invoices + labor cost. Miles from the mapping API or GPS | 8 |
| — | Sell software to other moving companies (mentioned in #10) | 🟡 | Schema is multi-tenant. Edge Functions are hard-coded to `the-movers`. No company onboarding/billing | Later |

## 4. Risks found (code + feature list)

### Security / privacy
- **SEC-1 (High)** `authenticated` has direct INSERT/UPDATE/DELETE on `jobs` and `job_assignments`. Office sessions (or a stolen office token) can bypass server pricing and conflict checks and hard-delete jobs. *Fix:* RPC-only writes.
- **SEC-2 (High)** The `time_update` policy lets crew rewrite their own start/finish times indefinitely, with no lock or audit. *Fix (decided rules):* crew-leader time edits are allowed until the job is completed and paid, then locked on the server. Discounts are capped at 20% on the server. Every change is audited.
- **SEC-3 (Med)** Office can edit any `payment_records` column after confirmation. There is no audit trail.
- **SEC-4 (Med)** Implicit auth flow (prefer PKCE). The 12-character password minimum is browser-only. No MFA. Default Supabase email sender.
- **SEC-5 (Med)** No Git, migrations or CI. SQL is pasted by hand. The deploy folder holds 3 stale bundles and a nested `assets/assets/`. Applied schema is unknown.
- **SEC-6 (Med)** One Supabase project serves dev, previews and production. Backups/PITR are unconfirmed.
- **SEC-7 (Low)** `.env.local` (short-lived VERCEL_OIDC_TOKEN) syncs through OneDrive.
- **SEC-8 (Decided)** Crew leaders see pricing and customer information, including phone numbers, on their assigned jobs. Today they can't read the customer phone at all (`customers` is office-only), so Phase 2 adds a crew-leader job view. Movers can take job photos. What else they see is still open (§7).
- **SEC-9 (Resolved) SSNs (feature 1e).** SSNs stay in QuickBooks Online. This app stores only a "W-9 on file" flag, which avoids the Texas breach-notification exposure (Bus. & Com. Code ch. 521). Keep SSNs out of notes and uploaded onboarding documents too.
- **SEC-10 (Med)** New public surfaces need abuse controls: the WordPress lead form, the referral portal and the AI agent. That means rate limiting, CAPTCHA/Turnstile, and no booking or pricing writes without server rules.

### Data
- **DAT-1 (Med)** Phone/email are free text with no E.164 or dedupe. Feature 1a adds a second phone, and the Excel import will bring in mixed formats, so normalization matters more.
- **DAT-2 (High)** The address model must change (1 → up to 5 stops with location details) before the BOL, capacity rules, mileage and the Excel import. Changing it later means migrating twice.
- **DAT-3 (Med)** There is no final-invoice model (time, materials, fees, discounts, balance). Payments, the time lock ("paid"), QuickBooks and the profit dashboard all depend on it.
- **DAT-4 (Med)** No audit log. DST-ambiguous conflict checks (Low). No restore drill.
- **DAT-5 (Med)** The arrival *window* (e.g. 12–2) replaces a single arrival time. Conflicts, crew report time (window start − 1 h) and customer messages all depend on it.

### SMS / email / AI compliance
- **SMS-1 (High)** No customer consent records. T-Mobile history, estimate phones and phones imported from Excel are **not** consent. Imports default to *not enrolled*. Consent must cover each program (transactional reminders vs marketing/drip/review).
- **SMS-2 (High)** In-app STOP handling covers only the test number. Real customers' STOPs are not recorded. Production needs global suppression from any number, a pre-send check, and revocation by "reasonable means" (FCC TCPA rule). Keep Twilio Advanced Opt-Out on.
- **SMS-3 (Med)** Drip, review and retargeting messages are marketing. They need express written consent and must match the approved A2P campaign, which may need a new campaign or use case.
- **SMS-4 (Med)** Texas SB 140 (2023) applies the state telemarketing statute to texts. Quiet hours apply in the company timezone. **Confirm with counsel.**
- **SMS-5 (Med)** Staff texts (feature 7e) also need contractor opt-in and STOP handling. Collect consent during onboarding.
- **EML-1 (Med)** Drip/marketing email needs CAN-SPAM handling: unsubscribe link, physical address, honor within 10 business days. Authenticate the sending domain (SPF/DKIM/DMARC) or Gmail/Yahoo will junk it.
- **AI-1 (High)** AI calls/texts: the FCC treats AI-generated voices as "artificial" under the TCPA, so outbound AI calls need prior express consent. Inbound answering is lower risk. Disclose that it's a virtual assistant (your list already says so). Recording or transcribing calls needs a notice. The agent must be unable to invent prices, so quotes come only from `write_job_quote`. Bookings stay within owner-set rules, and everything else escalates. Log every AI action.

### Location monitoring & worker classification
- **GPS-1 (High → Med with decided design)** Owner rule: movement is tracked **only while the person is in the company truck using the app**.
  - The app asks for location **only while in use** (browser prompt / iOS "While Using the App" / Android foreground only). No background tracking, and no tracking off the clock or outside jobs.
  - Phone location is used only for single readings during an active assigned job (the ETA on *Navigate*).
  - Driving-behavior monitoring is deferred. If added later, it comes from a GPS tracker installed in the truck, not from personal phones.
  - Notice and consent text goes into onboarding. Location data is kept for a limited time (suggested 90 days unless tied to an incident or claim).
  - The permission prompt explains why it's needed. If permission is refused, the crew member can still use the app, but no ETA text is sent.
- **GPS-2 (High, confirmed) Contractor classification.** All crew except the owner are 1099 contractors. Mandatory training before working, monitoring their driving, setting report times and paying by the hour are all signs of employee-level control. They raise misclassification risk with the IRS, DOL and the Texas Workforce Commission (back taxes, penalties, overtime claims). **Have an employment attorney or CPA review the onboarding, GPS and driving-monitoring features before Phases 6 and 9.** Their advice may change how those features are worded or whether they're built.

### Payments / referral
- **PAY-1 (High if mishandled)** Card data only through Square-hosted checkout or the Web Payments SDK (SAQ-A). The CSP must allow Square domains.
- **PAY-2 (Med)** Signed, idempotent Square webhooks. Mirror refunds and chargebacks.
- **PAY-3 (Med)** Crew-collected cash and payments on the BOL's last page: office confirmation + daily reconciliation.
- **REF-1 (Med)** Paying realtors referral rewards may trigger Texas real-estate-licensee disclosure rules (TREC). Apartment-manager rewards may conflict with their employer's policies. Gift-card rewards over $600/yr per referrer may need 1099 reporting. **Confirm before launch.** Referrers must see only their own referrals' status, never customer details beyond what they submitted.

## 5. Phased plan

Sizes: S ≈ 2–4 days · M ≈ 1–2 weeks · L ≈ 2–4 weeks · XL ≈ 1–2 months (rough, not commitments).

The three areas originally requested are Phases 2 (crew tools), 3 (payments) and 4 (old records). Phases 0–1 are prerequisites. Phases 5–9 cover the rest of the feature list.

### Phase 0 — Foundation hardening (M)
Git repo + `supabase/migrations` (01–04 baseline) + CI running the existing 110 tests. Schema diff against hosted. Separate production project + PITR + restore drill. PKCE, password policy, MFA for office, custom SMTP. RPC-only writes for jobs and assignments (SEC-1). `audit_log` triggers. E.164 helper.

### Phase 1 — Customer & job data model v2 (M) — features 1a–1d
Customer first/last name, primary/secondary phone (E.164), referral source. `job_stops` (ordered, up to 5; type, bedrooms, floor, unit, access notes) replaces the two address columns. A migration backfills existing jobs into 2 stops. Arrival window start/end (DAT-5).
- **Location types:** apartment, house, townhouse, high-rise, storage, office, warehouse, **retail** (added from the old spreadsheet's codes).
- **Service type per job (new, found in the old spreadsheet):** full move · load only · unload only · pack only · same complex. Plus a **truck needed** yes/no flag. A no-truck job can't have a truck assigned. It **counts as one 1-bedroom apartment toward the assigned crew's daily limit** (owner rule, 2026-11-24; see Phase 5).
- **Customer tags:** repeat, VIP (editable list).
- Server-side search by name/phone/email/address. Update `write_job_quote`/`save_dispatch_job` and the estimate UI.
*Why first:* the BOL, capacity rules, mileage and the Excel import all depend on this shape (DAT-2).

### Phase 2 — Crew app & bill of lading (XL) — feature 11 (+ original "crew job tools")
1. **Crew-leader job view (decided):** pricing, customer info (name, phones, email, stops with details), access instructions, window, crew, truck. Never office notes. Movers get a reduced view (scope per §7).
   - Allow the **owner** to be assigned to jobs as crew. Today `save_dispatch_job` only accepts `mover`/`crew_leader` roles.
2. Mobile-first BOL with tabs **Customer Info · Pricing · Contract** and a hamburger menu → **Notes**, **Camera**. Multi-page with Next at bottom-right. Signature pages can't be skipped. The final signature comes after the finish time.
3. Pricing page 1: hourly rate, service charge, start/finish times. Pricing page 2: piano, safe, packing materials with quantities (S/M/L/D/W-box, paper, bubble wrap, tape) from an admin-editable price list.
4. **Adjustments (decided):**
   - The crew leader can give a discount of **up to 20%**, checked on the server, with a required reason. Anything larger needs an admin.
   - Clock rollback for breaks or damages counts as a time edit (rule 5).
   - Every discount and time change is audited and shown to the office.
5. Job lifecycle RPCs: start_job / complete_job.
   - **Time rule (decided):** the crew leader can edit start/finish times until the job is **completed and paid in full**. After that, crew-leader time edits are locked on the server.
6. Final invoice snapshot: billed minutes per min/increment rules + fees + materials − discount = `final_total_cents`, kept alongside the original quote. "Paid in full" = payments ≥ final total.
7. **Photos (decided):** crew leaders **and movers** assigned to the job can take photos from the Camera menu, uploaded to the private `job-photos` bucket. The existing storage policy already allows any assigned crew member. Compressed and tagged before/after/damage. Only office can delete them, for liability.
8. Contract templates: admin-editable BOL text/pages, versioned. The signed version is frozen as a PDF in storage. Confirm TxDMV household-goods (intrastate) and FMCSA (interstate) BOL content requirements.
9. Online-only v1 with retry. Offline queue is a decision.

### Phase 3 — Payments (L) — feature 5 (+ BOL payments page)
- **3a Offline payments:** cash/Zelle/check recorded on the BOL last page or by the office. Crew-reported, office-confirmed, immutable after confirmation, with daily reconciliation per crew leader.
- **3b Square:** on **booking an in-town job**, send a $50 deposit link automatically (by email until SMS consent exists). Out-of-town deposits are sent manually by office. Card payment for the balance on the BOL payments page. Signed, idempotent webhook writes `payment_records`. Refunds start in the Square dashboard and are mirrored.
- **3c Invoice/receipt:** PDF from the final snapshot.

### Phase 4 — Excel import + old customer records (M) — feature 10
One import tool covers feature 10 and the migration. There are three sources:

**Source A — Square customer export** (`square_customers-11-24-2026.csv`, profiled 2026-11-24)
- **Contents:** 3,821 profiles, customer contact details only (no addresses, no move history). Names are already split into first/last. 3,251 phones, all US and convertible to +1 format with no manual fixing. 3,487 emails, all valid-looking. Every row has a Square Customer ID. Visits run 2024-01-01 → 2026-11-23.
- **Owner decisions:**
  - **Import all 3,821 as past customers**, including the 2,665 with 0 Square transactions (likely brought over from an old Square account). None are leads.
  - **Keep the 331 with no phone or email**, flagged *Needs contact info* so the office can fill them in later. 38 of these have no name either, so they'll show as "Unnamed (Square ID …)". 57 have Square transactions.
  - The 221+ profiles with Square **merge memos are already clean**, so the memo isn't imported.
- **Review list, not auto-merge:** 22 phone numbers and 59 emails are shared by more than one profile (often a couple or family). The office decides whether to merge.
- **Field mapping:**

  | Square column | App field |
  |---|---|
  | First Name / Last Name | first / last name |
  | Phone Number | primary phone (+1 format; strip the leading `'`) |
  | Email Address | email (lowercased for matching) |
  | Square Customer ID | Square link (reused by Phase 3 so Square doesn't get duplicate profiles) |
  | Email Subscription Status | email marketing block when `unsubscribed` (257) or `bounced` (20) |
  | First/Last Visit, Transaction Count, Lifetime Spend, Total Spend | read-only "Square history" summary |
  | Creation Source, Instant Profile, Reference ID | import log only |
  | Memo (merge notes) | not imported |

- **SMS consent:** none in the file, so every customer starts *not enrolled* for texts (SMS-1).

**Source B — move-history spreadsheet** (`The Movers - Jobs Booked-11-24-26.xlsx`, profiled 2026-11-24; owner confirmed the codes)
- **Contents:** one sheet, 3,539 moves dated 2020-07-28 → 2026 (2020: 267 · 2021: 743 · 2022: 614 · 2023: 482 · 2024: 492 · 2025: 504 · 2026: 426), plus **14 future booked moves**. About 2,675 distinct customers by phone.
- **Linking to Source A:** 3,246 moves match a Square customer by phone and 63 by email. **230 have no match**: they create new customers after review.
- **Column mapping:**

  | Column | App field |
  |---|---|
  | DATE (Excel date) | move date. ~10 text values ("TBD" or date ranges) → review list |
  | TIME ("8-9AM", "12-2PM", "9AM", "OPEN") | arrival window start/end. A single time = start only. OPEN = no window |
  | DAY | not imported. Used only to cross-check DATE (mismatch → review) |
  | NAME | linked customer + job's customer-name snapshot |
  | PHONE (1 or 2 numbers) | match key. A 2nd number → customer's secondary phone (66 rows) |
  | EMAIL | match key / email when the customer has none. `unknown?` → blank |
  | PRICE `crew / hourly / service charge / deposit` | crew size, hourly rate, service charge, deposit (hourly job) |
  | PRICE `crew / N FLAT / deposit` (`NONE` = no deposit) | crew size, flat price, deposit (flat job) |
  | PRICE `unknown` / extras (e.g. "safe", "%") | price blank + review list / extras kept in job notes |
  | PICK-UP, DROP OFF | stop 1 (pick-up) and last stop (drop-off) addresses |
  | P/U, D/O codes | location type + bedrooms per stop (table below). Two codes ("APT STR") = an extra stop of the second type, with no address |
  | NOTES | parsed into tags/service type (below). The full text is also kept in office notes |

- **Location codes (confirmed):** `APT` apartment · `1APT`/`2APT` apartment with 1/2 bedrooms · `2B`–`5B` house with 2–5 bedrooms · `HS`/`H` house (bedrooms unknown) · `TH`/`2TH` townhouse (2TH = 2 bedrooms) · `STR` storage · `WH` warehouse · `OFC` office · `RET` retail · `-` not recorded.
- **Notes parsing:**
  - "repeat customer" (503) → `repeat` customer tag
  - "vip customer" (68) → `vip` tag
  - "load only / unload only / pack only – no truck" (~220) → service type + truck not needed
  - "same complex – need truck / no truck" (~95) → service type `same_complex` + truck needed yes/no
  - "cancelled" (35) → status cancelled
- **Status rule:** past dates → completed, unless cancelled. Future dates (14) → booked, imported **without** truck or crew, then dispatched normally.
- **Prices:** imported exactly as recorded and flagged `legacy`. They are never recalculated with current rates.
- **To review:** 45 unknown prices, 12 unknown phones, 67 unknown emails, ~10 non-date values, the 2027 date (check for a typo), DAY/DATE mismatches.

**Source C — paper records**
- Out of scope for the import tool. Options: enter recent or important moves by hand through a quick "add past move" form, or scan them and store them as documents on the customer.

**Import steps**
1. **Now:** share Source B so its columns can be mapped.
2. Import engine: upload `.xlsx`/`.csv` → column mapping screen (saved for reuse) → staging tables → validation (E.164 phones, split first/last name, dedupe by phone/email/address with a review list) → commit tagged with `import_batch_id` so a bad import can be undone.
3. Dry run on a test database, then a summary (rows read, imported, duplicates, rejected with reasons). Owner signs off, then import to production after a backup.
4. Imported phones carry **no SMS consent**.
5. If the file includes past jobs, they import as completed with their original prices flagged `legacy`. Future jobs import unassigned and are then dispatched normally.
The same tool later serves other companies buying the software.

### Phase 5 — Dispatch rules & crew notifications (L) — features 7a, 7b, 7e
Truck colors (admin-chosen) shown on the calendar. Truck and crew availability/time-off. Capacity rules engine per truck/crew per day: ≤2 apartments of 1–2 bedrooms, ≤1 house (a 1-bedroom house counts as an apartment), flat-rate exempt. **No-truck jobs** (load only, unload only, pack only, same complex without a truck) count as **one 1-bedroom apartment for the crew assigned to them**, so a crew can do e.g. one no-truck job + one apartment, or two no-truck jobs, in a day. Violations give a warning, and an admin override records who and why. Staff SMS the day before (report time = earliest window − 1 h), sent ASAP if under 24 h, skipped for a second job within the 1-hour rule. Staff SMS consent comes from onboarding (SMS-5).

### Phase 6 — Staff records, onboarding/training, earnings (L) — features 1e, 8a, 8b
- **Staff profile:** phone, address, pay rate history, worker type (`1099_contractor` for crew; `owner_salaried` for the owner). No SSN; only a "W-9 on file" flag (SEC-9).
- **Training:** admin-managed modules (uploaded docs → PDF/viewer, videos), e-signature acknowledgments, completion tracking. Dispatch blocks assignment until onboarding is complete.
- **Earnings:** view per job/week/month from locked time × rate, for contractors.
- **Labor cost per job** = sum of contractor hours × their rates. The owner's hours are tracked, but their labor cost is **$0**, because their salary is already handled in QuickBooks.
- Get classification advice before building (GPS-2).

### Phase 7 — Leads & customer communications (XL) — features 2, 4a–4c
- **Leads:** public lead endpoint + WordPress form (or an embeddable app form) → `leads` → in-app/web push alert to admin.
- **Email:** transactional email provider + embedded drag-and-drop template builder (header/footer/logo).
- **Automations:** deposit received, pre-move reminder, post-move follow-up, updated proposal on date/time/address change.
- **Drip** for un-booked quotes, with unsubscribe (EML-1).
- **Customer SMS** only after the consent model, global suppression and quiet hours are built (SMS-1…4).

### Phase 8 — QuickBooks & profit dashboard (L) — features 6, 12
- **QuickBooks Online:** OAuth connection. Push sales (invoices/payments), and push contractor labor cost as 1099 vendor bills or payments so the 1099-NEC totals stay correct. Each sync is idempotent and logged. The owner's salary is not pushed; it's already set up in QuickBooks. Contractor SSNs/W-9s live only in QuickBooks.
- **Dashboard:** sales, labor cost, gross margin per job, by day/week/month/year. Miles per job from the routing API (planned) or GPS (actual).

### Phase 9 — Advanced (XL, each item separable) — features 3, 7c, 7d, 9
- Referral portal: referrer accounts, submit referral, status tracking, reward ledger (REF-1).
- ETA text to customer: a *Navigate to customer* button on the crew-leader job screen. It asks for location only while the app is in use, takes one reading, gets the drive time from a routing API, texts the ETA (needs SMS consent), then opens Google/Apple Maps. No continuous or background tracking (GPS-1).
- ~~Driving monitoring~~ **Deferred.** If it's needed later, buy a GPS tracker per truck (e.g. Samsara, Verizon Connect, Motive) and import its alerts. Don't use phone tracking for this. Review with your attorney/CPA first (GPS-2).
- AI agent: start with SMS/email lead intake that drafts quotes for office approval. Then rule-bound auto-booking. Voice answering last (AI-1).

### Dependencies
```
Phase 0 ─► Phase 1 (data model v2) ─┬─► Phase 2 (crew app/BOL) ─► Phase 3 (payments) ─► Phase 8 (QBO, dashboard)
                                    ├─► Phase 4 (Excel import = old records) [share the Excel file now]
                                    └─► Phase 5 (dispatch rules)
Phase 6 (onboarding, pay rates) ─► Phase 5 staff SMS consent, Phase 8 labor cost, Phase 9 GPS consent
Attorney/CPA review (GPS-2) ─► Phase 6 training gate, Phase 9 GPS/driving monitoring
Phase 7 (leads/email/SMS consent) ─► Phase 9 (AI agent, ETA texts, referral rewards emails)
Cutover from prototype: needs 1, 2, 3a, 4
```

## 6. Risk register

| ID | Risk | L | I | Mitigation | Phase |
|---|---|---|---|---|---|
| R1 | Direct table writes bypass pricing/conflict checks | M | H | RPC-only writes, audit log | 0 |
| R2 | Crew edits times, discounts or rollbacks without control (payroll/revenue loss) | M | H | 20% server-side discount cap; time lock once completed + paid; audit; office review | 2 |
| R3 | Address model changed after other features are built on it | H | H | Do Phase 1 before 2/4/5 | 1 |
| R4 | SSN breach | L | H | Decided: SSNs only in QuickBooks Online | 6 |
| R5 | Customer texted after STOP | M | H | Global suppression, pre-send check | 7 |
| R6 | Texting/emailing without documented consent (TCPA/CAN-SPAM) | M | H | Consent records per program; imports unenrolled; counsel | 7 |
| R7 | AI agent quotes wrong prices or books bad jobs | M | H | Server pricing only, rule-bound booking, escalation, logs | 9 |
| R8 | AI voice calls violate TCPA | M | H | Inbound only at first; consent for outbound; disclosure | 9 |
| R9 | 1099 crew reclassified as employees because of training, GPS or driving monitoring | M | H | Attorney/CPA review before Phases 6/9; adjust features to the advice | 6/9 |
| R10 | Old customer Excel file is messy (merged names, mixed phone formats, duplicates) | H | M | Column mapping, validation, dedupe review, dry run, batch rollback | 4 |
| R11 | Duplicate customers after import | H | M | E.164, dedupe review, batch rollback | 1/4 |
| R12 | Schema drift / wrong SQL applied | M | H | Git, migrations, CI, schema diff | 0 |
| R13 | Data loss without tested restore | L | H | PITR + drill before import | 0 |
| R14 | Card data in app scope (PCI) | L | H | Square-hosted only | 3 |
| R15 | Duplicate or missed payments from webhooks | M | M | Signed, idempotent webhook | 3 |
| R16 | Cash collected but not deposited | M | M | Office confirmation + reconciliation | 3 |
| R17 | Crew loses signal mid-BOL (lost times/signatures/photos) | H | M | Retry; evaluate offline queue; draft autosave | 2 |
| R18 | BOL not legally sufficient (TxDMV/FMCSA) | M | M | Confirm required content | 2 |
| R19 | Marketing email lands in spam or breaches CAN-SPAM | M | M | SPF/DKIM/DMARC, unsubscribe, provider | 7 |
| R20 | Lead form/portal spam or abuse | H | L | CAPTCHA, rate limits, no auto-booking from public input | 7/9 |
| R21 | Referral rewards conflict with TREC/1099 rules | M | M | Legal check; reward ledger | 9 |
| R22 | Test and real data mixed in one project | H | M | Separate production project | 0 |
| R23 | Scope (13 feature areas) delays cutover | H | M | Cut over after 1, 2, 3a, 4; the rest follows live | all |

## 7. Decisions

### Made (2026-11-23)
- **Old records:** they come from 3 sources (§5 Phase 4): the Square customer export (received), a move-history spreadsheet (received and mapped) and paper records.
- **Move-history import (2026-11-24):** the PRICE order (crew / hourly / service charge / deposit; flat = crew / price / deposit) and the location codes are confirmed. "Same complex" means both units are in one complex, and the truck may or may not be needed.
- **Square import (2026-11-24):** import all 3,821 profiles as past customers, including those with 0 transactions and those with no phone or email (flagged *Needs contact info*). The merged profiles are clean.
- **SSNs:** kept in QuickBooks Online only, never in this app.
- **Worker types:** all crew are 1099 contractors. The owner is salaried (set up in QuickBooks), can work jobs as crew, and adds $0 to labor cost.
- **Crew leader permissions:** sees pricing and customer info; edits start/finish times; gives discounts up to 20%. Time edits are locked once the job is completed and paid.
- **Photos:** movers as well as crew leaders can take job photos.
- **Location:** tracked only while the crew member is in the company truck using the app. Permission is "while using the app" only, never in the background. For now only the ETA text uses location. Driving-habit monitoring is **deferred**; if added later, it uses a truck-installed GPS tracker (2026-11-24).

- **Phase 2 decisions (2026-11-27):** movers see job basics only (no prices, no customer phone); crew-leader discount up to 20% of the whole job total; crew time edits lock once completed and the crew records full payment (office can correct, with a reason); online with retry, no offline mode in v1. Plan: docs/PHASE2_PLAN.md.
- **Go-live timing:** production upgrade to Pro and the real import happen together, about a month out, from fresh exports.

### Still open
1. **Movers:** what else do they see? Suggested: addresses, times and access notes, but no prices or customer phone.
2. **20% of what?** Suggested: the job total before the discount (labor + service charge + fees + materials).
3. **"Paid" for the time lock:** when the crew leader records the payment, or when the office confirms it? Suggested: when it's recorded, so times can't change after the customer has paid.
4. **After the lock:** can an admin still correct times (with a reason, audited)? Suggested: yes.
5. **Square:** confirm, and send the deposit link by email until SMS consent exists?
6. **Offline:** is an online-only crew app OK for v1, or is offline required?
7. **Production database:** separate production Supabase project, yes or no?
8. **WordPress:** embed an app-hosted form, or connect the existing form plugin (which one)?
9. **Priorities:** order for Phases 5–9 after cutover.
10. **Paper records:** manual entry form or scanned documents?
