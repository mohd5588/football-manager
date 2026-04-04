import { useGameStore, selectGameState } from '../../store/gameStore'
import { useUiStore } from '../../store/uiStore'
import { useInboxStore } from '../../store/inboxStore'
import SimulateControl from '../dashboard/SimulateControl'

const NAV_ITEMS = [
  { id: 'dashboard'  as const, label: 'Dashboard',  icon: '⚽' },
  { id: 'squad'      as const, label: 'Squad',      icon: '👥' },
  { id: 'transfers'  as const, label: 'Transfers',  icon: '💸' },
  { id: 'scouting'   as const, label: 'Scouting',   icon: '🔭' },
] as const

const TIER_LABELS = ['EPL', 'Championship', 'League One', 'League Two']

function fmt(amount: number) {
  return `£${Math.abs(amount / 1_000_000).toFixed(1)}m`
}

export default function Sidebar() {
  const gameState = useGameStore(selectGameState)
  const { navTab, setNavTab, inboxOpen, setInboxOpen, openModal } = useUiStore()
  const unread = useInboxStore((s) => s.items.filter((i) => !i.read).length)

  const club     = gameState?.playerClub
  const season   = gameState?.season ?? '—'
  const tier     = club ? TIER_LABELS[(club.tier ?? 1) - 1] ?? '—' : '—'
  const balance  = club?.finances.balance        ?? 0
  const budget   = club?.finances.transferBudget ?? 0
  const wageBill = club?.finances.wageBill        ?? 0

  return (
    <aside className="w-56 shrink-0 bg-zinc-900 border-r border-zinc-800 flex flex-col h-full">

      {/* Club header */}
      <div className="px-4 pt-5 pb-3 border-b border-zinc-800">
        <p className="text-xs text-zinc-500 uppercase tracking-widest mb-1">{tier}</p>
        <p className="text-white font-bold text-sm leading-snug truncate">
          {club?.name ?? 'Loading…'}
        </p>
        <p className="text-xs text-zinc-400 mt-0.5">Season {season}</p>
      </div>

      {/* Finance strip */}
      <div className="px-4 py-2.5 border-b border-zinc-800 space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-zinc-500">Balance</span>
          <span className={balance >= 0 ? 'text-emerald-400 font-medium' : 'text-red-400 font-medium'}>
            {balance >= 0 ? '+' : '-'}{fmt(balance)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Transfer budget</span>
          <span className="text-white">{fmt(budget)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Wage bill</span>
          <span className="text-zinc-300">£{(wageBill / 1_000).toFixed(0)}k/wk</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 pt-3 space-y-0.5">
        {NAV_ITEMS.map(({ id, label, icon }) => (
          <button
            key={id}
            onClick={() => setNavTab(id)}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
              navTab === id
                ? 'bg-blue-600 text-white font-semibold'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
            }`}
          >
            <span className="text-base leading-none w-5 text-center">{icon}</span>
            <span className="flex-1">{label}</span>
          </button>
        ))}

        {/* Inbox toggle */}
        <button
          onClick={() => setInboxOpen(!inboxOpen)}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
            inboxOpen
              ? 'bg-zinc-700 text-white'
              : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
          }`}
        >
          <span className="text-base leading-none w-5 text-center">📬</span>
          <span className="flex-1">Inbox</span>
          {unread > 0 && (
            <span className="bg-red-500 text-white text-xs font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      </nav>

      {/* Simulate control */}
      <div className="border-t border-zinc-800">
        <SimulateControl />
      </div>

      {/* Footer */}
      <div className="flex gap-1 px-3 pb-3">
        <button
          onClick={() => openModal('saveGame')}
          className="flex-1 text-xs text-zinc-500 hover:text-white py-1.5 rounded hover:bg-zinc-800 transition-colors"
        >
          Save
        </button>
        <button
          onClick={() => openModal('loadGame')}
          className="flex-1 text-xs text-zinc-500 hover:text-white py-1.5 rounded hover:bg-zinc-800 transition-colors"
        >
          Load
        </button>
        <button
          onClick={() => openModal('exportJson')}
          className="flex-1 text-xs text-zinc-500 hover:text-white py-1.5 rounded hover:bg-zinc-800 transition-colors"
        >
          Export
        </button>
      </div>
    </aside>
  )
}
