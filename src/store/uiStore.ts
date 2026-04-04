import { create } from 'zustand'

export type NavTab = 'dashboard' | 'squad' | 'scouting'
export type ModalId = 'newGame' | 'saveGame' | 'loadGame' | 'exportJson' | 'importJson' | 'simSettings'
export type SimMode = 'to_fixture' | 'one_day' | 'matchweek'

export interface Toast {
  id: string
  message: string
  type: 'info' | 'success' | 'error'
}

interface UiState {
  navTab: NavTab
  setNavTab: (tab: NavTab) => void

  simMode: SimMode
  setSimMode: (mode: SimMode) => void

  inboxOpen: boolean
  setInboxOpen: (open: boolean) => void

  selectedPlayerId: string | null
  selectPlayer: (id: string | null) => void

  selectedClubId: string | null
  selectClub: (id: string | null) => void

  activeModal: ModalId | null
  openModal: (id: ModalId) => void
  closeModal: () => void

  toasts: Toast[]
  pushToast: (message: string, type?: Toast['type']) => void
  dismissToast: (id: string) => void
}

export const useUiStore = create<UiState>((set) => ({
  navTab: 'dashboard',
  setNavTab: (tab) => set({ navTab: tab }),

  simMode: 'to_fixture',
  setSimMode: (mode) => set({ simMode: mode }),

  inboxOpen: false,
  setInboxOpen: (open) => set({ inboxOpen: open }),

  selectedPlayerId: null,
  selectPlayer: (id) => set({ selectedPlayerId: id }),

  selectedClubId: null,
  selectClub: (id) => set({ selectedClubId: id }),

  activeModal: null,
  openModal: (id) => set({ activeModal: id }),
  closeModal: () => set({ activeModal: null }),

  toasts: [],
  pushToast: (message, type = 'info') =>
    set((s) => ({
      toasts: [...s.toasts, { id: crypto.randomUUID(), message, type }],
    })),
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
