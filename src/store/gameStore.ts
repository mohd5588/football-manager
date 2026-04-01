/**
 * src/store/gameStore.ts
 *
 * The "game state mirror" — a Zustand store that holds a read-only snapshot
 * of the authoritative state that lives inside the Web Worker.
 *
 * Rules:
 *   - Components READ from this store via hooks (e.g. useGameStore(s => s.gameState))
 *   - Components NEVER write to this store directly
 *   - Only SimulationService writes to this store (via the actions below)
 *   - The store holds null until a game is initialised or loaded
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { ClientGameState } from '../types';

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

interface GameStoreState {
  /** The full game state.  null before a world is generated or loaded. */
  gameState: ClientGameState | null;

  /** True while the worker is processing a long-running task (fast-forward). */
  isSimulating: boolean;

  /**
   * Fast-forward progress, 0–100.
   * Updated by PROGRESS_REPORT messages during SIM_TO_DATE.
   */
  progress: number;
}

// ---------------------------------------------------------------------------
// Actions (not exposed directly to components — SimulationService calls them)
// ---------------------------------------------------------------------------

interface GameStoreActions {
  /** Replace the entire game state (called after SYNC_STATE from worker). */
  setGameState: (state: ClientGameState) => void;

  /** Toggle the "simulation in progress" flag. */
  setSimulating: (value: boolean) => void;

  /** Update the fast-forward progress percentage. */
  setProgress: (pct: number) => void;

  /** Reset everything — called when the user returns to the main menu. */
  resetGame: () => void;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const INITIAL_STATE: GameStoreState = {
  gameState: null,
  isSimulating: false,
  progress: 0,
};

// ---------------------------------------------------------------------------
// Store creation
// ---------------------------------------------------------------------------

/**
 * The main game store.
 *
 * `devtools` middleware is included so you can inspect state in the
 * Redux DevTools browser extension during development.
 */
export const useGameStore = create<GameStoreState & GameStoreActions>()(
  devtools(
    (set) => ({
      ...INITIAL_STATE,

      setGameState: (state: ClientGameState) =>
        set({ gameState: state }, false, 'setGameState'),

      setSimulating: (value: boolean) =>
        set({ isSimulating: value }, false, 'setSimulating'),

      setProgress: (pct: number) =>
        set({ progress: pct }, false, 'setProgress'),

      resetGame: () =>
        set(INITIAL_STATE, false, 'resetGame'),
    }),
    { name: 'FootballManager/GameStore' }
  )
);

// ---------------------------------------------------------------------------
// Selector helpers
// ---------------------------------------------------------------------------
// Pre-built selectors to avoid creating new function references on each render
// (which would cause unnecessary re-renders in child components).

/** Returns the full game state, or null if no game is active. */
export const selectGameState = (s: GameStoreState) => s.gameState;

/** Returns true if the worker is currently running a long simulation. */
export const selectIsSimulating = (s: GameStoreState) => s.isSimulating;

/** Returns the current fast-forward progress percentage (0–100). */
export const selectProgress = (s: GameStoreState) => s.progress;

/** Returns the list of all clubs, or an empty array if no game is active. */
export const selectClubs = (s: GameStoreState) => s.gameState?.clubs ?? [];

/** Returns standings for a given tier. */
export const selectStandings =
  (tier: string) =>
  (s: GameStoreState) =>
    s.gameState?.standings[tier] ?? [];

/**
 * Returns the club the player is managing, or null.
 *
 * Priority order:
 *   1. gameState.playerClub  — pre-computed by SimulationService.toClientState()
 *                              always set, even when playerClubId is missing
 *   2. clubs[playerClubId]   — direct lookup if playerClubId is populated
 *   3. first club in object  — last resort so the dashboard never stays blank
 */
export const selectManagerClub = (s: GameStoreState) => {
  const { gameState } = s;
  if (!gameState) return null;
  return (
    gameState.playerClub ??
    gameState.clubs[gameState.playerClubId] ??
    Object.values(gameState.clubs)[0] ??
    null
  );
};
