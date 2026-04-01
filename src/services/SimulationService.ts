/**
 * src/services/SimulationService.ts
 *
 * The authoritative implementation of ISimulationService.
 *
 * This is the ONLY module that:
 *   - Calls workerBridge.send()
 *   - Writes save data to IndexedDB via Dexie helpers
 *   - Updates the Zustand gameStore after each worker response
 *   - Routes MATCH_RESULT responses to the inboxStore
 *
 * All React components call methods on this service. They never touch the
 * bridge, the worker, or the database directly.
 *
 * NOTE ON FIELD NAMING
 * --------------------
 * types.ts defines SyncStateResponse with a `.payload` field.
 * The actual worker (sim.worker.ts) sends the game data in `.state`.
 * Wherever we read a SYNC_STATE response we use:
 *   (response as any).state ?? (response as any).payload
 * so this service works with the real worker output today, and will
 * continue to work if the worker is updated to match types.ts later.
 */

import type {
  ISimulationService,
  ClientGameState,
  SerializedGameState,
  WorkerResponse,
  SaveSlotMeta,
  WorldGenConfig,
} from '../types';
import { isSyncStateResponse, isSaveExportResponse, isMatchResultResponse } from '../types';
import { workerBridge } from './workerBridge';
import {
  writeSaveSlot,
  readSaveSlot,
  listSaveSlots,
  deleteSaveSlot,
} from '../db/database';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Safely extract the SerializedGameState from a SYNC_STATE response.
 *
 * The worker sends it as `response.state`.
 * types.ts declares it as `response.payload`.
 * This function handles both so nothing breaks either way.
 */
function extractState(response: WorkerResponse): SerializedGameState | null {
  const r = response as Record<string, unknown>;
  const raw = (r.state ?? r.payload) as SerializedGameState | undefined;
  return raw ?? null;
}

/**
 * Convert the raw SerializedGameState (arrives from the worker) into
 * the ClientGameState shape that Zustand and the UI components use.
 *
 * This derives three convenience fields the dashboard reads directly:
 *
 *   playerClub         — the Club object the manager is in charge of
 *   nextFixture        — the next unplayed game for that club
 *   playerStandingsRow — that club's current row in the league table
 */
function toClientState(raw: SerializedGameState): ClientGameState {
  // ── 1. Find the player's club ─────────────────────────────────────────
  // clubs is an object keyed by ID: { "club_0": { id: "club_0", ... } }
  // If playerClubId is not set, fall back to the first club in the object.
  const playerClub =
    raw.clubs[raw.playerClubId] ??
    Object.values(raw.clubs)[0] ??
    null;

  // ── 2. Find the next unplayed fixture for the player's club ───────────
  const nextFixture = playerClub
    ? Object.values(raw.fixtures)
        .filter(
          (f) =>
            f.status === 'scheduled' &&
            (f.homeClubId === playerClub.id || f.awayClubId === playerClub.id)
        )
        .sort((a, b) => (a.date < b.date ? -1 : 1))[0] ?? null
    : null;

  // ── 3. Find the player's row in the standings table ───────────────────
  const playerStandingsRow = playerClub
    ? (raw.standings[playerClub.currentTier] ?? []).find(
        (row) => row.clubId === playerClub.id
      ) ?? null
    : null;

  return {
    ...raw,
    playerClub:         playerClub!,
    nextFixture:        nextFixture,
    playerStandingsRow: playerStandingsRow,
    isSimulating:       false,
    simulationProgress: 0,
  };
}

// ---------------------------------------------------------------------------
// SimulationService class
// ---------------------------------------------------------------------------

class SimulationService implements ISimulationService {
  // Tracks the jobId of any running SIM_TO_DATE so we can cancel it
  private currentJobId: string | null = null;

  constructor() {
    // ── Global SYNC_STATE handler ──────────────────────────────────────
    // Every time the worker pushes new state (after a match, after a save,
    // during fast-forward) this fires and updates Zustand immediately.
    workerBridge.onSyncState((response: WorkerResponse) => {
      if (isSyncStateResponse(response)) {
        const raw = extractState(response);
        if (raw) this.applyGameState(raw);
      }
    });

    // ── Global MATCH_RESULT handler ────────────────────────────────────
    // After each simulated game the worker emits a MATCH_RESULT containing
    // a MatchReport. We route it to the inboxStore so it appears in the
    // Tactical tab of the Inbox drawer.
    workerBridge.onSyncState((response: WorkerResponse) => {
      if (isMatchResultResponse(response)) {
        const r = response as Record<string, unknown>;
        const report = (r.payload ?? r.report) as Record<string, unknown> | undefined;
        if (report) {
          import('../store/inboxStore').then(({ useInboxStore }) => {
            useInboxStore.getState().pushReport(report as any);
          });
        }
      }
    });

    console.log('[SimulationService] Ready ✅');
  }

  // ─── League initialisation ─────────────────────────────────────────────

  async initLeague(config: WorldGenConfig): Promise<void> {
    const { useGameStore } = await import('../store/gameStore');
    useGameStore.getState().setSimulating(true);

    try {
      const response = await workerBridge.send({
        type: 'INIT_LEAGUE',
        config,
      });

      if (isSyncStateResponse(response)) {
        const raw = extractState(response);
        if (raw) this.applyGameState(raw);
      }
    } finally {
      useGameStore.getState().setSimulating(false);
    }
  }

  // ─── Day simulation ────────────────────────────────────────────────────

  async simDay(): Promise<void> {
    const { useGameStore } = await import('../store/gameStore');
    useGameStore.getState().setSimulating(true);

    try {
      await workerBridge.send({ type: 'SIM_DAY', payload: {} });
      // Worker sends SYNC_STATE automatically — the handler above updates Zustand.
    } finally {
      useGameStore.getState().setSimulating(false);
    }
  }

  // ─── Fast-forward to a target date ─────────────────────────────────────

  async simToDate(
    payload: { targetDate: string; maxDays?: number },
    onProgress?: (r: WorkerResponse) => void
  ): Promise<void> {
    const { useGameStore } = await import('../store/gameStore');
    useGameStore.getState().setSimulating(true);

    try {
      await workerBridge.send(
        {
          type:    'SIM_TO_DATE',
          payload: {
            targetDate: payload.targetDate,
            maxDays:    payload.maxDays ?? 365,
          },
        },
        (progressResponse) => {
          if (progressResponse.type === 'PROGRESS_REPORT') {
            const r = progressResponse as Record<string, unknown>;
            const pct =
              ((r.payload as Record<string, unknown>)?.percent as number) ??
              (r.percentComplete as number) ??
              0;
            useGameStore.getState().setProgress(pct);
            onProgress?.(progressResponse);
          }
        }
      );
    } finally {
      useGameStore.getState().setSimulating(false);
      useGameStore.getState().setProgress(0);
      this.currentJobId = null;
    }
  }

  // ─── Cancel simulation ─────────────────────────────────────────────────

  cancelSim(): void {
    workerBridge.send({
      type:    'CANCEL_SIM',
      payload: { targetJobId: this.currentJobId ?? '' },
    }).catch(() => {
      // CANCEL_SIM may not always send a terminal response — safe to swallow.
    });
    this.currentJobId = null;
  }

  // Called by the Stop button in SimulateControl
  cancelCurrentSim(): void {
    this.cancelSim();
  }

  // ─── Tactics ───────────────────────────────────────────────────────────

  async updateTactics(clubId: string, startingXI: string[]): Promise<void> {
    if (startingXI.length !== 11) {
      throw new Error('Starting XI must contain exactly 11 player IDs');
    }
    await workerBridge.send({
      type:    'UPDATE_TACTICS',
      payload: { clubId, tactics: { startingXI } },
    });
  }

  // ─── Save / Load ────────────────────────────────────────────────────────

  async saveGame(slotIndex: number, slotName: string): Promise<void> {
    if (slotIndex < 0 || slotIndex > 4) {
      throw new Error('Save slot must be between 0 and 4');
    }

    const response = await workerBridge.send({
      type:    'SAVE_GAME',
      payload: { slotIndex: slotIndex as 0 | 1 | 2 | 3 | 4, saveName: slotName },
    });

    if (!isSaveExportResponse(response)) {
      throw new Error('Worker did not return a SAVE_EXPORT response');
    }

    // Handle both .payload.snapshot and .snapshot field names
    const r = response as Record<string, unknown>;
    const snapshot =
      ((r.payload as Record<string, unknown>)?.snapshot ?? r.snapshot) as SerializedGameState;

    await writeSaveSlot(slotIndex, slotName, snapshot);
    console.log(`[SimulationService] Game saved to slot ${slotIndex} ("${slotName}")`);
  }

  async loadGame(slotIndex: number): Promise<void> {
    const { useGameStore } = await import('../store/gameStore');
    useGameStore.getState().setSimulating(true);

    try {
      const record = await readSaveSlot(slotIndex);
      if (!record) throw new Error(`No save found in slot ${slotIndex}`);

      await workerBridge.send({
        type: 'INIT_LEAGUE',
        config: {
          seed:          record.state.seed,
          managerClubId: record.state.playerClubId,
        },
      });

      this.applyGameState(record.state);
      console.log(`[SimulationService] Game loaded from slot ${slotIndex}`);
    } finally {
      useGameStore.getState().setSimulating(false);
    }
  }

  async listSaves(): Promise<SaveSlotMeta[]> {
    return listSaveSlots();
  }

  async deleteSave(slotIndex: number): Promise<void> {
    await deleteSaveSlot(slotIndex);
  }

  // ─── JSON Export / Import ───────────────────────────────────────────────

  async exportToJson(): Promise<string> {
    const saves = await listSaveSlots();
    return JSON.stringify(
      { exportedAt: new Date().toISOString(), version: 1, saves },
      null,
      2
    );
  }

  async importFromJson(json: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error('Invalid JSON — file may be corrupted.');
    }

    const payload = parsed as { version?: number; saves?: SaveSlotMeta[] };
    if (payload.version !== 1 || !Array.isArray(payload.saves)) {
      throw new Error('Unrecognised export format or version mismatch.');
    }

    for (const slot of payload.saves) {
      if (typeof slot.slotIndex !== 'number' || !(slot as any).state) continue;
      await writeSaveSlot(slot.slotIndex, slot.saveName, (slot as any).state);
    }
    console.log(`[SimulationService] Imported ${payload.saves.length} save slot(s)`);
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private applyGameState(raw: SerializedGameState): void {
    import('../store/gameStore').then(({ useGameStore }) => {
      useGameStore.getState().setGameState(toClientState(raw));
    });
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const simulationService = new SimulationService();
