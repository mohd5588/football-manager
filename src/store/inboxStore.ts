/**
 * src/store/inboxStore.ts
 *
 * UI-only store — never sent to the Worker, never stored in IndexedDB.
 *
 * Responsibilities:
 *   1. Accumulate MatchReport objects pushed by SimulationService after
 *      each game (MATCH_RESULT responses). These are the source for the
 *      Inbox "Tactical Insight Tickets".
 *   2. Track read/unread state entirely on the UI side, so SYNC_STATE
 *      resets never clobber it.
 *   3. Maintain an AttentionEvent queue — events that require the manager's
 *      decision before simulation can continue (transfer bids, injuries, etc).
 *      SimulationService pushes events here and halts the current sim job.
 *
 * Architecture note:
 *   This store is the "UI layer" counterpart to gameStore's "game mirror".
 *   Components read from both; SimulationService writes to both.
 *   The two stores are never merged — that separation is intentional.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { MatchReport } from '../types';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface InboxItem {
  readonly report:      MatchReport;
  readonly receivedAt:  string;   // ISO — wall-clock time the UI got the report
  isRead:               boolean;
}

/**
 * An event that halts an in-progress simulation and demands a decision.
 *
 * Phase 4 scaffolding: SimulationService will push these when it detects
 * conditions that need human input (transfer bids, expiring contracts, etc).
 * The SimulateControl renders the top-of-queue event as the "paused" banner.
 */
export type AttentionEventType =
  | 'transfer_offer'
  | 'injury_update'
  | 'contract_expiry'
  | 'board_message'
  | 'youth_intake';

export interface AttentionEvent {
  readonly id:              string;
  readonly type:            AttentionEventType;
  readonly title:           string;
  readonly body:            string;
  /** Label for the primary CTA — e.g. "Review offer" */
  readonly primaryAction:   string;
  /** Label for the dismiss CTA — e.g. "Reject & continue" */
  readonly secondaryAction: string;
  /**
   * If set, clicking primaryAction navigates to this tab.
   * The SimulateControl passes this to uiStore.setActiveTab().
   */
  readonly primaryTab?:     import('./uiStore').NavTab;
}

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

interface InboxStoreState {
  items:          InboxItem[];
  attentionQueue: AttentionEvent[];
}

interface InboxStoreActions {
  /** Called by SimulationService on every MATCH_RESULT response. */
  pushReport:       (report: MatchReport) => void;
  markRead:         (fixtureId: string) => void;
  markAllRead:      () => void;
  /** Called by SimulationService when an event requires user action. */
  pushAttention:    (event: AttentionEvent) => void;
  /** Removes the head of the attention queue (decision taken). */
  resolveAttention: (id: string) => void;
  /** Hard reset — called alongside gameStore.resetGame() on menu return. */
  clearAll:         () => void;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const INITIAL: InboxStoreState = {
  items:          [],
  attentionQueue: [],
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useInboxStore = create<InboxStoreState & InboxStoreActions>()(
  devtools(
    (set) => ({
      ...INITIAL,

      pushReport: (report) =>
        set(
          (state) => ({
            items: [
              { report, receivedAt: new Date().toISOString(), isRead: false },
              ...state.items,
            ],
          }),
          false,
          'pushReport'
        ),

      markRead: (fixtureId) =>
        set(
          (state) => ({
            items: state.items.map((item) =>
              item.report.fixtureId === fixtureId
                ? { ...item, isRead: true }
                : item
            ),
          }),
          false,
          'markRead'
        ),

      markAllRead: () =>
        set(
          (state) => ({
            items: state.items.map((item) => ({ ...item, isRead: true })),
          }),
          false,
          'markAllRead'
        ),

      pushAttention: (event) =>
        set(
          (state) => ({
            attentionQueue: [...state.attentionQueue, event],
          }),
          false,
          'pushAttention'
        ),

      resolveAttention: (id) =>
        set(
          (state) => ({
            attentionQueue: state.attentionQueue.filter((e) => e.id !== id),
          }),
          false,
          'resolveAttention'
        ),

      clearAll: () => set(INITIAL, false, 'clearAll'),
    }),
    { name: 'FootballManager/InboxStore' }
  )
);

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const selectInboxItems      = (s: InboxStoreState) => s.items;
export const selectUnreadCount     = (s: InboxStoreState) =>
  s.items.filter((i) => !i.isRead).length;
export const selectAttentionQueue  = (s: InboxStoreState) => s.attentionQueue;
export const selectCurrentAttention = (s: InboxStoreState) =>
  s.attentionQueue[0] ?? null;
