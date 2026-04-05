/**
 * src/services/SimulationService.ts
 *
 * The sole bridge between UI components and the Web Worker.
 * Components call methods on this service — they never touch postMessage.
 *
 * Phase 7 additions:
 *   ✅ checkForSponsorshipOffers — detects new pre-season sponsorship offers
 *      and fires an AttentionEvent so the simulation pauses for the manager.
 *   ✅ upgradeStadium        — sends UPGRADE_STADIUM to the worker
 *   ✅ acceptSponsorship     — sends ACCEPT_SPONSORSHIP, fires success toast
 *   ✅ rejectSponsorship     — sends REJECT_SPONSORSHIP
 *   ✅ loanInPlayer          — sends LOAN_IN_PLAYER, fires success toast
 *   ✅ loanOutPlayer         — sends LOAN_OUT_PLAYER, fires success toast
 */

import { workerBridge } from './workerBridge';
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

function extractState(response: WorkerResponse): SerializedGameState | null {
  const r   = response as Record<string, unknown>;
  const raw = (r.state ?? r.payload) as SerializedGameState | undefined;
  return raw ?? null;
}

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
    // Graceful defaults for fields missing on saves from earlier phases
    pendingBids:         raw.pendingBids        ?? [],
    managerReputation:   raw.managerReputation  ?? 50,
    sponsorshipOffers:   raw.sponsorshipOffers  ?? [],
    activeSponsorships:  raw.activeSponsorships ?? [],
    activeLoans:         raw.activeLoans        ?? [],
    playerClub:          playerClub!,
    nextFixture,
    playerStandingsRow,
    isSimulating:        false,
    simulationProgress:  0,
  };
}

// ---------------------------------------------------------------------------
// SimulationService class
// ---------------------------------------------------------------------------

class SimulationService {
  private currentJobId: string | null = null;

  /** Prevents duplicate AttentionEvents for the same bid. */
  private processedBidIds = new Set<string>();

  /**
   * Tracks the last season number we observed.
   * Used to detect season rollovers and fire youth-intake AttentionEvents.
   */
  private lastKnownSeason = 0;

  /**
   * Tracks sponsorship offer IDs we've already raised an AttentionEvent for.
   * Prevents the same offer triggering the inbox banner multiple times.
   */
  private processedSponsorshipOfferIds = new Set<string>();

  constructor() {
    workerBridge.onSyncState((response: WorkerResponse) => {

      if (isSyncStateResponse(response)) {
        const raw = extractState(response);
        if (raw) {
          this.checkForNewBids(raw);
          this.checkForSeasonRollover(raw);
          this.checkForSponsorshipOffers(raw);
          this.applyGameState(raw);
        }
      }

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

  // ─── Season rollover detection ──────────────────────────────────────────

  private checkForSeasonRollover(state: SerializedGameState): void {
    if (this.lastKnownSeason === 0) {
      this.lastKnownSeason = state.season;
      return;
    }

    if (state.season > this.lastKnownSeason) {
      this.lastKnownSeason = state.season;

      const academyPlayers = Object.values(state.players).filter(
        p => p.clubId === state.playerClubId && p.age <= 17
      );
      const count = academyPlayers.length;
      const label = count === 1 ? '1 new player' : `${count} new players`;

      import('../store/inboxStore').then(({ useInboxStore }) => {
        useInboxStore.getState().pushAttention({
          id:              `youth_intake_${state.season}`,
          type:            'youth_intake',
          title:           `Season ${state.season} — Pre-Season`,
          body:            `The youth academy has delivered ${label} to your squad. Head to the Squad tab and filter by Academy to see who came through.`,
          primaryAction:   'View squad',
          secondaryAction: 'Continue',
          primaryTab:      'squad',
        });
      });
    }
  }

  // ─── Sponsorship offer detection ────────────────────────────────────────

  /**
   * Called after every SYNC_STATE during pre_season.
   * Detects newly generated sponsorship offers and fires one AttentionEvent
   * covering all of them so the simulation pauses for the manager's decision.
   */
  private checkForSponsorshipOffers(state: SerializedGameState): void {
    if (state.phase !== 'pre_season') return;
    const offers = state.sponsorshipOffers ?? [];
    if (offers.length === 0) return;

    const newOffers = offers.filter(o => !this.processedSponsorshipOfferIds.has(o.id));
    if (newOffers.length === 0) return;

    for (const o of newOffers) {
      this.processedSponsorshipOfferIds.add(o.id);
    }

    import('../store/inboxStore').then(({ useInboxStore }) => {
      useInboxStore.getState().pushAttention({
        id:              `sponsorship_offers_${state.season}`,
        type:            'sponsorship_offer',
        title:           'New Sponsorship Offers',
        body:            `You have ${newOffers.length} new sponsorship offer${newOffers.length !== 1 ? 's' : ''} to review. Head to the Dashboard to see the deals available for season ${state.season}.`,
        primaryAction:   'Review offers',
        secondaryAction: 'Later',
        primaryTab:      'dashboard',
      });
    });
  }

  // ─── Bid detection ──────────────────────────────────────────────────────

  private checkForNewBids(state: SerializedGameState): void {
    const pendingBids = state.pendingBids ?? [];
    for (const bid of pendingBids) {
      if (this.processedBidIds.has(bid.id)) continue;

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
    this.processedBidIds.clear();
    this.processedSponsorshipOfferIds.clear();
    this.lastKnownSeason = 0;

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
    this.processedBidIds.clear();
    this.processedSponsorshipOfferIds.clear();
    this.lastKnownSeason = 0;

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

  async acceptBid(bidId: string): Promise<void> {
    const { useGameStore } = await import('../store/gameStore');
    useGameStore.getState().setSimulating(true);
    this.processedBidIds.delete(bidId);

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

  async rejectBid(bidId: string): Promise<void> {
    const { useGameStore } = await import('../store/gameStore');
    useGameStore.getState().setSimulating(true);
    this.processedBidIds.delete(bidId);

    try {
      await workerBridge.send({
        type:    'REJECT_BID',
        payload: { bidId },
      });

      import('../store/inboxStore').then(({ useInboxStore }) => {
        useInboxStore.getState().resolveAttention(bidId);
      });
    } finally {
      useGameStore.getState().setSimulating(false);
    }
  }

  // ─── Phase 7: Stadium Upgrades ──────────────────────────────────────────

  async upgradeStadium(capacityIncrease: number): Promise<void> {
    const { useGameStore } = await import('../store/gameStore');
    useGameStore.getState().setSimulating(true);

    try {
      await workerBridge.send({
        type:    'UPGRADE_STADIUM',
        payload: { capacityIncrease },
      });

      import('../store/uiStore').then(({ useUiStore }) => {
        useUiStore.getState().pushToast(
          `Stadium expanded by ${capacityIncrease.toLocaleString()} seats!`,
          'success'
        );
      });
    } catch (err) {
      import('../store/uiStore').then(({ useUiStore }) => {
        useUiStore.getState().pushToast(
          err instanceof Error ? err.message : 'Upgrade failed.',
          'error'
        );
      });
      throw err;
    } finally {
      useGameStore.getState().setSimulating(false);
    }
  }

  // ─── Phase 7: Sponsorships ──────────────────────────────────────────────

  async acceptSponsorship(offerId: string): Promise<void> {
    const { useGameStore } = await import('../store/gameStore');
    useGameStore.getState().setSimulating(true);
    this.processedSponsorshipOfferIds.delete(offerId); // allow re-display if re-generated

    try {
      await workerBridge.send({
        type:    'ACCEPT_SPONSORSHIP',
        payload: { offerId },
      });

      import('../store/uiStore').then(({ useUiStore }) => {
        useUiStore.getState().pushToast('Sponsorship deal signed!', 'success');
      });
    } catch (err) {
      import('../store/uiStore').then(({ useUiStore }) => {
        useUiStore.getState().pushToast(
          err instanceof Error ? err.message : 'Could not accept sponsorship.',
          'error'
        );
      });
      throw err;
    } finally {
      useGameStore.getState().setSimulating(false);
    }
  }

  async rejectSponsorship(offerId: string): Promise<void> {
    const { useGameStore } = await import('../store/gameStore');
    useGameStore.getState().setSimulating(true);

    try {
      await workerBridge.send({
        type:    'REJECT_SPONSORSHIP',
        payload: { offerId },
      });
    } finally {
      useGameStore.getState().setSimulating(false);
    }
  }

  // ─── Phase 7: Loan Market ───────────────────────────────────────────────

  async loanInPlayer(playerId: string, weeklyWageContribution: number): Promise<void> {
    const { useGameStore } = await import('../store/gameStore');
    useGameStore.getState().setSimulating(true);

    try {
      await workerBridge.send({
        type:    'LOAN_IN_PLAYER',
        payload: { playerId, weeklyWageContribution },
      });

      import('../store/uiStore').then(({ useUiStore }) => {
        useUiStore.getState().pushToast('Player joined on loan!', 'success');
      });
    } catch (err) {
      import('../store/uiStore').then(({ useUiStore }) => {
        useUiStore.getState().pushToast(
          err instanceof Error ? err.message : 'Loan failed.',
          'error'
        );
      });
      throw err;
    } finally {
      useGameStore.getState().setSimulating(false);
    }
  }

  async loanOutPlayer(playerId: string, toClubId: string, weeklyWageContribution: number): Promise<void> {
    const { useGameStore } = await import('../store/gameStore');
    useGameStore.getState().setSimulating(true);

    try {
      await workerBridge.send({
        type:    'LOAN_OUT_PLAYER',
        payload: { playerId, toClubId, weeklyWageContribution },
      });

      import('../store/uiStore').then(({ useUiStore }) => {
        useUiStore.getState().pushToast('Player loaned out successfully!', 'success');
      });
    } catch (err) {
      import('../store/uiStore').then(({ useUiStore }) => {
        useUiStore.getState().pushToast(
          err instanceof Error ? err.message : 'Loan out failed.',
          'error'
        );
      });
      throw err;
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
