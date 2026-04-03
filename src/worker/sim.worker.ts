/**
 * sim.worker.ts — The Simulation Engine (Background Thread)
 *
 * Runs on a completely separate thread from the UI.
 * Communicates ONLY via self.postMessage() and self.onmessage.
 *
 * Phase 4 additions vs the stub:
 *   ✅ Round-robin fixture schedule generated on INIT_LEAGUE
 *   ✅ Probabilistic match engine (Poisson-based goals)
 *   ✅ Standings updated and re-sorted after every simulated match
 *   ✅ MATCH_RESULT emitted for every completed game
 *   ✅ playerClubId field name fixed (was: managerClubId)
 *   ✅ buildInitialStandings positions are 1-indexed (was: 0-indexed)
 *   ✅ SIM_TO_DATE reads targetDate from action.payload (per types.ts contract)
 */

import { Tier, type SerializedGameState, type Fixture, type MatchReport, type MatchEvent, type ClubMatchStats, type PlayerMatchRating } from '../types';
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

  // FIX: index + 1 so position is 1-based (was 0-based, broke zone colours)
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

/**
 * Classic circle-method round-robin.
 * Keeps teams[0] fixed and rotates the rest each round.
 * Returns rounds × games as [homeId, awayId] pairs.
 */
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
    // Rotate: fix teams[0], move last to position 1
    const last = teams.pop()!;
    teams.splice(1, 0, last);
  }

  return rounds;
}

/**
 * Generate a complete home-and-away league schedule for all four tiers.
 * Matchweeks are spaced 7 days apart starting from startDate.
 */
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

/** Poisson random variable — models goals from an expected-goals value. */
function poissonRandom(lambda: number): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-Math.min(lambda, 20));
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L && k < 20);
  return k - 1;
}

/**
 * Returns the starting XI for a club.
 * Uses the manager-set XI if exactly 11 players are selected,
 * otherwise auto-selects the 11 highest-ability active players.
 */
function getStartingXI(clubId: string): string[] {
  const xi = state!.clubs[clubId]?.tactics?.startingXI;
  if (xi && xi.length === 11) return [...xi];

  return Object.values(state!.players)
    .filter(p => p.clubId === clubId && p.status === 'active')
    .sort((a, b) => b.currentAbility - a.currentAbility)
    .slice(0, 11)
    .map(p => p.id);
}

/** Average current ability of a player ID list. */
function teamAbility(playerIds: string[]): number {
  if (!playerIds.length) return 50;
  let total = 0, count = 0;
  for (const id of playerIds) {
    const p = state!.players[id];
    if (p) { total += p.currentAbility; count++; }
  }
  return count > 0 ? total / count : 50;
}

/** Pick a goalscorer weighted by each player's finishing attribute. */
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

/** Simulate a single match and return a full MatchReport. */
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

  // Goal events at unique minutes
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

/** Update standings after a completed match and re-sort. */
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

/** Simulate all scheduled fixtures on `date`. Returns every MatchReport. */
function simulateMatchesOnDate(date: string): MatchReport[] {
  const reports: MatchReport[] = [];
  const toPlay = Object.values(state!.fixtures)
    .filter(f => f.date === date && f.status === 'scheduled');

  for (const fixture of toPlay) {
    fixture.status = 'completed';
    const report   = simulateMatch(fixture);
    fixture.result = {
      fixtureId:  fixture.id,
      homeGoals:  report.homeStats.goals,
      awayGoals:  report.awayStats.goals,
      homexG:     report.homeStats.xG,
      awayxG:     report.awayStats.xG,
      attendance: 10_000 + Math.round(Math.random() * 40_000),
    };
    updateStandings(report, fixture);
    reports.push(report);
  }

  return reports;
}

/** Move pre_season → regular_season once the first match is played. */
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
    // The game clock starts one day BEFORE the first fixtures so that the
    // first "To next fixture" / "One day" call advances into Aug 9 and
    // correctly simulates that matchweek.  The while loop in SIM_TO_DATE is
    // strict less-than, so currentDate must be < targetDate to run.
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
    // Fixtures start on firstFixtureDate (Aug 9), not startDate (Aug 8)
    const fixtures  = generateFixtures(clubs, firstFixtureDate);

    // Cast to any to allow the extra 'seed' field (not in SerializedGameState
    // by design, but kept for save/load compatibility).
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
      playerClubId,          // FIX: was 'managerClubId' — broke all player-club lookups
      nonLeagueClubIds: [],
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
    updatePhase();

    // Emit MATCH_RESULT for every game today — one day = at most one full
    // matchweek across all tiers (~46 games), which is manageable.
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
  targetDate?: string; // legacy flat field — accepted for compat
}): Promise<void> {
  const { jobId } = action;

  // FIX: types.ts contract puts targetDate inside .payload
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
      updatePhase();

      // During fast-forward only emit the player club's matches to avoid
      // flooding the inbox with hundreds of unrelated reports.
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

// ─────────────────────────────────────────────────────────────────────────────
// Message Router
// ─────────────────────────────────────────────────────────────────────────────

self.onmessage = (event: MessageEvent) => {
  const action = event.data;
  if (!action?.type) { console.warn('[worker] Received message with no type:', action); return; }
  console.log('[worker] Received action:', action.type, '| jobId:', action.jobId);
  switch (action.type) {
    case 'INIT_LEAGUE':    handleInitLeague(action);    break;
    case 'SIM_DAY':        handleSimDay(action);         break;
    case 'SIM_TO_DATE':    handleSimToDate(action);      break;
    case 'CANCEL_SIM':     handleCancelSim(action);      break;
    case 'UPDATE_TACTICS': handleUpdateTactics(action);  break;
    case 'SAVE_GAME':      handleSaveGame(action);       break;
    default:
      console.warn('[worker] Unknown action type:', action.type);
      if (action.jobId) sendError(action.jobId, `Unknown action type: ${action.type}`);
  }
};

console.log('[worker] sim.worker.ts loaded and ready ✅');
