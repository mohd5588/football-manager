/**
 * sim.worker.ts — The Simulation Engine (Background Thread)
 *
 * Plain English: This file runs on a completely SEPARATE THREAD from the UI.
 * Think of it like a back-office that does all the heavy calculation work
 * while the shop front (React UI) stays open and responsive.
 *
 * Rules of the Worker:
 *   ❌ Cannot touch the DOM (no document.querySelector, no getElementById)
 *   ❌ Cannot import React or Zustand
 *   ✅ CAN use fetch, crypto, console.log
 *   ✅ CAN import our own TypeScript files
 *   ✅ Communicates ONLY via self.postMessage() and self.onmessage
 */

import { Tier, type SerializedGameState } from '../types';
import { generateWorld } from './engine/worldGen';

// ─────────────────────────────────────────────────────────────────────────────
// Worker State
// ─────────────────────────────────────────────────────────────────────────────

let state: SerializedGameState | null = null;
let cancelRequested = false;

// ─────────────────────────────────────────────────────────────────────────────
// postMessage helpers
//
// IMPORTANT: The shape of every message here must exactly match what
// workerBridge.ts and SimulationService.ts expect to receive.
// ─────────────────────────────────────────────────────────────────────────────

function sendSync(jobId: string): void {
  if (!state) return;
  // workerBridge → isSyncStateResponse → then reads response.state
  self.postMessage({ type: 'SYNC_STATE', jobId, state });
}

function sendError(jobId: string, message: string): void {
  // workerBridge reads response.message directly (not response.payload.message)
  console.error('[worker] Sending WORKER_ERROR:', message);
  self.postMessage({ type: 'WORKER_ERROR', jobId, message });
}

function sendProgress(jobId: string, percentComplete: number, label: string): void {
  // workerBridge reads response.percentComplete and response.label
  self.postMessage({ type: 'PROGRESS_REPORT', jobId, percentComplete, label });
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
    if (byTier[club.tier] !== undefined) {
      byTier[club.tier].push(club.id);
    }
  }

  const makeRow = (clubId: string, position: number) => ({
    clubId,
    position,
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
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Action Handlers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * INIT_LEAGUE — "New Game"
 *
 * SimulationService sends: { type: 'INIT_LEAGUE', jobId, config: { seed, managerClubId } }
 * We read action.config (NOT action.payload — that was the old shape).
 */
function handleInitLeague(action: { type: 'INIT_LEAGUE'; jobId: string; config: { seed: number; managerClubId: string | null } }): void {
  const { jobId, config } = action;

  try {
    console.log('[worker] INIT_LEAGUE started, seed:', config.seed);

    const seed      = config.seed ?? Date.now();
    const season    = 2025;
    const startDate = `${season}-08-09`;

    // Generate all 92 clubs and ~1,840 players
    const { clubs, players } = generateWorld({
      seed,
      season,
      regions: [
        'north_west', 'north_east', 'yorkshire', 'midlands',
        'east', 'london', 'south_east', 'south_west', 'wales',
      ],
    });

    // Pick the manager's club
    // If a specific club ID was passed, use it; otherwise use the first EPL club
    let playerClubId = config.managerClubId;
    if (!playerClubId || !clubs[playerClubId]) {
      playerClubId = Object.values(clubs).find(
        (c) => c.tier === Tier.EPL
      )?.id ?? Object.keys(clubs)[0];
    }

    clubs[playerClubId].isPlayerManaged = true;

    const standings = buildInitialStandings(clubs);

    state = {
      saveId:           crypto.randomUUID(),
      saveName:         'New Game',
      version:          '0.1.0',
      seed,
      season,
      currentDate:      startDate,
      phase:            'pre_season',
      clubs,
      players,
      fixtures:         {},
      standings,
      playoffBrackets: {
        [Tier.EPL]:          null,
        [Tier.Championship]: null,
        [Tier.LeagueOne]:    null,
        [Tier.LeagueTwo]:    null,
      },
      managerClubId:    playerClubId,
      nonLeagueClubIds: [],
      lastUpdated:      startDate,
    };

    console.log('[worker] World generated:', Object.keys(clubs).length, 'clubs,', Object.keys(players).length, 'players.');
    sendSync(jobId);

  } catch (err) {
    // Log the REAL error so we can see it in the browser console
    console.error('[worker] INIT_LEAGUE crashed:', err);
    sendError(jobId, err instanceof Error ? err.message : String(err));
  }
}

/**
 * SIM_DAY — advance the calendar by one day
 *
 * SimulationService sends: { type: 'SIM_DAY', jobId }
 */
function handleSimDay(action: { type: 'SIM_DAY'; jobId: string }): void {
  const { jobId } = action;
  if (!requireState(jobId, 'SIM_DAY')) return;

  try {
    state.currentDate = addDays(state.currentDate, 1);
    state.lastUpdated = state.currentDate;
    sendSync(jobId);
  } catch (err) {
    console.error('[worker] SIM_DAY crashed:', err);
    sendError(jobId, err instanceof Error ? err.message : String(err));
  }
}

/**
 * SIM_TO_DATE — fast-forward to a target date
 *
 * SimulationService sends: { type: 'SIM_TO_DATE', jobId, targetDate: string }
 */
async function handleSimToDate(action: { type: 'SIM_TO_DATE'; jobId: string; targetDate: string }): Promise<void> {
  const { jobId, targetDate } = action;
  if (!requireState(jobId, 'SIM_TO_DATE')) return;

  cancelRequested = false;

  try {
    const startMs  = parseDate(state.currentDate).getTime();
    const targetMs = parseDate(targetDate).getTime();
    const totalDays = Math.max(1, Math.round((targetMs - startMs) / 86_400_000));
    let daysAdvanced = 0;

    while (isBefore(state.currentDate, targetDate) && !cancelRequested) {
      state.currentDate = addDays(state.currentDate, 1);
      state.lastUpdated = state.currentDate;
      daysAdvanced++;

      if (daysAdvanced % 7 === 0) {
        const pct = Math.min(99, Math.round((daysAdvanced / totalDays) * 100));
        sendProgress(jobId, pct, `Simulating ${state.currentDate}…`);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }

    sendProgress(jobId, 100, 'Done');
    sendSync(jobId);

  } catch (err) {
    console.error('[worker] SIM_TO_DATE crashed:', err);
    sendError(jobId, err instanceof Error ? err.message : String(err));
  }
}

/**
 * CANCEL_SIM — stops a running SIM_TO_DATE
 */
function handleCancelSim(_action: { type: 'CANCEL_SIM'; jobId: string }): void {
  cancelRequested = true;
}

/**
 * UPDATE_TACTICS
 *
 * SimulationService sends: { type: 'UPDATE_TACTICS', jobId, clubId, startingXI }
 */
function handleUpdateTactics(action: { type: 'UPDATE_TACTICS'; jobId: string; clubId: string; startingXI: string[] }): void {
  const { jobId, clubId, startingXI } = action;
  if (!requireState(jobId, 'UPDATE_TACTICS')) return;

  try {
    if (!state.clubs[clubId]) {
      sendError(jobId, `No club found with id: ${clubId}`);
      return;
    }

    if (startingXI.length !== 11) {
      sendError(jobId, 'Starting XI must contain exactly 11 players.');
      return;
    }

    state.clubs[clubId].tactics = { startingXI };
    state.lastUpdated = state.currentDate;
    sendSync(jobId);

  } catch (err) {
    console.error('[worker] UPDATE_TACTICS crashed:', err);
    sendError(jobId, err instanceof Error ? err.message : String(err));
  }
}

/**
 * SAVE_GAME
 *
 * SimulationService sends: { type: 'SAVE_GAME', jobId, slotIndex: number }
 * We send back SAVE_EXPORT with response.state (flat, not nested under payload).
 */
function handleSaveGame(action: { type: 'SAVE_GAME'; jobId: string; slotIndex: number }): void {
  const { jobId, slotIndex } = action;
  if (!requireState(jobId, 'SAVE_GAME')) return;

  try {
    // SimulationService reads response.state directly
    self.postMessage({
      type:      'SAVE_EXPORT',
      jobId,
      slotIndex,
      state:     { ...state },
      exportedAt: state.currentDate,
    });

  } catch (err) {
    console.error('[worker] SAVE_GAME crashed:', err);
    sendError(jobId, err instanceof Error ? err.message : String(err));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Message Router — the worker's front door
// ─────────────────────────────────────────────────────────────────────────────

self.onmessage = (event: MessageEvent) => {
  const action = event.data;

  if (!action?.type) {
    console.warn('[worker] Received message with no type:', action);
    return;
  }

  console.log('[worker] Received action:', action.type, '| jobId:', action.jobId);

  switch (action.type) {
    case 'INIT_LEAGUE':    handleInitLeague(action);   break;
    case 'SIM_DAY':        handleSimDay(action);        break;
    case 'SIM_TO_DATE':    handleSimToDate(action);     break;
    case 'CANCEL_SIM':     handleCancelSim(action);     break;
    case 'UPDATE_TACTICS': handleUpdateTactics(action); break;
    case 'SAVE_GAME':      handleSaveGame(action);      break;

    default:
      console.warn('[worker] Unknown action type:', action.type);
      if (action.jobId) {
        sendError(action.jobId, `Unknown action type: ${action.type}`);
      }
  }
};

console.log('[worker] sim.worker.ts loaded and ready ✅');
