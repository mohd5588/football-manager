/**
 * src/store/uiStore.ts
 *
 * Pure UI state — nothing here is derived from simulation data.
 * This store manages:
 *   - Which modal/panel is currently open
 *   - Active navigation tab
 *   - Selected player / club IDs for detail drawers
 *   - Any ephemeral UI messages (toast queue)
 *
 * Components ARE allowed to write to this store directly (via hooks) because
 * all of this state is genuinely owned by the UI layer.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

// ---------------------------------------------------------------------------
// Modal / panel registry
// ---------------------------------------------------------------------------

export type ModalId =
  | 'newGame'
  | 'saveGame'
  | 'loadGame'
  | 'exportJson'
  | 'importJson'
  | 'settings'
  | 'playerProfile'
  | 'clubProfile'
  | null;

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export type NavTab =
  | 'dashboard'
  | 'standings'
  | 'squad'
  | 'tactics'
  | 'transfers'
  | 'scouting'
  | 'finances'
  | 'inbox';

// ---------------------------------------------------------------------------
// Toast notifications
// ---------------------------------------------------------------------------

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  /** Auto-dismiss after this many ms.  0 = persistent until dismissed. */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

interface UiStoreState {
  /** Which top-level navigation tab is visible. */
  activeTab: NavTab;

  /** The modal currently rendered on screen (null = none). */
  openModal: ModalId;

  /** Player ID shown in the slide-in profile drawer. */
  selectedPlayerId: string | null;

  /** Club ID shown in the club detail blade. */
  selectedClubId: string | null;

  /** Active save slot index used by the save/load modal. */
  activeSaveSlotIndex: number;

  /** Pending toast notifications. */
  toasts: Toast[];
}

interface UiStoreActions {
  setActiveTab: (tab: NavTab) => void;
  openModal: (id: ModalId) => void;
  closeModal: () => void;
  selectPlayer: (playerId: string | null) => void;
  selectClub: (clubId: string | null) => void;
  setActiveSaveSlot: (index: number) => void;
  pushToast: (message: string, variant?: ToastVariant, durationMs?: number) => void;
  dismissToast: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const INITIAL_STATE: UiStoreState = {
  activeTab: 'dashboard',
  openModal: null,
  selectedPlayerId: null,
  selectedClubId: null,
  activeSaveSlotIndex: 0,
  toasts: [],
};

// ---------------------------------------------------------------------------
// Store creation
// ---------------------------------------------------------------------------

let toastCounter = 0;

export const useUiStore = create<UiStoreState & UiStoreActions>()(
  devtools(
    (set) => ({
      ...INITIAL_STATE,

      setActiveTab: (tab) =>
        set({ activeTab: tab }, false, 'setActiveTab'),

      openModal: (id) =>
        set({ openModal: id }, false, 'openModal'),

      closeModal: () =>
        set({ openModal: null }, false, 'closeModal'),

      selectPlayer: (playerId) =>
        set({ selectedPlayerId: playerId }, false, 'selectPlayer'),

      selectClub: (clubId) =>
        set({ selectedClubId: clubId }, false, 'selectClub'),

      setActiveSaveSlot: (index) =>
        set({ activeSaveSlotIndex: index }, false, 'setActiveSaveSlot'),

      pushToast: (message, variant = 'info', durationMs = 3000) => {
        const id = `toast_${++toastCounter}`;
        set(
          (state) => ({ toasts: [...state.toasts, { id, message, variant, durationMs }] }),
          false,
          'pushToast'
        );

        // Auto-dismiss
        if (durationMs > 0) {
          setTimeout(() => {
            set(
              (state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }),
              false,
              'dismissToast/auto'
            );
          }, durationMs);
        }
      },

      dismissToast: (id) =>
        set(
          (state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }),
          false,
          'dismissToast'
        ),
    }),
    { name: 'FootballManager/UiStore' }
  )
);

// ---------------------------------------------------------------------------
// Selector helpers
// ---------------------------------------------------------------------------

export const selectActiveTab = (s: UiStoreState) => s.activeTab;
export const selectOpenModal = (s: UiStoreState) => s.openModal;
export const selectSelectedPlayerId = (s: UiStoreState) => s.selectedPlayerId;
export const selectSelectedClubId = (s: UiStoreState) => s.selectedClubId;
export const selectToasts = (s: UiStoreState) => s.toasts;
