/**
 * sim.worker.ts — The Simulation Engine (Background Thread)
 *
 * Phase 6 additions:
 *   ✅ Matchday revenue, weekly wages, AI bids, transfers, retirement, youth academy
 *
 * Phase 7 additions:
 *   ✅ MORALE — per-player morale (0–100) modifies match-engine lambda ±5%.
 *      Rises +3 after a win, falls -3 after a loss, -5 extra after 3 consecutive losses.
 *      Soft-resets toward 60 each off-season.
 *   ✅ MANAGER REPUTATION — career score (0–100), starts at 50. Updated per match
 *      (+0.2 win, -0.1 loss, -0.4 heavy loss) and +10 for winning the league.
 *   ✅ SPONSORSHIPS — 2–3 offers generated at start of each pre_season. Manager
 *      accepts one → first payment immediate, subsequent payments in processSeasonEnd.
 *   ✅ STADIUM UPGRADES — UPGRADE_STADIUM action adds seats, recalculates
 *      stadiumRevenue (capacity × tier revenue-per-seat). Cost = capacity × 100.
 *   ✅ LOANS — LOAN_IN_PLAYER and LOAN_OUT_PLAYER. player.clubId changes temporarily.
 *      All loans return at season end via processSeasonEnd.
 */

import {
  Tier,
  TIER_CONFIG,
  type SerializedGameState,
  type Fixture,
  type MatchReport,
  type MatchEvent,
  type ClubMatchStats,
  type PlayerMatchRating,
  type TransferBid,
  type Player,
  type Position,
  type SponsorshipOffer,
  type ActiveSponsorship,
  type LoanRecord,
} from '../types';
import { generateWorld } from './engine/worldGen';

// ─────────────────────────────────────────────────────────────────────────────
// Worker State
// ─────────────────────────────────────────────────────────────────────────────

let state: SerializedGameState | null = null;
let cancelRequested = false;

// ─────────────────────────────────────────────────────────────────────────────
// postMessage helpers
// ─────────────────────────────────────────────────────────────────────────────

function sendSync(jobId: string): void {
  if (!state) return;
  self.postMessage({ type: 'SYNC_STATE', jobId, state });
}

function sendError(jobId: string, message: string): void {
  console.error('[worker] Sending WORKER_ERROR:', message);
  self.postMessage({ type: 'WORKER_ERROR', jobId, message });
}

function sendProgress(jobId: string, percentComplete: number, label: string): void {
  self.postMessage({ type: 'PROGRESS_REPORT', jobId, percentComplete, label });
}

function sendMatchResult(jobId: string, report: MatchReport): void {
  self.postMessage({ type: 'MATCH_RESULT', jobId, report });
}

function requireState(jobId: string, actionType: string): state is SerializedGameState {
  if (!state) {
    sendError(jobId, `Cannot run ${actionType} before INIT_LEAGUE.`);
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Date Utilities
// ─────────────────────────────────────────────────────────────────────────────

function parseDate(iso: string): Date {
  return new Date(iso + 'T00:00:00Z');
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function addDays(iso: string, days: number): string {
  const d = parseDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDate(d);
}

function isBefore(a: string, b: string): boolean {
  return a < b;
}

function isMonday(iso: string): boolean {
  return parseDate(iso).getUTCDay() === 1;
}

function isFirstOfMonth(iso: string): boolean {
  return iso.endsWith('-01');
}

// ─────────────────────────────────────────────────────────────────────────────
// Economy Helpers
// ─────────────────────────────────────────────────────────────────────────────

function recalculateWageBill(clubId: string): void {
  if (!state) return;
  const club = state.clubs[clubId];
  if (!club) return;
  const total = Object.values(state.players)
    .filter(p => p.clubId === clubId)
    .reduce((sum, p) => sum + (p.weeklyWage ?? p.currentAbility * 200), 0);
  club.finances.wageBill = total;
}

/**
 * Revenue per seat per home match (GBP) — mirrors worldGen constant.
 * Used when recalculating stadiumRevenue after a capacity upgrade.
 */
const REVENUE_PER_SEAT: Record<string, number> = {
  [Tier.EPL]:          45,
  [Tier.Championship]: 22,
  [Tier.LeagueOne]:    12,
  [Tier.LeagueTwo]:    8,
};

/**
 * Upgrade cost per added seat (GBP).
 * An EPL club adds 5k seats for 5000 × (capacity/1000) × 100.
 * Scales with existing size so big expansions cost more.
 */
function stadiumUpgradeCost(currentCapacity: number, capacityIncrease: number): number {
  return Math.round(currentCapacity * 100 * (capacityIncrease / 5_000));
}

function processEndOfDay(date: string): void {
  if (!state) return;
  // Pay wages every Monday
  if (isMonday(date)) {
    for (const club of Object.values(state.clubs)) {
      club.finances.balance -= club.finances.wageBill;
    }
    // Morale penalty if the manager's club can't cover wages (negative balance)
    const managerClub = state.clubs[state.playerClubId];
    if (managerClub && managerClub.finances.balance < 0) {
      for (const player of Object.values(state.players)) {
        if (player.clubId === state.playerClubId) {
          (player as any).morale = Math.max(0, (player.morale ?? 60) - 5);
        }
      }
    }
  }
}

function generateAIBids(): void {
  if (!state) return;
  if (state.phase !== 'regular_season') return;

  const playerClubId = state.playerClubId;
  const playerClub   = state.clubs[playerClubId];
  if (!playerClub) return;

  const tierMean  = TIER_CONFIG[playerClub.currentTier].meanAttributeScore;
  const myPlayers = Object.values(state.players).filter(
    p => p.clubId === playerClubId && p.status === 'active'
  );

  const attractive = myPlayers.filter(p => p.currentAbility > tierMean + 5);
  if (attractive.length === 0) return;

  const otherClubs = Object.values(state.clubs).filter(c => c.id !== playerClubId);
  if (otherClubs.length === 0) return;

  let bidsThisMonth = 0;

  for (const player of attractive) {
    if (bidsThisMonth >= 2) break;
    if (Math.random() > 0.2) continue;

    const existingBid = (state.pendingBids ?? []).find(b => b.playerId === player.id);
    if (existingBid) continue;

    const fromClub  = otherClubs[Math.floor(Math.random() * otherClubs.length)];
    const ageFactor = player.age <= 24 ? 1.5 : player.age <= 29 ? 1.0 : 0.6;
    const fee       = Math.round(player.currentAbility * ageFactor * 100_000);

    const bid: TransferBid = {
      id:          crypto.randomUUID(),
      playerId:    player.id,
      fromClubId:  fromClub.id,
      fee,
      weeklyWage:  player.weeklyWage ?? player.currentAbility * 200,
      createdDate: state.currentDate,
    };

    if (!state.pendingBids) (state as any).pendingBids = [];
    state.pendingBids.push(bid);
    bidsThisMonth++;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 7 — Morale Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Update player morale after a match.
 * Winners get +3, losers get -3. Three consecutive losses add a further -5.
 */
function updateMoraleAfterMatch(report: MatchReport, fixture: Fixture): void {
  if (!state) return;
  const hg = report.homeStats.goals;
  const ag = report.awayStats.goals;

  const winnerClubId = hg > ag ? fixture.homeClubId : ag > hg ? fixture.awayClubId : null;
  const loserClubId  = hg > ag ? fixture.awayClubId : ag > hg ? fixture.homeClubId : null;

  const homeXI = getStartingXI(fixture.homeClubId);
  const awayXI = getStartingXI(fixture.awayClubId);
  const allXI  = [...homeXI, ...awayXI];

  for (const pid of allXI) {
    const p = state.players[pid];
    if (!p) continue;
    const isWinner = p.clubId === winnerClubId;
    const isLoser  = p.clubId === loserClubId;
    if (isWinner)     (p as any).morale = Math.min(100, (p.morale ?? 60) + 3);
    else if (isLoser) (p as any).morale = Math.max(0,   (p.morale ?? 60) - 3);
  }

  // Extra -5 for clubs on 3-match losing run
  const applyMoraleCrisis = (clubId: string | null) => {
    if (!clubId) return;
    const row = (state!.standings as Record<string, any[]>)[fixture.tier]?.find(
      (r: any) => r.clubId === clubId
    );
    if (row && typeof row.form === 'string' && row.form.slice(-3) === 'LLL') {
      const xi = fixture.homeClubId === clubId ? homeXI : awayXI;
      for (const pid of xi) {
        const p = state!.players[pid];
        if (p) (p as any).morale = Math.max(0, (p.morale ?? 60) - 5);
      }
    }
  };
  applyMoraleCrisis(loserClubId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 7 — Manager Reputation
// ─────────────────────────────────────────────────────────────────────────────

function updateManagerReputation(report: MatchReport, fixture: Fixture): void {
  if (!state) return;
  const pid = state.playerClubId;
  const isHome = fixture.homeClubId === pid;
  const isAway = fixture.awayClubId === pid;
  if (!isHome && !isAway) return;

  const myGoals  = isHome ? report.homeStats.goals : report.awayStats.goals;
  const oppGoals = isHome ? report.awayStats.goals : report.homeStats.goals;
  const gd       = myGoals - oppGoals;

  let delta = 0;
  if      (gd > 0)   delta = 0.2;
  else if (gd < 0)   delta = -0.1;
  if      (gd <= -3) delta -= 0.4;  // heavy loss

  const current = state.managerReputation ?? 50;
  (state as any).managerReputation = Math.max(0, Math.min(100, current + delta));
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 7 — Sponsorship
// ─────────────────────────────────────────────────────────────────────────────

const SPONSOR_NAMES = [
  'SportTech Pro', 'Velocity Energy', 'Gold Coast Finance', 'NorthStar Insurance',
  'Atlas Telecom', 'Summit Brewing Co.', 'Pinnacle Sports Nutrition', 'Crown Automotive',
  'Eclipse Apparel', 'Titan Construction', 'Meridian Healthcare', 'Horizon Media Group',
  'Apex Travel', 'Sterling Watches', 'Nexus Gaming', 'BlueSky Airlines',
] as const;

/**
 * Generate 2–3 sponsorship offers for the manager's club at the start of pre_season.
 * Called once from handleInitLeague and once from processSeasonEnd.
 * Guard: does nothing if offers already exist.
 */
function generateSponsorshipOffers(): void {
  if (!state) return;
  if ((state.sponsorshipOffers?.length ?? 0) > 0) return;

  const playerClub = state.clubs[state.playerClubId];
  if (!playerClub) return;

  const tierFees: Record<string, number> = {
    [Tier.EPL]:          5_000_000,
    [Tier.Championship]: 1_500_000,
    [Tier.LeagueOne]:    500_000,
    [Tier.LeagueTwo]:    150_000,
  };
  const baseFee = tierFees[playerClub.currentTier] ?? 500_000;

  const existingSponsors = new Set((state.activeSponsorships ?? []).map(s => s.sponsor));
  const pool = (SPONSOR_NAMES as readonly string[]).filter(n => !existingSponsors.has(n));
  const available = [...pool];

  const count = 2 + (Math.random() < 0.5 ? 1 : 0);
  const offers: SponsorshipOffer[] = [];

  for (let i = 0; i < count && available.length > 0; i++) {
    const idx     = Math.floor(Math.random() * available.length);
    const sponsor = available.splice(idx, 1)[0];
    const variation  = 0.6 + Math.random() * 0.8;
    const annualFee  = Math.round(baseFee * variation / 10_000) * 10_000;
    const duration   = 1 + Math.floor(Math.random() * 3);

    offers.push({
      id:              crypto.randomUUID(),
      sponsor,
      annualFee,
      durationSeasons: duration,
      requiresTier:    null,
    });
  }

  if (!state.sponsorshipOffers) (state as any).sponsorshipOffers = [];
  state.sponsorshipOffers = offers;
  console.log(`[worker] Generated ${offers.length} sponsorship offers for season ${state.season}.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Youth Academy & Retirement
// ─────────────────────────────────────────────────────────────────────────────

function retirementChance(age: number): number {
  if (age < 32) return 0;
  return Math.min(0.97, (age - 31) * 0.15 - 0.07);
}

const YOUTH_FIRST_NAMES = [
  'Alfie', 'Mason', 'Luca', 'Noah', 'Tyler', 'Kai', 'Logan', 'Ethan',
  'Oscar', 'Leo', 'Archie', 'Harry', 'Charlie', 'Theo', 'Riley', 'Finn',
  'Jude', 'Zak', 'Dylan', 'Connor', 'Rhys', 'Callum', 'Jamie', 'Aaron',
];

const YOUTH_LAST_NAMES = [
  'Smith', 'Jones', 'Williams', 'Taylor', 'Brown', 'Davies', 'Evans',
  'Wilson', 'Roberts', 'Clark', 'Walker', 'Hall', 'Green', 'Baker',
  'Turner', 'Phillips', 'Scott', 'Adams', 'Hill', 'Wright',
];

const YOUTH_POSITIONS: Position[] = [
  'GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LW', 'RW', 'ST',
];

function generateYouthPlayer(clubId: string): Player {
  const age            = Math.random() < 0.5 ? 16 : 17;
  const currentAbility = 30 + Math.floor(Math.random() * 16);
  const potential      = 55 + Math.floor(Math.random() * 26);
  const position       = YOUTH_POSITIONS[Math.floor(Math.random() * YOUTH_POSITIONS.length)];

  const attr = (bias = 0): number =>
    Math.max(1, Math.min(99, currentAbility + bias + Math.round((Math.random() - 0.5) * 16)));

  const isGK  = position === 'GK';
  const isDef = ['CB', 'LB', 'RB'].includes(position);
  const isMid = ['CDM', 'CM', 'CAM'].includes(position);
  const isFwd = ['LW', 'RW', 'ST'].includes(position);

  const firstName = YOUTH_FIRST_NAMES[Math.floor(Math.random() * YOUTH_FIRST_NAMES.length)];
  const lastName  = YOUTH_LAST_NAMES[Math.floor(Math.random() * YOUTH_LAST_NAMES.length)];

  return {
    id:              crypto.randomUUID(),
    clubId,
    name:            `${firstName} ${lastName}`,
    age,
    position,
    attributes: {
      pace:         isFwd ? attr(6)  : isDef ? attr(-4) : attr(),
      finishing:    isFwd ? attr(8)  : isGK  ? attr(-18): attr(-4),
      passing:      isMid ? attr(6)  : isGK  ? attr(-4) : attr(),
      dribbling:    isFwd || isMid ? attr(4) : attr(-6),
      defending:    isDef ? attr(8)  : isFwd ? attr(-8) : attr(-2),
      physical:     attr(2),
      goalkeeping:  isGK  ? attr(12) : attr(-22),
      intelligence: attr(),
    },
    currentAbility,
    potential,
    status:           'active',
    unavailableWeeks: 0,
    weeklyWage:       currentAbility * 200,
    morale:           60,
    seasonStats: {
      appearances:   0,
      goals:         0,
      assists:       0,
      cleanSheets:   0,
      yellowCards:   0,
      redCards:      0,
      averageRating: 0,
    },
  };
}

/**
 * End-of-season processing.
 *
 * Order:
 *   1. Check if manager's club won the league → reputation + morale boost
 *   2. Age all players +1
 *   3. Retire players probabilistically
 *   4. Clean up tactics
 *   5. Youth intake
 *   6. Return all loaned players to their original clubs
 *   7. Recalculate all wage bills
 *   8. Pay active sponsorships / expire old deals
 *   9. Clear stale bids
 *  10. Season rollover
 *  11. Generate next pre-season sponsorship offers
 *  12. Soft-reset morale toward 60
 */
function processSeasonEnd(): void {
  if (!state) return;

  console.log(`[worker] Season ${state.season} ending — processing…`);

  // ── 1. League win — reputation & morale ─────────────────────────────────
  const playerTier = state.clubs[state.playerClubId]?.currentTier;
  if (playerTier) {
    const rows = (state.standings as Record<string, any[]>)[playerTier];
    if (rows?.length > 0 && rows[0].clubId === state.playerClubId) {
      (state as any).managerReputation = Math.min(100, (state.managerReputation ?? 50) + 10);
      for (const player of Object.values(state.players)) {
        if (player.clubId === state.playerClubId) {
          (player as any).morale = Math.min(100, (player.morale ?? 60) + 10);
        }
      }
      console.log('[worker] Manager won the league — reputation +10.');
    }
  }

  // ── 2. Age all players ──────────────────────────────────────────────────
  for (const player of Object.values(state.players)) {
    (player as any).age += 1;
  }

  // ── 3. Retire players ───────────────────────────────────────────────────
  let retiredCount = 0;
  const retiredIds = new Set<string>();
  for (const player of Object.values(state.players)) {
    if (Math.random() < retirementChance(player.age)) {
      retiredIds.add(player.id);
      retiredCount++;
    }
  }
  for (const id of retiredIds) delete state.players[id];

  // ── 4. Clean up tactics ─────────────────────────────────────────────────
  for (const club of Object.values(state.clubs)) {
    const xi    = club.tactics.startingXI.filter(id => !retiredIds.has(id));
    const bench = club.tactics.bench.filter(id => !retiredIds.has(id));
    (club.tactics as any).startingXI = xi;
    (club.tactics as any).bench      = bench;
  }

  // ── 5. Youth intake ─────────────────────────────────────────────────────
  let youthCount = 0;
  for (const club of Object.values(state.clubs)) {
    const currentSquadSize = Object.values(state.players)
      .filter(p => p.clubId === club.id).length;
    const needed = Math.max(0, 20 - currentSquadSize);
    for (let i = 0; i < needed; i++) {
      const youth = generateYouthPlayer(club.id);
      state.players[youth.id] = youth;
      youthCount++;
    }
  }

  // ── 6. Return all loaned players ─────────────────────────────────────────
  for (const loan of (state.activeLoans ?? [])) {
    const player = state.players[loan.playerId];
    if (player) {
      (player as any).clubId = loan.lendingClubId;
    }
  }
  state.activeLoans = [];

  // ── 7. Recalculate all wage bills ────────────────────────────────────────
  for (const clubId of Object.keys(state.clubs)) {
    recalculateWageBill(clubId);
  }

  // ── 8. Pay active sponsorships, expire old deals ─────────────────────────
  // Advance season first so we pay for the UPCOMING season.
  state.season += 1;

  const newSponsorships: ActiveSponsorship[] = [];
  for (const deal of (state.activeSponsorships ?? [])) {
    if (deal.expiresAfterSeason >= state.season) {
      // Deal still active — pay the annual fee
      const manClub = state.clubs[state.playerClubId];
      if (manClub) manClub.finances.balance += deal.annualFee;
      newSponsorships.push(deal);
    }
    // Deals expired last season are silently dropped
  }
  state.activeSponsorships = newSponsorships;

  // ── 9. Clear stale bids ──────────────────────────────────────────────────
  state.pendingBids = [];
  state.sponsorshipOffers = [];  // clear old offers (new ones generated below)

  // ── 10. Season rollover ───────────────────────────────────────────────────
  const newStartDate  = `${state.season}-08-08`;
  const newFixtureDate = `${state.season}-08-09`;

  state.currentDate     = newStartDate;
  state.lastUpdated     = newStartDate;
  state.phase           = 'pre_season';
  state.standings       = buildInitialStandings(state.clubs);
  state.fixtures        = generateFixtures(state.clubs, newFixtureDate);
  state.playoffBrackets = {
    [Tier.EPL]: null, [Tier.Championship]: null,
    [Tier.LeagueOne]: null, [Tier.LeagueTwo]: null,
  };

  // ── 11. Generate new pre-season sponsorship offers ───────────────────────
  generateSponsorshipOffers();

  // ── 12. Soft-reset morale toward 60 ──────────────────────────────────────
  // Move each player's morale 30% of the way back to 60.
  // Prevents morale snowballing across seasons.
  for (const player of Object.values(state.players)) {
    const current = player.morale ?? 60;
    (player as any).morale = current + Math.round((60 - current) * 0.3);
  }

  console.log(
    `[worker] Season rollover → ${state.season}. ` +
    `Retired: ${retiredCount}. Youth: ${youthCount}.`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Standings Builder
// ─────────────────────────────────────────────────────────────────────────────

function buildInitialStandings(
  clubs: SerializedGameState['clubs']
): SerializedGameState['standings'] {
  const byTier: Record<string, string[]> = {
    [Tier.EPL]:          [],
    [Tier.Championship]: [],
    [Tier.LeagueOne]:    [],
    [Tier.LeagueTwo]:    [],
  };

  for (const club of Object.values(clubs)) {
    const t = (club.currentTier ?? club.tier) as string;
    if (byTier[t] !== undefined) byTier[t].push(club.id);
  }

  for (const tier of Object.keys(byTier)) byTier[tier].sort();

  const makeRow = (clubId: string, index: number) => ({
    clubId,
    position:       index + 1,
    played:         0,
    won:            0,
    drawn:          0,
    lost:           0,
    goalsFor:       0,
    goalsAgainst:   0,
    goalDifference: 0,
    points:         0,
    form:           '',
  });

  return {
    [Tier.EPL]:          byTier[Tier.EPL].map(makeRow),
    [Tier.Championship]: byTier[Tier.Championship].map(makeRow),
    [Tier.LeagueOne]:    byTier[Tier.LeagueOne].map(makeRow),
    [Tier.LeagueTwo]:    byTier[Tier.LeagueTwo].map(makeRow),
  } as SerializedGameState['standings'];
}

// ─────────────────────────────────────────────────────────────────────────────
// Round-Robin Fixture Generator
// ─────────────────────────────────────────────────────────────────────────────

function generateRoundRobinRounds(teamIds: string[]): Array<Array<[string, string]>> {
  const teams = [...teamIds];
  if (teams.length % 2 !== 0) teams.push('__BYE__');
  const n = teams.length;
  const rounds: Array<Array<[string, string]>> = [];

  for (let round = 0; round < n - 1; round++) {
    const games: Array<[string, string]> = [];
    for (let i = 0; i < n / 2; i++) {
      const home = teams[i];
      const away = teams[n - 1 - i];
      if (home !== '__BYE__' && away !== '__BYE__') {
        games.push([home, away]);
      }
    }
    rounds.push(games);
    const last = teams.pop()!;
    teams.splice(1, 0, last);
  }

  return rounds;
}

function generateFixtures(
  clubs: SerializedGameState['clubs'],
  startDate: string
): Record<string, Fixture> {
  const fixtures: Record<string, Fixture> = {};

  const byTier: Record<string, string[]> = {
    [Tier.EPL]:          [],
    [Tier.Championship]: [],
    [Tier.LeagueOne]:    [],
    [Tier.LeagueTwo]:    [],
  };

  for (const club of Object.values(clubs)) {
    const t = (club.currentTier ?? club.tier) as string;
    if (byTier[t]) byTier[t].push(club.id);
  }

  for (const [tier, clubIds] of Object.entries(byTier)) {
    if (clubIds.length < 2) continue;

    const firstHalf  = generateRoundRobinRounds(clubIds);
    const secondHalf = firstHalf.map(round =>
      round.map(([h, a]) => [a, h] as [string, string])
    );

    [...firstHalf, ...secondHalf].forEach((round, roundIdx) => {
      const matchDate = addDays(startDate, roundIdx * 7);
      round.forEach(([home, away], gameIdx) => {
        const id = `fix_${tier}_mw${roundIdx}_g${gameIdx}`;
        fixtures[id] = {
          id,
          homeClubId: home,
          awayClubId: away,
          date:       matchDate,
          tier:       tier as Tier,
          context:    { type: 'league' },
          status:     'scheduled',
        };
      });
    });
  }

  return fixtures;
}

// ─────────────────────────────────────────────────────────────────────────────
// Match Engine
// ─────────────────────────────────────────────────────────────────────────────

function poissonRandom(lambda: number): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-Math.min(lambda, 20));
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L && k < 20);
  return k - 1;
}

function getStartingXI(clubId: string): string[] {
  const xi = state!.clubs[clubId]?.tactics?.startingXI;
  if (xi && xi.length === 11) return [...xi];

  return Object.values(state!.players)
    .filter(p => p.clubId === clubId && p.status === 'active')
    .sort((a, b) => b.currentAbility - a.currentAbility)
    .slice(0, 11)
    .map(p => p.id);
}

/**
 * Returns average ability for a set of player IDs.
 * Phase 7: morale applies a ±5% modifier on the result.
 * Neutral at morale 50 (modifier = 1.0), 100 → 1.05, 0 → 0.95.
 */
function teamAbility(playerIds: string[]): number {
  if (!playerIds.length) return 50;
  let totalAbility = 0, totalMorale = 0, count = 0;
  for (const id of playerIds) {
    const p = state!.players[id];
    if (p) {
      totalAbility += p.currentAbility;
      totalMorale  += p.morale ?? 60;
      count++;
    }
  }
  if (count === 0) return 50;
  const avgAbility = totalAbility / count;
  const avgMorale  = totalMorale  / count;
  const moraleMod  = 1 + (avgMorale - 50) / 1000;  // ±5% at extremes
  return avgAbility * moraleMod;
}

function pickScorer(playerIds: string[]): string | null {
  if (!playerIds.length) return null;
  const pool = playerIds.map(id => ({
    id,
    w: (state!.players[id]?.attributes?.finishing ?? 50) + 1,
  }));
  const total = pool.reduce((s, p) => s + p.w, 0);
  let rand = Math.random() * total;
  for (const c of pool) { rand -= c.w; if (rand <= 0) return c.id; }
  return pool[pool.length - 1]?.id ?? null;
}

function simulateMatch(fixture: Fixture): MatchReport {
  const homeId = fixture.homeClubId;
  const awayId = fixture.awayClubId;

  const homeXI      = getStartingXI(homeId);
  const awayXI      = getStartingXI(awayId);
  const homeAbility = teamAbility(homeXI);
  const awayAbility = teamAbility(awayXI);

  const homeLambda = (homeAbility / 100) * 2.0 * 1.15;
  const awayLambda = (awayAbility / 100) * 1.8;

  const homeGoals = poissonRandom(homeLambda);
  const awayGoals = poissonRandom(awayLambda);

  const usedMins = new Set<number>();
  const nextMinute = () => {
    let m = Math.floor(Math.random() * 90) + 1;
    for (let i = 0; usedMins.has(m) && i < 90; i++) m = m < 90 ? m + 1 : 1;
    usedMins.add(m);
    return m;
  };

  const events: MatchEvent[] = [];
  for (let i = 0; i < homeGoals; i++) {
    const s = pickScorer(homeXI);
    if (s) events.push({ minute: nextMinute(), type: 'goal', playerId: s, clubId: homeId });
  }
  for (let i = 0; i < awayGoals; i++) {
    const s = pickScorer(awayXI);
    if (s) events.push({ minute: nextMinute(), type: 'goal', playerId: s, clubId: awayId });
  }
  events.sort((a, b) => a.minute - b.minute);

  const homePoss = Math.round(40 + (homeAbility / (homeAbility + awayAbility)) * 20);

  const homeStats: ClubMatchStats = {
    clubId:        homeId,
    goals:         homeGoals,
    xG:            Math.round(homeLambda * 100) / 100,
    shots:         Math.max(homeGoals, Math.round(homeLambda * 6 + Math.random() * 4)),
    shotsOnTarget: Math.max(homeGoals, Math.round(homeLambda * 3 + Math.random() * 2)),
    possession:    homePoss,
    passes:        300 + Math.round(homeAbility * 3 + Math.random() * 100),
    passAccuracy:  Math.min(95, 60 + Math.round(homeAbility / 5)),
    tackles:       15 + Math.round(Math.random() * 10),
    interceptions: 8  + Math.round(Math.random() * 8),
  };

  const awayStats: ClubMatchStats = {
    clubId:        awayId,
    goals:         awayGoals,
    xG:            Math.round(awayLambda * 100) / 100,
    shots:         Math.max(awayGoals, Math.round(awayLambda * 6 + Math.random() * 4)),
    shotsOnTarget: Math.max(awayGoals, Math.round(awayLambda * 3 + Math.random() * 2)),
    possession:    100 - homePoss,
    passes:        280 + Math.round(awayAbility * 3 + Math.random() * 100),
    passAccuracy:  Math.min(93, 58 + Math.round(awayAbility / 5)),
    tackles:       14 + Math.round(Math.random() * 10),
    interceptions: 7  + Math.round(Math.random() * 8),
  };

  const allXI = [...homeXI, ...awayXI];
  const playerRatings: PlayerMatchRating[] = allXI.map(playerId => {
    const player      = state!.players[playerId];
    const playerGoals = events.filter(e => e.type === 'goal' && e.playerId === playerId).length;
    const abilBonus   = ((player?.currentAbility ?? 50) - 50) / 100;
    return {
      playerId,
      rating:        Math.min(10, Math.round((6.0 + abilBonus + playerGoals * 1.5 + Math.random() * 0.5) * 10) / 10),
      goals:         playerGoals,
      assists:       0,
      keyPasses:     0,
      tackles:       Math.round(Math.random() * 3),
      interceptions: Math.round(Math.random() * 2),
    };
  });

  const motmPlayerId = [...playerRatings]
    .sort((a, b) => b.rating - a.rating)[0]?.playerId ?? (homeXI[0] ?? '');

  const hs  = state!.clubs[homeId]?.shortName ?? homeId;
  const as_ = state!.clubs[awayId]?.shortName ?? awayId;

  const resultLine =
    homeGoals > awayGoals ? `${hs} claimed all three points at home.` :
    awayGoals > homeGoals ? `${as_} took a superb away victory.`      :
    'Honours even — both sides share the spoils.';

  const xgLine =
    homeLambda >= awayLambda
      ? `${hs} were the more threatening side, xG ${homeStats.xG}–${awayStats.xG}.`
      : `${as_} edged it on expected goals, ${awayStats.xG} to ${homeStats.xG}.`;

  return {
    fixtureId:        fixture.id,
    homeStats,
    awayStats,
    events,
    playerRatings,
    motmPlayerId,
    narrativeSummary: [`${hs} ${homeGoals}–${awayGoals} ${as_}`, resultLine, xgLine],
  };
}

function updateStandings(report: MatchReport, fixture: Fixture): void {
  const rows = (state!.standings as Record<string, any[]>)[fixture.tier];
  if (!rows) return;

  const homeRow = rows.find(r => r.clubId === report.homeStats.clubId);
  const awayRow = rows.find(r => r.clubId === report.awayStats.clubId);
  if (!homeRow || !awayRow) return;

  const hg = report.homeStats.goals;
  const ag = report.awayStats.goals;

  homeRow.played++; awayRow.played++;
  homeRow.goalsFor    += hg; homeRow.goalsAgainst  += ag;
  awayRow.goalsFor    += ag; awayRow.goalsAgainst  += hg;
  homeRow.goalDifference = homeRow.goalsFor - homeRow.goalsAgainst;
  awayRow.goalDifference = awayRow.goalsFor - awayRow.goalsAgainst;

  if (hg > ag) {
    homeRow.won++; homeRow.points += 3; awayRow.lost++;
    homeRow.form = (homeRow.form + 'W').slice(-5);
    awayRow.form = (awayRow.form + 'L').slice(-5);
  } else if (ag > hg) {
    awayRow.won++; awayRow.points += 3; homeRow.lost++;
    homeRow.form = (homeRow.form + 'L').slice(-5);
    awayRow.form = (awayRow.form + 'W').slice(-5);
  } else {
    homeRow.drawn++; homeRow.points++;
    awayRow.drawn++; awayRow.points++;
    homeRow.form = (homeRow.form + 'D').slice(-5);
    awayRow.form = (awayRow.form + 'D').slice(-5);
  }

  rows.sort((a, b) =>
    b.points - a.points ||
    b.goalDifference - a.goalDifference ||
    b.goalsFor - a.goalsFor
  );
  rows.forEach((r, i) => { r.position = i + 1; });
}

/**
 * Simulate all scheduled matches on a given date.
 * Phase 7: after each match, updates morale and (if relevant) manager reputation.
 */
function simulateMatchesOnDate(date: string): MatchReport[] {
  const reports: MatchReport[] = [];
  const toPlay = Object.values(state!.fixtures)
    .filter(f => f.date === date && f.status === 'scheduled');

  for (const fixture of toPlay) {
    fixture.status = 'completed';
    const report   = simulateMatch(fixture);
    const attendance = 10_000 + Math.round(Math.random() * 40_000);

    fixture.result = {
      fixtureId:  fixture.id,
      homeGoals:  report.homeStats.goals,
      awayGoals:  report.awayStats.goals,
      homexG:     report.homeStats.xG,
      awayxG:     report.awayStats.xG,
      attendance,
    };

    const homeClub = state!.clubs[fixture.homeClubId];
    if (homeClub) {
      const attendanceMod = 0.7 + Math.random() * 0.3;
      homeClub.finances.balance += Math.round(homeClub.finances.stadiumRevenue * attendanceMod);
    }

    updateStandings(report, fixture);

    // Phase 7 — morale & reputation updates
    updateMoraleAfterMatch(report, fixture);
    updateManagerReputation(report, fixture);

    reports.push(report);
  }

  return reports;
}

function updatePhase(): void {
  if (!state) return;

  if (state.phase === 'pre_season') {
    if (Object.values(state.fixtures).some(f => f.status === 'completed')) {
      state.phase = 'regular_season';
    }
    return;
  }

  if (state.phase === 'regular_season') {
    const leagueFixtures = Object.values(state.fixtures).filter(
      f => f.context?.type === 'league'
    );
    const allComplete = leagueFixtures.length > 0 &&
      leagueFixtures.every(f => f.status === 'completed');

    if (allComplete) {
      processSeasonEnd();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Action Handlers — existing
// ─────────────────────────────────────────────────────────────────────────────

function handleInitLeague(action: {
  type:   'INIT_LEAGUE';
  jobId:  string;
  config: { seed?: number; managerClubId?: string | null };
}): void {
  const { jobId, config } = action;

  try {
    console.log('[worker] INIT_LEAGUE started, seed:', config.seed);

    const seed             = config.seed ?? Date.now();
    const season           = 2025;
    const startDate        = `${season}-08-08`;
    const firstFixtureDate = `${season}-08-09`;

    const { clubs, players } = generateWorld({
      seed, season,
      regions: ['north_west','north_east','yorkshire','midlands','east','london','south_east','south_west','wales'],
    });

    let playerClubId: string = config.managerClubId ?? '';
    if (!playerClubId || !clubs[playerClubId]) {
      playerClubId = Object.values(clubs).find(c => c.tier === Tier.EPL)?.id
        ?? Object.keys(clubs)[0];
    }
    clubs[playerClubId].isPlayerManaged = true;

    const standings = buildInitialStandings(clubs);
    const fixtures  = generateFixtures(clubs, firstFixtureDate);

    (state as any) = {
      saveId:             crypto.randomUUID(),
      saveName:           'New Game',
      version:            '0.1.0',
      seed,
      season,
      currentDate:        startDate,
      phase:              'pre_season',
      clubs,
      players,
      fixtures,
      standings,
      playoffBrackets: {
        [Tier.EPL]: null, [Tier.Championship]: null,
        [Tier.LeagueOne]: null, [Tier.LeagueTwo]: null,
      },
      playerClubId,
      nonLeagueClubIds:   [],
      pendingBids:        [],
      managerReputation:  50,
      sponsorshipOffers:  [],
      activeSponsorships: [],
      activeLoans:        [],
      lastUpdated:        startDate,
    };

    // Generate initial pre-season sponsorship offers
    generateSponsorshipOffers();

    console.log('[worker] World generated:',
      Object.keys(clubs).length,   'clubs,',
      Object.keys(players).length, 'players,',
      Object.keys(fixtures).length,'fixtures.'
    );
    sendSync(jobId);

  } catch (err) {
    console.error('[worker] INIT_LEAGUE crashed:', err);
    sendError(jobId, err instanceof Error ? err.message : String(err));
  }
}

function handleSimDay(action: { type: 'SIM_DAY'; jobId: string }): void {
  const { jobId } = action;
  if (!requireState(jobId, 'SIM_DAY')) return;

  try {
    state.currentDate = addDays(state.currentDate, 1);
    state.lastUpdated = state.currentDate;

    const reports = simulateMatchesOnDate(state.currentDate);
    processEndOfDay(state.currentDate);
    if (isFirstOfMonth(state.currentDate)) generateAIBids();
    updatePhase();

    for (const report of reports) {
      sendMatchResult(jobId, report);
    }

    sendSync(jobId);
  } catch (err) {
    console.error('[worker] SIM_DAY crashed:', err);
    sendError(jobId, err instanceof Error ? err.message : String(err));
  }
}

async function handleSimToDate(action: {
  type:       'SIM_TO_DATE';
  jobId:      string;
  payload?:   { targetDate: string; maxDays?: number };
  targetDate?: string;
}): Promise<void> {
  const { jobId } = action;

  const targetDate = action.payload?.targetDate ?? action.targetDate;
  if (!targetDate) {
    sendError(jobId, 'SIM_TO_DATE: missing targetDate in action.payload');
    return;
  }
  if (!requireState(jobId, 'SIM_TO_DATE')) return;

  cancelRequested = false;

  try {
    const totalDays = Math.max(
      1,
      Math.round((parseDate(targetDate).getTime() - parseDate(state.currentDate).getTime()) / 86_400_000)
    );
    let daysAdvanced = 0;

    while (isBefore(state.currentDate, targetDate) && !cancelRequested) {
      state.currentDate = addDays(state.currentDate, 1);
      state.lastUpdated = state.currentDate;
      daysAdvanced++;

      const reports = simulateMatchesOnDate(state.currentDate);
      processEndOfDay(state.currentDate);
      if (isFirstOfMonth(state.currentDate)) generateAIBids();
      updatePhase();

      for (const report of reports) {
        const fix = state.fixtures[report.fixtureId];
        if (fix?.homeClubId === state.playerClubId || fix?.awayClubId === state.playerClubId) {
          sendMatchResult(jobId, report);
        }
      }

      if (daysAdvanced % 7 === 0) {
        sendProgress(jobId, Math.min(99, Math.round((daysAdvanced / totalDays) * 100)), `Simulating ${state.currentDate}…`);
        await new Promise<void>(r => setTimeout(r, 0));
      }
    }

    sendProgress(jobId, 100, 'Done');
    sendSync(jobId);

  } catch (err) {
    console.error('[worker] SIM_TO_DATE crashed:', err);
    sendError(jobId, err instanceof Error ? err.message : String(err));
  }
}

function handleCancelSim(_action: { type: 'CANCEL_SIM'; jobId: string }): void {
  cancelRequested = true;
}

function handleUpdateTactics(action: {
  type:        'UPDATE_TACTICS';
  jobId:       string;
  clubId?:     string;
  startingXI?: string[];
  payload?:    { clubId: string; tactics: { startingXI: string[] } };
}): void {
  const { jobId } = action;
  if (!requireState(jobId, 'UPDATE_TACTICS')) return;

  const clubId     = action.clubId     ?? action.payload?.clubId;
  const startingXI = action.startingXI ?? action.payload?.tactics?.startingXI;

  try {
    if (!clubId || !state.clubs[clubId]) { sendError(jobId, `No club found: ${clubId}`); return; }
    if (!startingXI || startingXI.length !== 11) { sendError(jobId, 'Starting XI must contain exactly 11 players.'); return; }
    (state.clubs[clubId].tactics as any) = { startingXI };
    state.lastUpdated = state.currentDate;
    sendSync(jobId);
  } catch (err) {
    console.error('[worker] UPDATE_TACTICS crashed:', err);
    sendError(jobId, err instanceof Error ? err.message : String(err));
  }
}

function handleSaveGame(action: {
  type:     'SAVE_GAME';
  jobId:    string;
  slotIndex?: number;
  payload?: { slotIndex: number; saveName?: string };
}): void {
  const { jobId } = action;
  if (!requireState(jobId, 'SAVE_GAME')) return;
  const slotIndex = action.slotIndex ?? action.payload?.slotIndex ?? 0;
  try {
    self.postMessage({ type: 'SAVE_EXPORT', jobId, slotIndex, state: { ...state }, exportedAt: state.currentDate });
  } catch (err) {
    console.error('[worker] SAVE_GAME crashed:', err);
    sendError(jobId, err instanceof Error ? err.message : String(err));
  }
}

function handleMakeTransferOffer(action: {
  type:    'MAKE_TRANSFER_OFFER';
  jobId:   string;
  payload: { playerId: string; fee: number; weeklyWage: number };
}): void {
  const { jobId, payload } = action;
  if (!requireState(jobId, 'MAKE_TRANSFER_OFFER')) return;

  try {
    const { playerId, fee, weeklyWage } = payload;
    const player      = state.players[playerId];
    const managerClub = state.clubs[state.playerClubId];

    if (!player)      { sendError(jobId, 'Player not found'); return; }
    if (!managerClub) { sendError(jobId, 'Manager club not found'); return; }
    if (player.clubId === state.playerClubId) { sendError(jobId, 'Cannot buy your own player'); return; }
    if (managerClub.finances.transferBudget < fee) { sendError(jobId, 'Insufficient transfer budget'); return; }

    const sellingClubId = player.clubId;
    const sellingClub   = state.clubs[sellingClubId];

    managerClub.finances.transferBudget -= fee;
    managerClub.finances.balance        -= fee;
    if (sellingClub) sellingClub.finances.balance += fee;

    (player as any).clubId     = state.playerClubId;
    (player as any).weeklyWage = weeklyWage;

    recalculateWageBill(state.playerClubId);
    if (sellingClub) recalculateWageBill(sellingClubId);

    state.lastUpdated = state.currentDate;
    sendSync(jobId);
  } catch (err) {
    console.error('[worker] MAKE_TRANSFER_OFFER crashed:', err);
    sendError(jobId, err instanceof Error ? err.message : String(err));
  }
}

function handleAcceptBid(action: {
  type:    'ACCEPT_BID';
  jobId:   string;
  payload: { bidId: string };
}): void {
  const { jobId, payload } = action;
  if (!requireState(jobId, 'ACCEPT_BID')) return;

  try {
    const bid = (state.pendingBids ?? []).find(b => b.id === payload.bidId);
    if (!bid) { sendError(jobId, 'Bid not found'); return; }

    const player      = state.players[bid.playerId];
    const buyClub     = state.clubs[bid.fromClubId];
    const managerClub = state.clubs[state.playerClubId];

    if (!player) { sendError(jobId, 'Player not found'); return; }

    if (managerClub) {
      managerClub.finances.balance        += bid.fee;
      managerClub.finances.transferBudget += bid.fee;
    }
    if (buyClub) buyClub.finances.balance -= bid.fee;

    (player as any).clubId = bid.fromClubId;
    state.pendingBids = (state.pendingBids ?? []).filter(b => b.id !== bid.id);

    recalculateWageBill(state.playerClubId);
    if (buyClub) recalculateWageBill(buyClub.id);

    state.lastUpdated = state.currentDate;
    sendSync(jobId);
  } catch (err) {
    console.error('[worker] ACCEPT_BID crashed:', err);
    sendError(jobId, err instanceof Error ? err.message : String(err));
  }
}

function handleRejectBid(action: {
  type:    'REJECT_BID';
  jobId:   string;
  payload: { bidId: string };
}): void {
  const { jobId, payload } = action;
  if (!requireState(jobId, 'REJECT_BID')) return;

  try {
    state.pendingBids = (state.pendingBids ?? []).filter(b => b.id !== payload.bidId);
    state.lastUpdated = state.currentDate;
    sendSync(jobId);
  } catch (err) {
    console.error('[worker] REJECT_BID crashed:', err);
    sendError(jobId, err instanceof Error ? err.message : String(err));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Action Handlers — Phase 7 additions
// ─────────────────────────────────────────────────────────────────────────────

function handleUpgradeStadium(action: {
  type:    'UPGRADE_STADIUM';
  jobId:   string;
  payload: { capacityIncrease: number };
}): void {
  const { jobId, payload } = action;
  if (!requireState(jobId, 'UPGRADE_STADIUM')) return;

  try {
    const { capacityIncrease } = payload;
    if (capacityIncrease <= 0 || capacityIncrease % 1000 !== 0) {
      sendError(jobId, 'Capacity increase must be a positive multiple of 1,000.'); return;
    }

    const club = state.clubs[state.playerClubId];
    if (!club) { sendError(jobId, 'Manager club not found'); return; }

    const cost = stadiumUpgradeCost(club.stadiumCapacity, capacityIncrease);
    if (club.finances.balance < cost) {
      sendError(jobId, `Insufficient funds. Upgrade costs £${cost.toLocaleString()}.`); return;
    }

    club.finances.balance   -= cost;
    club.stadiumCapacity    += capacityIncrease;
    const revenuePerSeat     = REVENUE_PER_SEAT[club.currentTier] ?? 20;
    club.finances.stadiumRevenue = Math.round(club.stadiumCapacity * revenuePerSeat);

    state.lastUpdated = state.currentDate;
    console.log(
      `[worker] Stadium upgraded: +${capacityIncrease} seats → ` +
      `${club.stadiumCapacity.toLocaleString()} total. Cost: £${cost.toLocaleString()}.`
    );
    sendSync(jobId);
  } catch (err) {
    console.error('[worker] UPGRADE_STADIUM crashed:', err);
    sendError(jobId, err instanceof Error ? err.message : String(err));
  }
}

function handleAcceptSponsorship(action: {
  type:    'ACCEPT_SPONSORSHIP';
  jobId:   string;
  payload: { offerId: string };
}): void {
  const { jobId, payload } = action;
  if (!requireState(jobId, 'ACCEPT_SPONSORSHIP')) return;

  try {
    const offer = (state.sponsorshipOffers ?? []).find(o => o.id === payload.offerId);
    if (!offer) { sendError(jobId, 'Sponsorship offer not found.'); return; }

    const club = state.clubs[state.playerClubId];
    if (!club) { sendError(jobId, 'Manager club not found.'); return; }

    const newDeal: ActiveSponsorship = {
      ...offer,
      acceptedSeason:     state.season,
      expiresAfterSeason: state.season + offer.durationSeasons - 1,
    };

    // Replace any existing sponsorship — one deal at a time
    state.activeSponsorships = [newDeal];
    // Clear all offers (decision made)
    state.sponsorshipOffers  = [];
    // Pay the first year immediately
    club.finances.balance += offer.annualFee;

    state.lastUpdated = state.currentDate;
    console.log(
      `[worker] Sponsorship accepted: ${offer.sponsor}, ` +
      `£${offer.annualFee.toLocaleString()}/yr × ${offer.durationSeasons} seasons.`
    );
    sendSync(jobId);
  } catch (err) {
    console.error('[worker] ACCEPT_SPONSORSHIP crashed:', err);
    sendError(jobId, err instanceof Error ? err.message : String(err));
  }
}

function handleRejectSponsorship(action: {
  type:    'REJECT_SPONSORSHIP';
  jobId:   string;
  payload: { offerId: string };
}): void {
  const { jobId, payload } = action;
  if (!requireState(jobId, 'REJECT_SPONSORSHIP')) return;

  try {
    state.sponsorshipOffers = (state.sponsorshipOffers ?? []).filter(
      o => o.id !== payload.offerId
    );
    state.lastUpdated = state.currentDate;
    sendSync(jobId);
  } catch (err) {
    console.error('[worker] REJECT_SPONSORSHIP crashed:', err);
    sendError(jobId, err instanceof Error ? err.message : String(err));
  }
}

function handleLoanInPlayer(action: {
  type:    'LOAN_IN_PLAYER';
  jobId:   string;
  payload: { playerId: string; weeklyWageContribution: number };
}): void {
  const { jobId, payload } = action;
  if (!requireState(jobId, 'LOAN_IN_PLAYER')) return;

  try {
    const { playerId, weeklyWageContribution } = payload;
    const player = state.players[playerId];

    if (!player) { sendError(jobId, 'Player not found.'); return; }
    if (player.clubId === state.playerClubId) { sendError(jobId, 'Player is already in your squad.'); return; }

    // Check player isn't already on loan to someone else
    const existingLoan = (state.activeLoans ?? []).find(l => l.playerId === playerId);
    if (existingLoan) { sendError(jobId, 'Player is already involved in a loan.'); return; }

    const originalClubId = player.clubId;
    const loan: LoanRecord = {
      id:                     crypto.randomUUID(),
      playerId,
      lendingClubId:          originalClubId,
      borrowingClubId:        state.playerClubId,
      weeklyWageContribution,
      returnAfterSeason:      state.season,
    };

    if (!state.activeLoans) (state as any).activeLoans = [];
    state.activeLoans.push(loan);
    (player as any).clubId = state.playerClubId;

    recalculateWageBill(state.playerClubId);
    recalculateWageBill(originalClubId);

    state.lastUpdated = state.currentDate;
    console.log(`[worker] Loan in: ${player.name} from club ${originalClubId}.`);
    sendSync(jobId);
  } catch (err) {
    console.error('[worker] LOAN_IN_PLAYER crashed:', err);
    sendError(jobId, err instanceof Error ? err.message : String(err));
  }
}

function handleLoanOutPlayer(action: {
  type:    'LOAN_OUT_PLAYER';
  jobId:   string;
  payload: { playerId: string; toClubId: string; weeklyWageContribution: number };
}): void {
  const { jobId, payload } = action;
  if (!requireState(jobId, 'LOAN_OUT_PLAYER')) return;

  try {
    const { playerId, toClubId, weeklyWageContribution } = payload;
    const player = state.players[playerId];
    const toClub = state.clubs[toClubId];

    if (!player) { sendError(jobId, 'Player not found.'); return; }
    if (!toClub) { sendError(jobId, 'Destination club not found.'); return; }
    if (player.clubId !== state.playerClubId) { sendError(jobId, 'Player is not in your squad.'); return; }

    const existingLoan = (state.activeLoans ?? []).find(l => l.playerId === playerId);
    if (existingLoan) { sendError(jobId, 'Player is already involved in a loan.'); return; }

    const loan: LoanRecord = {
      id:                     crypto.randomUUID(),
      playerId,
      lendingClubId:          state.playerClubId,
      borrowingClubId:        toClubId,
      weeklyWageContribution,
      returnAfterSeason:      state.season,
    };

    if (!state.activeLoans) (state as any).activeLoans = [];
    state.activeLoans.push(loan);
    (player as any).clubId = toClubId;

    recalculateWageBill(state.playerClubId);
    recalculateWageBill(toClubId);

    state.lastUpdated = state.currentDate;
    console.log(`[worker] Loan out: ${player.name} to ${toClub.name}.`);
    sendSync(jobId);
  } catch (err) {
    console.error('[worker] LOAN_OUT_PLAYER crashed:', err);
    sendError(jobId, err instanceof Error ? err.message : String(err));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Message Router
// ─────────────────────────────────────────────────────────────────────────────

self.onmessage = (event: MessageEvent) => {
  const action = event.data;
  if (!action?.type) { console.warn('[worker] Received message with no type:', action); return; }
  console.log('[worker] Received action:', action.type, '| jobId:', action.jobId);
  switch (action.type) {
    case 'INIT_LEAGUE':         handleInitLeague(action);         break;
    case 'SIM_DAY':             handleSimDay(action);             break;
    case 'SIM_TO_DATE':         handleSimToDate(action);          break;
    case 'CANCEL_SIM':          handleCancelSim(action);          break;
    case 'UPDATE_TACTICS':      handleUpdateTactics(action);      break;
    case 'SAVE_GAME':           handleSaveGame(action);           break;
    case 'MAKE_TRANSFER_OFFER': handleMakeTransferOffer(action);  break;
    case 'ACCEPT_BID':          handleAcceptBid(action);          break;
    case 'REJECT_BID':          handleRejectBid(action);          break;
    // Phase 7
    case 'UPGRADE_STADIUM':     handleUpgradeStadium(action);     break;
    case 'ACCEPT_SPONSORSHIP':  handleAcceptSponsorship(action);  break;
    case 'REJECT_SPONSORSHIP':  handleRejectSponsorship(action);  break;
    case 'LOAN_IN_PLAYER':      handleLoanInPlayer(action);       break;
    case 'LOAN_OUT_PLAYER':     handleLoanOutPlayer(action);      break;
    default:
      console.warn('[worker] Unknown action type:', action.type);
      if (action.jobId) sendError(action.jobId, `Unknown action type: ${action.type}`);
  }
};

console.log('[worker] sim.worker.ts loaded and ready ✅');
