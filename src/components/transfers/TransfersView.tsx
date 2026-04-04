/**
 * src/components/transfers/TransfersView.tsx
 *
 * The Transfer Market. Two tabs:
 *
 *  "Available" — players from AI clubs whose ability is below their club's
 *                tier average, meaning the AI club will sell them. Manager
 *                can make an offer at the calculated asking price.
 *
 *  "Bids"      — incoming offers from AI clubs for the manager's players.
 *                Manager can accept (player leaves, fee arrives) or reject.
 *
 * State flow:
 *   - Reads directly from gameStore (no new store needed)
 *   - Actions go through SimulationService (never postMessage directly)
 */

import React, { useMemo, useState } from 'react'
import { useGameStore, selectGameState } from '../../store/gameStore'
import { useUiStore } from '../../store/uiStore'
import { simulationService } from '../../services/SimulationService'
import { TIER_CONFIG, Tier } from '../../types'
import type { Player, TransferBid } from '../../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtFee(amount: number): string {
  if (amount >= 1_000_000) return `£${(amount / 1_000_000).toFixed(1)}m`
  return `£${Math.round(amount / 1_000)}k`
}

function fmtWage(amount: number): string {
  return `£${Math.round(amount / 1_000)}k/wk`
}

/** Asking price formula from spec: ability * ageFactor * 100,000 */
function askingPrice(player: Player): number {
  const ageFactor = player.age <= 24 ? 1.5 : player.age <= 29 ? 1.0 : 0.6
  return Math.round(player.currentAbility * ageFactor * 100_000)
}

const POSITION_ORDER: Record<string, number> = {
  GK: 0, CB: 1, LB: 2, RB: 3, LWB: 4, RWB: 5,
  CDM: 6, CM: 7, CAM: 8, LM: 9, RM: 10,
  LW: 11, RW: 12, CF: 13, ST: 14,
}

const TIER_LABELS: Record<string, string> = {
  EPL: 'EPL', Championship: 'Championship', LeagueOne: 'Lg 1', LeagueTwo: 'Lg 2',
}

// ---------------------------------------------------------------------------
// OVR badge
// ---------------------------------------------------------------------------

function OvrBadge({ value }: { value: number }) {
  const colour =
    value >= 75 ? 'bg-emerald-600' :
    value >= 65 ? 'bg-blue-600'    :
    value >= 55 ? 'bg-amber-600'   :
                  'bg-zinc-600'
  return (
    <span className={`inline-block ${colour} text-white text-[11px] font-bold rounded px-1.5 py-0.5 tabular-nums`}>
      {value}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Available Players tab
// ---------------------------------------------------------------------------

interface OfferState {
  playerId: string
  fee: number
  wage: number
}

function AvailableTab() {
  const gameState   = useGameStore(selectGameState)
  const { selectPlayer } = useUiStore()
  const [offer, setOffer]         = useState<OfferState | null>(null)
  const [busy, setBusy]           = useState(false)
  const [filterPos, setFilterPos] = useState<string>('ALL')

  const { availablePlayers, budget } = useMemo(() => {
    if (!gameState) return { availablePlayers: [], budget: 0 }

    const { players, clubs, playerClubId } = gameState
    const budget = clubs[playerClubId]?.finances.transferBudget ?? 0

    const list = Object.values(players).filter(p => {
      if (p.clubId === playerClubId) return false           // not my own players
      if (p.status !== 'active') return false               // only active players
      const club = clubs[p.clubId]
      if (!club) return false
      const tierMean = TIER_CONFIG[club.currentTier as Tier]?.meanAttributeScore ?? 65
      return p.currentAbility < tierMean                    // below tier average = available
    })

    // Sort by ability descending
    list.sort((a, b) => b.currentAbility - a.currentAbility)

    return { availablePlayers: list, budget }
  }, [gameState])

  const positions = useMemo(() => {
    const pos = new Set(availablePlayers.map(p => p.position))
    return ['ALL', ...Array.from(pos).sort((a, b) => (POSITION_ORDER[a] ?? 99) - (POSITION_ORDER[b] ?? 99))]
  }, [availablePlayers])

  const visible = filterPos === 'ALL'
    ? availablePlayers
    : availablePlayers.filter(p => p.position === filterPos)

  async function handleConfirmOffer() {
    if (!offer || busy) return
    setBusy(true)
    try {
      await simulationService.makeTransferOffer(offer.playerId, offer.fee, offer.wage)
      setOffer(null)
    } catch (err) {
      // Error toast handled by SimulationService
    } finally {
      setBusy(false)
    }
  }

  if (!gameState) return <EmptyState icon="💸" message="No game loaded." />

  return (
    <div>
      {/* Budget banner */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-zinc-400">
          <span className="text-zinc-500">Transfer budget: </span>
          <span className="text-white font-semibold">{fmtFee(budget)}</span>
        </p>
        <p className="text-xs text-zinc-500">{visible.length} players available</p>
      </div>

      {/* Position filter pills */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {positions.map(pos => (
          <button
            key={pos}
            onClick={() => setFilterPos(pos)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
              filterPos === pos
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
            }`}
          >
            {pos}
          </button>
        ))}
      </div>

      {/* Confirm offer panel */}
      {offer && (() => {
        const player = gameState.players[offer.playerId]
        const club   = player ? gameState.clubs[player.clubId] : null
        if (!player) return null
        const canAfford = budget >= offer.fee
        return (
          <div className="mb-4 bg-blue-950/40 border border-blue-700/50 rounded-lg p-3">
            <p className="text-white text-sm font-semibold mb-1">Confirm offer for {player.name}</p>
            <p className="text-zinc-300 text-xs mb-2">
              {club?.name} · {player.position} · Age {player.age} · OVR {player.currentAbility}
            </p>
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-zinc-400 space-y-0.5">
                <div>Fee: <span className="text-white font-medium">{fmtFee(offer.fee)}</span></div>
                <div>Proposed wage: <span className="text-white font-medium">{fmtWage(offer.wage)}</span></div>
              </div>
              {!canAfford && (
                <p className="text-red-400 text-xs font-medium">Insufficient budget</p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleConfirmOffer}
                disabled={!canAfford || busy}
                className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
              >
                {busy ? 'Processing…' : 'Confirm'}
              </button>
              <button
                onClick={() => setOffer(null)}
                className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-zinc-700 hover:bg-zinc-600 text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )
      })()}

      {/* Player list */}
      {visible.length === 0 ? (
        <EmptyState icon="🔍" message="No available players in this position." />
      ) : (
        <div className="space-y-1">
          {visible.map(player => {
            const club     = gameState.clubs[player.clubId]
            const tierLabel = TIER_LABELS[club?.currentTier ?? ''] ?? '?'
            const fee      = askingPrice(player)
            const wage     = player.weeklyWage ?? player.currentAbility * 200
            const canAfford = budget >= fee

            return (
              <div
                key={player.id}
                className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 transition-colors"
              >
                {/* Player info */}
                <div className="flex-1 min-w-0">
                  <button
                    onClick={() => selectPlayer(player.id)}
                    className="text-white text-xs font-medium hover:text-blue-400 transition-colors truncate block text-left"
                  >
                    {player.name}
                  </button>
                  <p className="text-zinc-500 text-[11px] mt-0.5 truncate">
                    {club?.name ?? '?'} · <span className="text-zinc-400">{tierLabel}</span>
                  </p>
                </div>

                {/* Meta */}
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-zinc-400 text-[11px] font-medium w-8 text-center">{player.position}</span>
                  <span className="text-zinc-400 text-[11px] w-8 text-center">A{player.age}</span>
                  <OvrBadge value={player.currentAbility} />
                </div>

                {/* Fee + offer button */}
                <div className="shrink-0 text-right">
                  <p className={`text-[11px] font-semibold ${canAfford ? 'text-zinc-200' : 'text-red-400'}`}>
                    {fmtFee(fee)}
                  </p>
                  <button
                    onClick={() => setOffer({ playerId: player.id, fee, wage })}
                    disabled={!canAfford}
                    className="mt-0.5 text-[10px] px-2 py-0.5 rounded bg-blue-700 hover:bg-blue-600 disabled:opacity-30 disabled:cursor-not-allowed text-white transition-colors"
                  >
                    Offer
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bids Received tab
// ---------------------------------------------------------------------------

function BidsTab() {
  const gameState = useGameStore(selectGameState)
  const { selectPlayer } = useUiStore()
  const [busy, setBusy] = useState<string | null>(null) // bidId being processed

  const incomingBids = useMemo(() => {
    if (!gameState) return []
    return (gameState.pendingBids ?? []).filter(
      bid => gameState.players[bid.playerId]?.clubId === gameState.playerClubId
    )
  }, [gameState])

  async function handleAccept(bid: TransferBid) {
    if (busy) return
    setBusy(bid.id)
    try {
      await simulationService.acceptBid(bid.id)
    } finally {
      setBusy(null)
    }
  }

  async function handleReject(bid: TransferBid) {
    if (busy) return
    setBusy(bid.id)
    try {
      await simulationService.rejectBid(bid.id)
    } finally {
      setBusy(null)
    }
  }

  if (!gameState) return <EmptyState icon="💸" message="No game loaded." />
  if (incomingBids.length === 0) {
    return <EmptyState icon="📭" message="No bids received yet. Simulate more of the season to attract interest." />
  }

  return (
    <div className="space-y-3">
      {incomingBids.map(bid => {
        const player   = gameState.players[bid.playerId]
        const fromClub = gameState.clubs[bid.fromClubId]
        if (!player) return null
        const isProcessing = busy === bid.id

        return (
          <div key={bid.id} className="bg-zinc-800/60 border border-zinc-700/50 rounded-lg p-3">
            {/* Header */}
            <div className="flex items-start justify-between mb-2">
              <div>
                <button
                  onClick={() => selectPlayer(player.id)}
                  className="text-white text-sm font-semibold hover:text-blue-400 transition-colors"
                >
                  {player.name}
                </button>
                <p className="text-zinc-400 text-xs mt-0.5">
                  {player.position} · Age {player.age} · OVR {player.currentAbility}
                </p>
              </div>
              <OvrBadge value={player.currentAbility} />
            </div>

            {/* Offer details */}
            <div className="bg-zinc-900/60 rounded p-2 mb-3 space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-500">From</span>
                <span className="text-zinc-200 font-medium truncate ml-2">{fromClub?.name ?? 'Unknown'}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-500">Transfer fee</span>
                <span className="text-emerald-400 font-semibold">{fmtFee(bid.fee)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-500">Proposed wage</span>
                <span className="text-zinc-300">{fmtWage(bid.weeklyWage)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-500">Bid received</span>
                <span className="text-zinc-400">{bid.createdDate}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={() => handleAccept(bid)}
                disabled={!!busy}
                className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
              >
                {isProcessing ? 'Processing…' : `Accept ${fmtFee(bid.fee)}`}
              </button>
              <button
                onClick={() => handleReject(bid)}
                disabled={!!busy}
                className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
              >
                Reject
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty state helper
// ---------------------------------------------------------------------------

function EmptyState({ icon, message }: { icon: string; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <span className="text-4xl mb-3">{icon}</span>
      <p className="text-zinc-500 text-sm max-w-[200px]">{message}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type TransferTab = 'available' | 'bids'

export default function TransfersView() {
  const [activeTab, setActiveTab] = useState<TransferTab>('available')
  const gameState = useGameStore(selectGameState)

  const bidCount = (gameState?.pendingBids ?? []).filter(
    bid => gameState?.players[bid.playerId]?.clubId === gameState?.playerClubId
  ).length

  return (
    <div className="p-4 max-w-2xl mx-auto">
      {/* Page header */}
      <div className="mb-5">
        <h1 className="text-xl font-bold text-white">Transfer Market</h1>
        <p className="text-xs text-zinc-500 mt-0.5">
          Buy players from AI clubs, or respond to incoming bids.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-800 mb-5">
        <button
          onClick={() => setActiveTab('available')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'available'
              ? 'text-white border-blue-500'
              : 'text-zinc-500 border-transparent hover:text-zinc-300'
          }`}
        >
          Available Players
        </button>
        <button
          onClick={() => setActiveTab('bids')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors relative ${
            activeTab === 'bids'
              ? 'text-white border-blue-500'
              : 'text-zinc-500 border-transparent hover:text-zinc-300'
          }`}
        >
          Bids Received
          {bidCount > 0 && (
            <span className="ml-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5">
              {bidCount}
            </span>
          )}
        </button>
      </div>

      {/* Tab content */}
      {activeTab === 'available' && <AvailableTab />}
      {activeTab === 'bids'      && <BidsTab />}
    </div>
  )
}
