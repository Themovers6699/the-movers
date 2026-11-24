# Environments

| | Testing / development | Production |
|---|---|---|
| Supabase project ID | `yohmygccqdomiynnkobn` | `oeiotkbwpnvvjxweppwi` |
| Supabase URL | https://yohmygccqdomiynnkobn.supabase.co | https://oeiotkbwpnvvjxweppwi.supabase.co |
| Plan | Free | Free for setup. **Upgrade to Pro (daily backups) and run one restore test before importing real customer data or going live.** |
| Data | Test accounts, test jobs, Twilio test messages | Real customers and jobs only (none yet) |
| Twilio | Connection-test webhook points here | Not connected yet |
| Vercel | `the-movers/the-movers-login-dev` | To be set up |

Project IDs and URLs are not secrets. Database passwords, service-role/secret keys and Twilio credentials must never be written in this repository.

## Applying database changes

Always apply to **testing first**, check the preview app, then production:

```
npx supabase@latest link --project-ref <project id>
npx supabase@latest migration list
npx supabase@latest db push
```

History: migrations 20261112000000 through 20261116000000 were pasted into the testing project by hand before this repository existed. On 2026-11-24 the schema fingerprint (`supabase/checks/schema_fingerprint.sql`) confirmed that the testing project exactly matches them, apart from Supabase's own `rls_auto_enable` helper. They were then marked as applied with `supabase migration repair`.

## Releasing a migration together with the app

If a migration removes something the current app uses, release the new app immediately after `db push`. Example: 20261124000000 removed direct job updates, which the old **Book** button relied on.
