/**
 * src/services/SimulationService.ts
 *
 * The sole bridge between UI components and the Web Worker.
 * Components call methods on this service — they never touch postMessage.
 *
 * Phase 6 additions:
 *   ✅ makeTransferOffer  — manager buys a player from an AI club
 *   ✅ acceptBid          — manager sells a player to an AI club
 *   ✅ rejectBid          — manager declines a bid, clears it from state
 *   ✅ Bid detection      — after every SYNC_STATE, check for new incoming
 *                          bids and push an AttentionEvent so simulation pauses
 */

import workerBridge from './workerBridge';
import {
  type SerializedGameState,
  type ClientGameState,
  type WorkerResponse,
  type SaveSlotMeta,
  type WorldGenConfig,
  isSyncStateResponse,
  isMatchResultResponse,
  isSaveExportResponse,
  isProgressReportResponse,
} from '../types';
import {
  writeSaveSlot,
  readSaveSlot,
  listSaveSlots,
  deleteSaveSlot,
} from '../db/database';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The worker sends state as `response.state`.
 * types.ts declares it as `response.payload`.
 * This function handles both so nothing breaks either way.
 */
function extractState(response: WorkerResponse): SerializedGameState | null {
  const r   = response as Record<string, unknown>;
  const raw = (r.state ?? r.payload) as SerializedGameState | undefined;
  return raw ?? null;
}

/**
 * Convert the raw SerializedGameState (arrives from the worker) into
 * the ClientGameState shape that Zustand and the UI components use.
 */
function toClientState(raw: SerializedGameState): ClientGameState {
  const playerClub =
    raw.clubs[raw.playerClubId] ??
    Object.values(raw.clubs)[0] ??
    null;

  const nextFixture = playerClub
    ? Object.values(raw.fixtures)
        .filter(
          (f) =>
            f.status === 'scheduled' &&
            (f.homeClubId === playerClub.id || f.awayClubId === playerClub.id)
        )
        .sort((a, b) => (a.date < b.date ? -1 : 1))[0] ?? null
    : null;

  const playerStandingsRow = playerClub
    ? (raw.standings[playerClub.currentTier] ?? []).find(
        (row) => row.clubId === playerClub.id
      ) ?? null
    : null;

  return {
    ...raw,
    pendingBids:        raw.pendingBids ?? [],
    playerClub:         playerClub!,
    nextFixture,
    playerStandingsRow,
    isSimulating:       false,
    simulationProgress: 0,
  };
}

// ---------------------------------------------------------------------------
// SimulationService class
// ---------------------------------------------------------------------------

class SimulationService {
  private currentJobId: string | null = null;

  /**
   * Tracks bid IDs we've already raised as AttentionEvents.
   * Prevents the same bid triggering the inbox banner on every SYNC_STATE.
   * Reset when a new game is started or loaded.
   */
  private processedBidIds = new Set<string>();

  constructor() {
    // ── Single unified worker-message handler ──────────────────────────
    //
    // IMPORTANT: register onSyncState ONCE only. Two registrations silently
    // replace each other and break the Zustand update path.
    workerBridge.onSyncState((response: WorkerResponse) => {

      // ── SYNC_STATE: push new world state into Zustand ──────────────
      if (isSyncStateResponse(response)) {
        const raw = extractState(response);
        if (raw) {
          this.checkForNewBids(raw);
          this.applyGameState(raw);
        }
      }

      // ── MATCH_RESULT: route report to the inbox ─────────────────────
      if (isMatchResultResponse(response)) {
        const r      = response as Record<string, unknown>;
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

  // ─── Bid detection ──────────────────────────────────────────────────────

  /**
   * After every SYNC_STATE, scan pendingBids for new entries that target
   * one of the manager's players. For each new bid, push an AttentionEvent
   * so the simulation pauses and the manager is prompted to review the offer.
   */
  private checkForNewBids(state: SerializedGameState): void {
    const pendingBids = state.pendingBids ?? [];
    for (const bid of pendingBids) {
      // Skip bids we've already shown
      if (this.processedBidIds.has(bid.id)) continue;

      // Only react to bids targeting the manager's squad
      const player = state.players[bid.playerId];
      if (!player || player.clubId !== state.playerClubId) continue;

      this.processedBidIds.add(bid.id);

      const fromClub = state.clubs[bid.fromClubId];
      const fee = bid.fee >= 1_000_000
        ? `£${(bid.fee / 1_000_000).toFixed(1)}m`
        : `£${Math.round(bid.fee / 1_000)}k`;

      import('../store/inboxStore').then(({ useInboxStore }) => {
        useInboxStore.getState().pushAttention({
          id:              bid.id,
          type:            'transfer_offer',
          title:           'Transfer Bid Received',
          body:            `${fromClub?.name ?? 'A club'} have offered ${fee} for ${player.name}.`,
          primaryAction:   'Review offer',
          secondaryAction: 'Reject & continue',
          primaryTab:      'transfers',
        });
      });
    }
  }

  // ─── League initialisation ─────────────────────────────────────────────

  async initLeague(config: WorldGenConfig): Promise<void> {
    const { useGameStore } = await import('../store/gameStore');
    useGameStore.getState().setSimulating(true);
    this.processedBidIds.clear(); // fresh game = fresh bid history

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
            const r   = progressResponse as Record<string, unknown>;
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
    }).catch(() => {});
    this.currentJobId = null;
  }

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

    const r        = response as Record<string, unknown>;
    const snapshot =
      ((r.payload as Record<string, unknown>)?.snapshot ??
       r.snapshot) as SerializedGameState;

    await writeSaveSlot(slotIndex, slotName, snapshot);
    console.log(`[SimulationService] Game saved to slot ${slotIndex} ("${slotName}")`);
  }

  async loadGame(slotIndex: number): Promise<void> {
    const { useGameStore } = await import('../store/gameStore');
    useGameStore.getState().setSimulating(true);
    this.processedBidIds.clear(); // loaded save = fresh bid detection history

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

  // ─── Transfer Market ────────────────────────────────────────────────────

  /**
   * Manager buys a player from an AI club.
   * The worker handles: deducting the fee, moving the player, recalculating wages.
   */
  async makeTransferOffer(playerId: string, fee: number, weeklyWage: number): Promise<void> {
    const { useGameStore } = await import('../store/gameStore');
    useGameStore.getState().setSimulating(true);

    try {
      await workerBridge.send({
        type:    'MAKE_TRANSFER_OFFER',
        payload: { playerId, fee, weeklyWage },
      });

      import('../store/uiStore').then(({ useUiStore }) => {
        useUiStore.getState().pushToast('Transfer completed!', 'success');
      });
    } catch (err) {
      import('../store/uiStore').then(({ useUiStore }) => {
        useUiStore.getState().pushToast(
          err instanceof Error ? err.message : 'Transfer failed.',
          'error'
        );
      });
      throw err;
    } finally {
      useGameStore.getState().setSimulating(false);
    }
  }

  /**
   * Manager accepts an AI club's bid for one of their players.
   * The worker handles: crediting the fee, moving the player, recalculating wages.
   * The bid is also removed from processedBidIds so it won't re-trigger.
   */
  async acceptBid(bidId: string): Promise<void> {
    const { useGameStore } = await import('../store/gameStore');
    useGameStore.getState().setSimulating(true);
    this.processedBidIds.delete(bidId); // allow the bid to be cleaned up cleanly

    try {
      await workerBridge.send({
        type:    'ACCEPT_BID',
        payload: { bidId },
      });

      import('../store/uiStore').then(({ useUiStore }) => {
        useUiStore.getState().pushToast('Player sold!', 'success');
      });
    } catch (err) {
      import('../store/uiStore').then(({ useUiStore }) => {
        useUiStore.getState().pushToast(
          err instanceof Error ? err.message : 'Could not complete sale.',
          'error'
        );
      });
      throw err;
    } finally {
      useGameStore.getState().setSimulating(false);
    }
  }

  /**
   * Manager rejects an AI bid — removes it from state and dismisses
   * any attention event associated with it.
   */
  async rejectBid(bidId: string): Promise<void> {
    const { useGameStore } = await import('../store/gameStore');
    useGameStore.getState().setSimulating(true);
    this.processedBidIds.delete(bidId);

    try {
      await workerBridge.send({
        type:    'REJECT_BID',
        payload: { bidId },
      });

      // Also clear the attention event if it's still in the queue
      import('../store/inboxStore').then(({ useInboxStore }) => {
        useInboxStore.getState().resolveAttention(bidId);
      });
    } finally {
      useGameStore.getState().setSimulating(false);
    }
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
