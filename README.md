# The Movers — workspace app

The office and crew web app for The Movers: React/Vite front end (`app/`), Supabase database and Edge Functions (`supabase/`).

The plan, risks and decisions are in [docs/SCOPE.md](docs/SCOPE.md).

## Layout

| Path | What it is |
|---|---|
| `app/` | Web app (React 19, Vite, TypeScript). Deployed to Vercel. |
| `supabase/migrations/` | Every database change, in order. Never edit a migration that has already been applied to a hosted database; add a new one. |
| `supabase/functions/` | Edge Functions (`movers-sms-admin`, `movers-sms-webhook`). |
| `supabase/config.toml` | CLI settings (function JWT verification). No secrets. |
| `tests/database/` | PostgreSQL permission and business-rule tests (in-memory PGlite; Supabase Auth/Storage are stubbed). |
| `tests/edge/` | Edge Function handler tests with mocked Twilio/Supabase. |

## Run the tests (Node.js 24+)

```
npm run setup   # install dependencies once
npm test        # app + database + Edge Function tests
npm run build   # production build into app/dist
```

GitHub Actions runs the same steps on every push (`.github/workflows/ci.yml`).

## Rules

- **No secrets in the repo.** The browser app uses only the publishable key (`app/src/config.ts`). Service-role keys and Twilio/Square credentials belong in Supabase Edge Function Secrets.
- **No customer data in the repo.** `.csv`/`.xlsx` exports are git-ignored; keep them out of this folder.
- **Database changes go through migrations** in `supabase/migrations/`, never pasted into the SQL Editor by hand.
