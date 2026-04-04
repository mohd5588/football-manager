/**
 * sim.worker.ts — The Simulation Engine (Background Thread)
 *
 * Phase 6 additions:
 *   ✅ Matchday revenue added to home club's balance after every match
 *   ✅ Weekly wage bill deducted from every club every Monday
 *   ✅ AI transfer bids generated on the 1st of each month
 *   ✅ MAKE_TRANSFER_OFFER — manager buys a player from an AI club
 *   ✅ ACCEPT_BID — manager accepts an AI club's offer for their player
 *   ✅ REJECT_BID — manager rejects a bid, removes it from pendingBids
 *   ✅ recalculateWageBill() keeps club.finances.wageBill accurate after transfers
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

/** Returns true if the ISO date falls on a Monday (UTC). */
function isMonday(iso: string): boolean {
  return parseDate(iso).getUTCDay() === 1;
}

/** Returns true if the ISO date is the 1st day of a month. */
function isFirstOfMonth(iso: string): boolean {
  return iso.endsWith('-01');
}

// ─────────────────────────────────────────────────────────────────────────────
// Economy Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recalculate a club's wageBill as the sum of all its players' weeklyWage.
 * Called after any transfer so the sidebar finance strip stays accurate.
 */
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
 * Deduct each club's weekly wage bill on Mondays.
 * Plain English: every Monday the game "pays the players" from the club's bank.
 */
function processEndOfDay(date: string): void {
  if (!state) return;
  if (isMonday(date)) {
    for (const club of Object.values(state.clubs)) {
      club.finances.balance -= club.finances.wageBill;
    }
  }
}

/**
 * Generate AI transfer bids targeting the manager's best players.
 * Called on the 1st of each month during regular_season.
 *
 * Logic:
 *  - Any manager player with ability > tierMean + 5 is "attractive"
 *  - Each attractive player has a 20% chance of receiving a bid
 *  - Maximum 2 new bids generated per month
 *  - A player already receiving a bid is skipped
 */
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

  // Players that are above average for their tier — attractive to other clubs
  const attractive = myPlayers.filter(p => p.currentAbility > tierMean + 5);
  if (attractive.length === 0) return;

  const otherClubs = Object.values(state.clubs).filter(c => c.id !== playerClubId);
  if (otherClubs.length === 0) return;

  let bidsThisMonth = 0;

  for (const player of attractive) {
    if (bidsThisMonth >= 2) break;

    // 20% chance per player
    if (Math.random() > 0.2) continue;

    // Skip if there's already a pending bid for this player
    const existingBid = (state.pendingBids ?? []).find(b => b.playerId === player.id);
    if (existingBid) continue;

    // Pick a random AI club
    const fromClub = otherClubs[Math.floor(Math.random() * otherClubs.length)];

    // Bid fee formula from spec
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

function teamAbility(playerIds: string[]): number {
  if (!playerIds.length) return 50;
  let total = 0, count = 0;
  for (const id of playerIds) {
    const p = state!.players[id];
    if (p) { total += p.currentAbility; count++; }
  }
  return count > 0 ? total / count : 50;
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

  const homeLambda = (homeAbility / 100) * 2.0 * 1.15; // home advantage
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
 * Simulate all scheduled matches on a given date and return the reports.
 * Also adds matchday stadium revenue to the home club's balance.
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

    // ── Matchday revenue: home club earns 70–100% of their stadiumRevenue ──
    // Plain English: bigger crowds (random variation) mean more ticket income.
    const homeClub = state!.clubs[fixture.homeClubId];
    if (homeClub) {
      const attendanceMod = 0.7 + Math.random() * 0.3;
      homeClub.finances.balance += Math.round(homeClub.finances.stadiumRevenue * attendanceMod);
    }

    updateStandings(report, fixture);
    reports.push(report);
  }

  return reports;
}

function updatePhase(): void {
  if (!state || state.phase !== 'pre_season') return;
  if (Object.values(state.fixtures).some(f => f.status === 'completed')) {
    state.phase = 'regular_season';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Action Handlers
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
      saveId:          crypto.randomUUID(),
      saveName:        'New Game',
      version:         '0.1.0',
      seed,
      season,
      currentDate:     startDate,
      phase:           'pre_season',
      clubs,
      players,
      fixtures,
      standings,
      playoffBrackets: {
        [Tier.EPL]: null, [Tier.Championship]: null,
        [Tier.LeagueOne]: null, [Tier.LeagueTwo]: null,
      },
      playerClubId,
      nonLeagueClubIds: [],
      pendingBids:      [],   // ← Phase 6: initialise empty bid list
      lastUpdated:      startDate,
    };

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

/**
 * Manager buys a player from an AI club.
 * Deducts fee from manager's transferBudget + balance.
 * Adds fee to selling club's balance.
 * Moves player to manager's squad and recalculates both wage bills.
 */
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

    // Deduct from manager's budget and balance
    managerClub.finances.transferBudget -= fee;
    managerClub.finances.balance        -= fee;

    // Credit the selling club
    if (sellingClub) sellingClub.finances.balance += fee;

    // Move player and set new wage
    (player as any).clubId     = state.playerClubId;
    (player as any).weeklyWage = weeklyWage;

    // Recalculate both clubs' wage bills
    recalculateWageBill(state.playerClubId);
    if (sellingClub) recalculateWageBill(sellingClubId);

    state.lastUpdated = state.currentDate;
    sendSync(jobId);
  } catch (err) {
    console.error('[worker] MAKE_TRANSFER_OFFER crashed:', err);
    sendError(jobId, err instanceof Error ? err.message : String(err));
  }
}

/**
 * Manager accepts an AI bid for one of their players.
 * Credits fee to manager's balance + transferBudget.
 * Moves player to the buying club.
 */
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

    // Credit the manager
    if (managerClub) {
      managerClub.finances.balance        += bid.fee;
      managerClub.finances.transferBudget += bid.fee;
    }

    // Deduct from buying club
    if (buyClub) buyClub.finances.balance -= bid.fee;

    // Move player
    (player as any).clubId = bid.fromClubId;

    // Remove this bid from the list
    state.pendingBids = (state.pendingBids ?? []).filter(b => b.id !== bid.id);

    // Recalculate wage bills for both clubs
    recalculateWageBill(state.playerClubId);
    if (buyClub) recalculateWageBill(buyClub.id);

    state.lastUpdated = state.currentDate;
    sendSync(jobId);
  } catch (err) {
    console.error('[worker] ACCEPT_BID crashed:', err);
    sendError(jobId, err instanceof Error ? err.message : String(err));
  }
}

/** Manager rejects a bid — just removes it from the pending list. */
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
// Message Router
// ─────────────────────────────────────────────────────────────────────────────

self.onmessage = (event: MessageEvent) => {
  const action = event.data;
  if (!action?.type) { console.warn('[worker] Received message with no type:', action); return; }
  console.log('[worker] Received action:', action.type, '| jobId:', action.jobId);
  switch (action.type) {
    case 'INIT_LEAGUE':          handleInitLeague(action);          break;
    case 'SIM_DAY':              handleSimDay(action);              break;
    case 'SIM_TO_DATE':          handleSimToDate(action);           break;
    case 'CANCEL_SIM':           handleCancelSim(action);           break;
    case 'UPDATE_TACTICS':       handleUpdateTactics(action);       break;
    case 'SAVE_GAME':            handleSaveGame(action);            break;
    case 'MAKE_TRANSFER_OFFER':  handleMakeTransferOffer(action);   break;
    case 'ACCEPT_BID':           handleAcceptBid(action);           break;
    case 'REJECT_BID':           handleRejectBid(action);           break;
    default:
      console.warn('[worker] Unknown action type:', action.type);
      if (action.jobId) sendError(action.jobId, `Unknown action type: ${action.type}`);
  }
};

console.log('[worker] sim.worker.ts loaded and ready ✅');
