import React from 'react'
import { useUiStore } from '../../store/uiStore'
import Sidebar from './Sidebar'
import InboxDrawer from './InboxDrawer'
import Dashboard from '../dashboard/Dashboard'
import SquadView from '../squad/SquadView'
import ScoutingView from '../scouting/ScoutingView'
import TransfersView from '../transfers/TransfersView'
import PlayerBlade from '../player/PlayerBlade'

export default function AppShell() {
  const {
    navTab,
    inboxOpen,
    selectedPlayerId, selectPlayer,
    activeModal, closeModal,
    openModal,
  } = useUiStore()

  return (
    <div className="flex h-screen bg-zinc-950 text-white overflow-hidden">

      {/* Sidebar */}
      <Sidebar />

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-y-auto">
        {navTab === 'dashboard' && <Dashboard />}
        {navTab === 'squad'     && <SquadView />}
        {navTab === 'scouting'  && <ScoutingView />}
        {navTab === 'transfers' && <TransfersView />}
      </main>

      {/* Inbox drawer (right panel) */}
      {inboxOpen && <InboxDrawer />}

      {/* Player blade overlay */}
      {selectedPlayerId && (
        <PlayerBlade
          playerId={selectedPlayerId}
          onClose={() => selectPlayer(null)}
        />
      )}

      {/* Modals */}
      {activeModal === 'saveGame' && (
        <ModalShell title="Save Game" onClose={closeModal}>
          <p className="text-zinc-400 text-sm">Save slot UI coming soon.</p>
        </ModalShell>
      )}
      {activeModal === 'loadGame' && (
        <ModalShell title="Load Game" onClose={closeModal}>
          <p className="text-zinc-400 text-sm">Load slot UI coming soon.</p>
        </ModalShell>
      )}
      {activeModal === 'exportJson' && (
        <ModalShell title="Export Save" onClose={closeModal}>
          <p className="text-zinc-400 text-sm">JSON export coming soon.</p>
        </ModalShell>
      )}
      {activeModal === 'importJson' && (
        <ModalShell title="Import Save" onClose={closeModal}>
          <p className="text-zinc-400 text-sm">JSON import coming soon.</p>
        </ModalShell>
      )}
      {activeModal === 'simSettings' && (
        <ModalShell title="Simulation Settings" onClose={closeModal}>
          <p className="text-zinc-400 text-sm">Sim settings coming soon.</p>
        </ModalShell>
      )}
    </div>
  )
}

interface ModalShellProps {
  title: string
  onClose: () => void
  children: React.ReactNode
}

function ModalShell({ title, onClose, children }: ModalShellProps) {
  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-zinc-800 rounded-xl p-6 w-full max-w-sm shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-semibold text-lg">{title}</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white text-2xl leading-none">×</button>
        </div>
        {children}
        <button
          onClick={onClose}
          className="mt-5 w-full bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg py-2 text-sm transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  )
}
