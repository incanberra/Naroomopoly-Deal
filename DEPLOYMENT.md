# Deployment and handover

## Current targets

- Website repository: `incanberra/Naroomopoly-Deal`.
- Website: `https://incanberra.github.io/Naroomopoly-Deal/`.
- Supabase project: `Naroomopoly_deal`, project reference `yonompyisblqnlpapkpe`.
- Game endpoint: `https://yonompyisblqnlpapkpe.supabase.co/functions/v1/deal`.

The database and Edge Function are separate from the original board game. All new tables use the `deal_` prefix. No original Naroomopoly files or game records are modified.

## Backend setup for a new project

1. Create a Supabase project. In Authentication → Sign In / Providers, enable **Allow anonymous sign-ins**.
2. Run `supabase/migrations/202610260001_deal.sql` once in the SQL editor. It creates five protected tables, two server-only functions, and the Realtime publication for per-player views. Do not rerun the migration over an installed schema; use an additive migration for future changes.
3. Deploy `supabase/functions/deal/index.ts` as function **deal**, including its imported shared engine. With a signed-in Supabase CLI:

   ```sh
   supabase login
   supabase link --project-ref YOUR_PROJECT_REFERENCE
   supabase db push
   supabase functions deploy deal --no-verify-jwt
   ```

   For projects installed manually through the SQL editor, record the migration as already applied with the CLI’s migration repair command before using `db push`. Do not apply it a second time.

4. **Verify JWT with legacy secret** is off. This avoids legacy-key-only verification; the function itself always validates the caller’s access token using Supabase Auth and derives their identity. Missing/invalid tokens are rejected. Supabase provides its URL and service-role key to the deployed function; never copy the service key into the website.
5. Copy `.env.example` to `.env.local`, set the public project URL and publishable/anon key, then rebuild the frontend.

The single-file `supabase/deploy/deal.ts` and `.txt` are generated bundles for the dashboard editor. They include the same engine without relative imports. Rebuild them after any server or engine change:

```sh
npm run bundle:server
```

The dashboard deployment in this project used that bundle and the equivalent tested SQL migration. It is not tracked as a CLI migration history entry. Its SQL editor query is retained in the project dashboard.

## GitHub Pages

Repository variables:

- `VITE_SUPABASE_URL`: public Supabase URL.
- `VITE_SUPABASE_ANON_KEY`: public publishable/anon key.

These settings are intentionally included in the browser build. Administrative secrets must never use a `VITE_` name.

Enable Pages with **GitHub Actions** as the source. The included workflow installs locked dependencies, checks rules and database access, builds the site, tests desktop/mobile flows, and publishes `dist/` after success. Relative asset paths support the project subdirectory and room invitation query strings. No paid hosting or custom domain is required.

## Before sharing a release

- Start a private room in one browser and join using another browser or incognito context.
- Start the match, draw, and verify each hand is visible only to its owner.
- Refresh a player and confirm the same seat and cards return.
- Check that a third identity cannot read that room’s player views or complete game state.
- Exercise a payment and response, then end the test room.
- Confirm the deployed website and server use the same card catalogue/rules.

Optional live automation is documented in README and requires approval for its persistent test users/records. The regular CI suite never creates cloud test data.

## Operations and recovery

- Supabase logs show function errors, authentication failures, and invocation counts. Do not log bearer tokens, full requests, private hands, or complete game states.
- Commands have a per-user rate limit of 90/minute; creating rooms is limited to 10/hour/user. Anonymous signup also follows Supabase’s project limits.
- Connection problems display a reconnecting indicator. Once reachable, clients re-fetch their saved projection and safely retry uncertain commands with the same request ID.
- Guests must retain their original browser identity. There is no account migration or email-based recovery in v1.
- The host can end an abandoned game. Completed rooms and guest users are retained; no automatic deletion job is installed. Review retention when adding long-term public traffic.
- To roll back the website, rerun the last good GitHub Pages deployment. Restore the matching Edge Function bundle for a rules regression. This release has no destructive rollback migration.
- To rotate the public publishable key, update the repository variable and rebuild the website. A service-role or account token is never needed by a player.

## Release boundaries

No public matchmaking, spectators, chat, push notifications, native app, cross-device anonymous recovery, automatic AFK takeover, or new local card mechanics are included. This is a complete private-room and practice release with explicit digital rules documented in the app.
