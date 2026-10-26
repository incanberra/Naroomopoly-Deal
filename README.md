# Naroomopoly Deal

A standalone South Coast card game: collect local properties, charge holiday rent, and build three complete sets. Private online tables for 2–5 players and saved practice games against 1–4 computer opponents.

## Play locally

Requires Node.js 22 or newer.

```sh
npm ci
npm run dev
```

Open the local address printed by Vite. Choose **Practice with Bots** for a complete game without a backend. Practice saves on this browser; **Resume practice** returns to it. Clearing browser storage removes the save. Internet is needed to load the website initially; this release is not an installable offline PWA.

The configured project is `Naroomopoly_deal` (`yonompyisblqnlpapkpe`). Its public connection settings are in your local, untracked `.env.local`. For another checkout, copy `.env.example` to `.env.local` and fill in the project URL and public publishable/anon key. Never put a service-role key in a `VITE_` variable.

## Online tables

Choose **Play with Friends**, enter a name, pick an avatar, and create a room. Share the five-letter code or invitation. The host starts when 2–5 people have joined. Each player uses a separate browser/device; two tabs in the same browser share an authenticated identity.

Guest identity is stored in the browser. Refreshing restores the seat and private hand. Moving to another device or clearing browser storage cannot recover an anonymous seat. A network interruption waits for reconnection; it never creates a separate local copy of the online game. Unacknowledged commands retain their request ID across refreshes.

There are no move or response deadlines. If the host explicitly returns home, ownership transfers to a recently connected player; their own seat stays reserved. Closing a tab without using Leave does not automatically transfer ownership. The host can end an abandoned table. Leaving a lobby removes that seat; leaving an active game preserves the seat for reconnection.

## What’s implemented

- All 106 playable cards: 28 named properties, 11 wildcards, 20 money cards, 34 action cards, and 13 rent cards. Four paper reference cards are replaced by the in-app rules.
- Actual locations from the source game’s data, including Congo / Meringo / Tuross and Kianga / Dalmeny / Wagonga Inlet.
- Guided plays with legal targets, a review step, payments chosen by the debtor, counter-block chains, rent boosters, buildings, wildcard rearrangement, discards, and turn-based victory checks.
- Original vector coastal artwork, light/dark themes, optional sound, reduced motion, keyboard-accessible dialogs, and mobile layouts.
- Bots using only their own private view and public information, including set completion, wildcard moves, banking, and disruption.
- Server-side rule enforcement, private projections, atomic updates, request receipts, and version conflict checks.

## Rules and digital conventions

The reference is Hasbro’s E3113 Monopoly Deal edition. Local names and artwork change presentation; money uses the familiar M denominations and the card economy is separate from the board game’s prices. See `src/game/catalogue.ts` for the entire card catalogue and `src/game/engine.ts` for enforcement.

The in-app guide states the conventions used where physical play needs a digital choice:

- At least one named property is needed in a completed set; a pile entirely of wildcards does not count as a set for victory or building.
- Discards form a shared pile, reshuffled when the draw pile is exhausted. With no cards in either pile, drawing yields fewer cards.
- Rent and other multi-player demands resolve one debtor at a time in seat order. Each targeted player can accept or block. Response cards do not use the active player’s three plays.
- A banked action remains money when transferred. Payment properties join an available group of their currently assigned colour, or start a new group. The recipient can rearrange wildcards on their turn.
- Buildings from a broken set become unassigned improvements. Buildings received as collection payments also become unassigned; attach them to a legal set on your turn for free. A takeover includes attached buildings.
- Each set holds only its required number of cards. Additional cards of the same colour start another group. Three **different** complete colours win, on the winner’s own turn after pending actions finish.
- Paired-colour rent charges all opponents; any-colour rent charges one. Rent boosters are chosen with the rent card, and each booster uses one play. Two boosters quadruple rent and consume all three plays.

## Architecture

`src/game` is a pure TypeScript catalogue, state machine, view projection, command parser, and bot policy. Both local practice and the Edge Function import the same engine.

Online commands contain only game ID, request ID, expected version, and intended action. The function validates the bearer token with Supabase Auth, derives the actor, checks membership, and executes the engine. A database transaction commits the complete state, every participant’s projection, and a duplicate-request receipt together. Browser clients cannot read complete state, deck order, receipts, or membership records and cannot write projections.

Realtime subscriptions listen only to `deal_views`, with row-level access restricted to the current user. Polling every 15 seconds and re-fetching after subscription recovery provide a fallback. Full states and tokens are not written to the public event log. The publishable key grants no administrative access.

## Verification

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

The normal suite uses real embedded PostgreSQL for permissions and transactions. It covers card conservation, full two- and five-player bot matches, payment/building/stealing rules, counter-blocks, private views, malformed requests, atomic updates, duplicate receipts, stale versions, and interrupted-request recovery. Browser checks cover desktop and phone layouts, guided plays, refresh/resume, payments, blocks, discards, and settings. Hosted replication itself is verified with the optional online tests, not emulated by the embedded database.

Live tests create anonymous accounts and private test rooms in the configured project. They end their games but retain guest accounts and game records. Run these only in an explicitly approved project:

```powershell
$env:DEAL_LIVE_TESTS='1'
npx vitest run tests/live.test.ts
```

For two independent live browser sessions:

```powershell
$env:DEAL_ONLINE_BROWSER='1'
npx playwright test tests/browser/online.spec.ts
```

If using an already installed Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable. Normal browser tests deliberately disable online configuration so they never create cloud users or rooms.

## Deploy

See [DEPLOYMENT.md](DEPLOYMENT.md) for the database, function, website, and recovery steps. Production assets are built into `dist/`. The workflow checks the app before publishing GitHub Pages. Changing the rules requires deploying both the website and Edge Function together; finish existing matches before incompatible rule changes.

An independent fan project celebrating the NSW South Coast, inspired by [Naroomopoly](https://github.com/incanberra/Naroomopoly). Not affiliated with or endorsed by Hasbro. No official card scans or logos are used. Game references: [Hasbro E3113](https://instructions.hasbro.com/en-au/instruction/monopoly-deal-card-game).
