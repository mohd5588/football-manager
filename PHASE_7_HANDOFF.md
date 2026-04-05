# Football Pyramid Manager — Phase 7 Handoff Prompt
## Session Starter for: Stadium Upgrades, Sponsorship, Morale & Loans

---

## HOW TO START THE SESSION

Paste this entire document into a new Claude chat (Claude Desktop preferred —
it has direct GitHub read/write access via the connected GitHub MCP tool).

Then say:
> "Please read the key files before we start"

Claude should then use the GitHub MCP tool to read:
- `src/types.ts`
- `src/worker/sim.worker.ts`
- `src/services/SimulationService.ts`
- `src/store/uiStore.ts`

---

## GITHUB ACCESS — HOW IT WORKS IN CLAUDE DESKTOP

Claude Desktop has a GitHub MCP connector with **read and write** access.

### Tools available:
```
github:get_file_contents   — read any file or directory listing
github:push_files          — push multiple files in one commit (preferred)
github:create_or_update_file — update a single file (requires SHA of existing file)
```

### Read pattern (always do this before writing):
```
github:get_file_contents
  owner: mohd5588
  repo:  football-manager
  path:  src/path/to/file.ts
```

### Write pattern — single file:
```
github:create_or_update_file
  owner:   mohd5588
  repo:    football-manager
  branch:  main
  path:    src/path/to/file.ts
  sha:     <sha from get_file_contents — REQUIRED for existing files>
  message: "Phase 7: description"
  content: <full file content>
```

### Write pattern — multiple files at once (preferred):
```
github:push_files
  owner:   mohd5588
  repo:    football-manager
  branch:  main
  message: "Phase 7: description"
  files:   [ { path, content }, ... ]
```

### ⚠️ SHA rule:
When updating an existing file with `create_or_update_file`, always fetch
the file first with `get_file_contents` to get its current SHA. Pass that
SHA in the call or GitHub will reject it with a 409 conflict error.
`push_files` does NOT need SHAs — it is always preferred for multi-file changes.

### After any commit:
Tell the user to run:
```bash
cd ~/Desktop/football-manager
git pull
```
Then hard refresh the browser with Cmd+Shift+R (worker changes require this).

---

## PROJECT OVERVIEW

A browser-based football management simulation modelled after Basketball GM.
92 clubs across the English Football Pyramid (EPL, Championship, League One,
League Two). ~1,840 players. Built as a solo project with Claude as dev partner.
All explanations must be in plain English — no assumed prior knowledge.

---

## TECH STACK (LOCKED — DO NOT CHANGE)

- React + TypeScript (Vite, react-ts template)
- Tailwind CSS for all styling
- Zustand for state management (gameStore + uiStore + inboxStore)
- Dexie.js for IndexedDB save slots
- Web Worker architecture (sim.worker.ts runs all simulation logic)
- Chart.js (Canvas) — player radar charts
- Recharts — line/bar charts
- Raw SVG — sparklines in tables

---

## ARCHITECTURE RULES (NON-NEGOTIABLE)

1. Components NEVER call postMessage or workerBridge directly
2. Components call SimulationService methods only
3. SimulationService is the ONLY thing that writes to gameStore
4. gameStore is READ-ONLY from the component perspective
5. `clubs` is a keyed OBJECT (`Record<EntityId, Club>`) — use direct key
   lookup, never `.find()` on clubs
6. `players` is also a keyed object — same rule
7. Prefer pre-computed fields from `ClientGameState` (`playerClub`,
   `nextFixture`, `playerStandingsRow`) over re-deriving them in components
8. All components use `export default function X()` — never named exports
9. Stores and type files use named exports (curly braces on import)
10. Never rename existing store fields without updating every call site

---

## DIRECTORY STRUCTURE

```
football-manager/
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── types.ts
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppShell.tsx          ← default export
│   │   │   └── Sidebar.tsx           ← default export
│   │   ├── dashboard/
│   │   │   ├── Dashboard.tsx         ← default export
│   │   │   ├── LeagueTable.tsx       ← default export
│   │   │   ├── NextFixtureCard.tsx   ← default export
│   │   │   ├── SimulateControl.tsx   ← default export
│   │   │   └── XGChart.tsx           ← default export
│   │   ├── squad/
│   │   │   └── SquadView.tsx         ← default export (has Academy filter)
│   │   ├── scouting/
│   │   │   └── ScoutingView.tsx      ← default export
│   │   ├── transfers/
│   │   │   └── TransfersView.tsx     ← default export
│   │   ├── inbox/
│   │   │   └── InboxView.tsx         ← default export (full-screen, keyboard nav)
│   │   └── player/
│   │       └── PlayerBlade.tsx       ← default export
│   ├── services/
│   │   ├── SimulationService.ts
│   │   └── workerBridge.ts
│   ├── store/
│   │   ├── gameStore.ts
│   │   ├── uiStore.ts
│   │   └── inboxStore.ts
│   ├── worker/
│   │   ├── sim.worker.ts
│   │   └── engine/
│   │       └── worldGen.ts
│   └── db/
│       └── database.ts
```

---

## CURRENT NAVTAB UNION

```typescript
export type NavTab = 'dashboard' | 'squad' | 'scouting' | 'transfers' | 'inbox'
```

AppShell.tsx routes each tab to its component. When adding a new tab:
1. Add the string to NavTab in uiStore.ts
2. Add the nav item to NAV_ITEMS in Sidebar.tsx
3. Add the route in AppShell.tsx
4. Create the new view component
Deliver all four changes in the same commit.

---

## CURRENT UISTORE API

```typescript
navTab: NavTab
setNavTab: (tab: NavTab) => void
simMode: SimMode                          // 'to_fixture' | 'one_day' | 'matchweek'
setSimMode: (mode: SimMode) => void
inboxOpen: boolean                        // kept for compat, no longer drives UI
setInboxOpen: (open: boolean) => void
selectedPlayerId: string | null
selectPlayer: (id: string | null) => void
selectedClubId: string | null
selectClub: (id: string | null) => void
activeModal: ModalId | null
openModal: (id: ModalId) => void
closeModal: () => void
toasts: Toast[]
pushToast: (message: string, type?: 'info'|'success'|'error') => void
dismissToast: (id: string) => void
```

---

## WORKER MESSAGE CONTRACT

**Main → Worker (actions):**
- `INIT_LEAGUE`         `{ config: { seed, managerClubId } }`
- `SIM_DAY`             `{ payload: {} }`
- `SIM_TO_DATE`         `{ payload: { targetDate, maxDays? } }`
- `CANCEL_SIM`          `{ payload: { targetJobId } }`
- `UPDATE_TACTICS`      `{ payload: { clubId, tactics } }`
- `SAVE_GAME`           `{ payload: { slotIndex, saveName? } }`
- `MAKE_TRANSFER_OFFER` `{ payload: { playerId, fee, weeklyWage } }`
- `ACCEPT_BID`          `{ payload: { bidId } }`
- `REJECT_BID`          `{ payload: { bidId } }`

**Worker → Main (responses):**
- `SYNC_STATE`      `{ state: SerializedGameState }`   ← field is 'state' not 'payload'
- `MATCH_RESULT`    `{ report: MatchReport }`          ← field is 'report' not 'payload'
- `PROGRESS_REPORT` `{ percentComplete, label }`
- `SAVE_EXPORT`     `{ slotIndex, state, exportedAt }`
- `WORKER_ERROR`    `{ message }`

---

## WHAT IS BUILT (Phases 0–6 Complete)

### Phases 0–4
- 92 clubs, ~1,840 players, 4 tiers
- Full match engine (Poisson-based), round-robin scheduler
- Playoff brackets, promotion/relegation logic
- Dashboard: league table, next fixture card, xG chart
- New game flow (3-step: welcome → tier → club)
- Squad view with attribute columns, form sparklines
- Player blade with Chart.js radar chart + season stats

### Phase 5
- Squad View: sortable table with SVG rating sparklines
- Player Blade: radar chart + attribute bars
- xG Chart: Recharts line chart over last 10 matches
- Scouting View: filterable database of all 1,840 players

### Phase 6 (complete)
- **Economy:** matchday stadium revenue after every home match
- **Wages:** weekly wage bill deducted from all 92 clubs every Monday
- **Player wages:** `weeklyWage = currentAbility * 200` set at world gen
- **Transfer market:** Available Players tab (buy from AI clubs), Bids
  Received tab (accept/reject AI offers for your players)
- **AI bids:** generated on the 1st of each month, pause simulation via
  AttentionEvent, route manager to Transfers tab
- **Retirement:** probabilistic curve — 0% under 32, ~53% at 35, 97% cap
  at 38+. Outliers can play to 39–40
- **Youth academy:** each club topped to 20 players at season end with
  16–17 year olds (OVR 30–45, POT 55–80)
- **Season rollover:** standings reset, new fixtures generated, season++
- **Inbox:** full-screen NavTab with keyboard ↑↓ navigation, distinct
  unread styling (blue left border + NEW badge), pending decisions column

---

## KEY DATA TYPES (Phase 6 additions)

```typescript
// On Player (added Phase 6):
weeklyWage: number          // mutable, GBP per week
clubId: EntityId            // mutable (changes on transfer)
age: number                 // mutable (increments at season end)

// On SerializedGameState (added Phase 6):
pendingBids: TransferBid[]  // AI bids for manager's players

// TransferBid:
interface TransferBid {
  id:          EntityId
  playerId:    EntityId
  fromClubId:  EntityId
  fee:         number        // GBP
  weeklyWage:  number        // GBP/week proposed by buying club
  createdDate: ISODateString
}
```

---

## SIMULATIONSERVICE ADDITIONS (Phase 6)

```typescript
simulationService.makeTransferOffer(playerId, fee, weeklyWage)
simulationService.acceptBid(bidId)
simulationService.rejectBid(bidId)
```

SimulationService also tracks:
- `processedBidIds: Set<string>` — prevents duplicate attention events for same bid
- `lastKnownSeason: number` — detects season rollover, fires youth intake event

---

## PHASE 7 GOALS

### 1. Stadium Upgrades
Each club has a `stadiumCapacity` (not yet in types — add it).
Tier-based starting capacities: EPL ~40k, Championship ~20k, L1 ~10k, L2 ~6k.
Allow the manager to spend from balance to upgrade capacity in steps.
Each upgrade increases `stadiumRevenue` proportionally.
Add a "Stadium" section to the Dashboard or a new tab.

### 2. Sponsorship Deals
Once per season (pre_season phase), generate 2–3 sponsorship offers.
Each offer has: `sponsor`, `annualFee`, `durationSeasons`, `requiresTier`.
Manager accepts one — fee paid into balance at season start each year.
Show active sponsorship in sidebar finance strip.

### 3. Player Morale
Add `morale: number` (0–100) to the `Player` type.
Morale affects match performance — high morale boosts team ability slightly,
low morale reduces it.
Morale drops when: sold a player the manager wanted to keep, lost 3+ in a row,
wages unpaid (balance went negative).
Morale rises when: won, promoted, youth player broke into first team.
Show morale in Squad View as a coloured dot (green/amber/red).

### 4. Loan Market
Allow manager to loan players in (from AI clubs, no fee, wage subsidy split)
and loan players out (to AI clubs, keeping their development ticking).
Loaned-in players count toward squad but return at season end.
Add "Loans" sub-tab within the Transfers view.

### 5. Manager Reputation
Add a `managerReputation: number` (0–100) to SerializedGameState.
Starts at 50. Rises with: promotions, winning the league, cup runs.
Falls with: relegation, heavy losses, financial mismanagement.
Reputation gates which clubs approach you for a job (future feature).
Show as a badge in the sidebar next to club name.

---

## SUGGESTED BUILD ORDER FOR PHASE 7

1. Stadium upgrades (most visible — immediately affects finances)
2. Sponsorship deals (extends the economy system naturally)
3. Player morale (affects match engine — satisfying gameplay loop)
4. Loan market (extends transfers tab, reuses existing patterns)
5. Manager reputation (lightweight, ties the other systems together)

---

## WHAT NOT TO BUILD IN PHASE 7

- Cup competitions (Phase 8)
- International breaks (Phase 8)
- Press conferences / media (Phase 8)
- Fan satisfaction (Phase 8)

---

## CRITICAL RULES CARRIED FORWARD

### Import/export rule that burned us in Phase 5 & 6:
```typescript
// CORRECT — components:
import Dashboard from '../dashboard/Dashboard'

// CORRECT — stores and types:
import { useGameStore, selectGameState } from '../../store/gameStore'
import { useUiStore } from '../../store/uiStore'
import { Tier, TIER_CONFIG } from '../../types'

// WRONG — never do this for components:
import { Dashboard } from '../dashboard/Dashboard'
```

### workerBridge import (burned us at Phase 6 start):
```typescript
// CORRECT:
import { workerBridge } from './workerBridge'   // named export

// WRONG:
import workerBridge from './workerBridge'        // default import — DOES NOT EXIST
```

### Store field names (never rename without updating all call sites):
- `setNavTab` (not setActiveTab)
- `activeModal` (state field), `openModal` (action)
- `pushToast(message, type)` — 2 args only, no 3rd arg
- `isRead` on InboxItem (not `read`)

### Worker field names:
- Worker sends `{ type: 'SYNC_STATE', state: ... }` — field is `state` not `payload`
- Worker sends `{ type: 'MATCH_RESULT', report: ... }` — field is `report` not `payload`
- SimulationService's `extractState()` handles both field names for safety

---

## GIT / WORKFLOW NOTES

- Editor: Sublime Text
- Terminal: macOS Terminal
- All commands run from: `~/Desktop/football-manager/`
- Push workflow (manual): `git add . && git commit -m "..." && git push`
- Pull after Claude commits: `git pull`
- Dev server: `npm run dev`
- Worker changes require hard refresh: `Cmd+Shift+R`
- Owner has non-technical background — explain every step in plain English

---

## DELIVERY FORMAT RULES FOR CLAUDE IN PHASE 7

1. **Read existing files FIRST** using `github:get_file_contents` before
   writing anything — never assume what a file contains
2. **Use `github:push_files` for multi-file changes** — single commit,
   no SHA required
3. **Use `github:create_or_update_file` for single-file changes** — but
   always fetch the SHA first
4. List every file being changed and why at the start of the response
5. If adding a new NavTab, deliver uiStore + Sidebar + AppShell + new view
   component in the same commit
6. If a store field changes, search all components that use it and update
   them all in the same delivery
7. Never deliver more than 8 files in one message — split into parts and
   wait for confirmation before continuing
8. After committing, tell the user to run `git pull` and `Cmd+Shift+R`
