/**
 * src/components/inbox/InboxView.tsx
 *
 * Full-screen inbox.
 *
 * Layout:
 *   Left  — Pending decisions (attention events)
 *   Right — Match reports, always single column, keyboard-navigable
 *
 * Keyboard navigation (↑ / ↓):
 *   - Moves the focused card up or down
 *   - Auto-scrolls the focused card into view
 *   - Auto-marks focused card as read
 *   - Only fires when no input/button is focused
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  useInboxStore,
  selectInboxItems,
  selectUnreadCount,
  selectAttentionQueue,
  type InboxItem,
  type AttentionEvent,
} from '../../store/inboxStore'
import { useGameStore, selectGameState } from '../../store/gameStore'
import { useUiStore } from '../../store/uiStore'
import { simulationService } from '../../services/SimulationService'
import type { NavTab } from '../../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(iso: string): string {
  const diff  = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (mins < 1)   return 'Just now'
  if (mins < 60)  return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days === 1) return 'Yesterday'
  return `${days}d ago`
}

// ---------------------------------------------------------------------------
// xG bar
// ---------------------------------------------------------------------------

function XgBar({ homeXg, awayXg }: { homeXg: number; awayXg: number }) {
  const total = homeXg + awayXg
  if (total === 0) return null
  const homePct = Math.round((homeXg / total) * 100)
  return (
    <div className="flex items-center gap-1.5 mt-2">
      <span className="text-[10px] text-zinc-500 w-7 text-right tabular-nums">{homeXg.toFixed(1)}</span>
      <div className="flex-1 flex rounded-full overflow-hidden h-1.5">
        <div className="bg-blue-500" style={{ width: `${homePct}%` }} />
        <div className="bg-orange-400" style={{ width: `${100 - homePct}%` }} />
      </div>
      <span className="text-[10px] text-zinc-500 w-7 tabular-nums">{awayXg.toFixed(1)}</span>
      <span className="text-[10px] text-zinc-600">xG</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Match report card
// ---------------------------------------------------------------------------

interface MatchCardProps {
  item:       InboxItem
  isSelected: boolean
  cardRef:    (el: HTMLDivElement | null) => void
}

function MatchCard({ item, isSelected, cardRef }: MatchCardProps) {
  const gameState    = useGameStore(selectGameState)
  const selectPlayer = useUiStore((s) => s.selectPlayer)

  const { report } = item
  const homeClub = gameState?.clubs[report.homeStats.clubId]
  const awayClub = gameState?.clubs[report.awayStats.clubId]

  const homeGoals = report.homeStats.goals
  const awayGoals = report.awayStats.goals
  const [, ...narrativeRest] = report.narrativeSummary ?? []
  const narrative = narrativeRest.join(' ')

  const goalEvents = [...report.events]
    .filter((e) => e.type === 'goal')
    .sort((a, b) => a.minute - b.minute)

  return (
    <div
      ref={cardRef}
      className={`rounded-xl border transition-all ${
        isSelected
          ? 'border-blue-500 ring-2 ring-blue-500/40 bg-zinc-900'
          : item.isRead
            ? 'bg-zinc-900/50 border-zinc-800'
            : 'bg-zinc-900 border-zinc-700 shadow-md'
      }`}
    >
      {/* Score header */}
      <div className="px-4 pt-4 pb-3">
        {/* Selected indicator */}
        {isSelected && (
          <div className="flex items-center gap-1.5 mb-2">
            <span className="w-1 h-1 rounded-full bg-blue-500" />
            <span className="text-[10px] text-blue-400 font-medium">Focused</span>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <span className={`flex-1 text-sm truncate ${
            homeGoals > awayGoals ? 'text-white font-semibold' : 'text-zinc-500'
          }`}>
            {homeClub?.name ?? '?'}
          </span>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={`text-xl font-bold tabular-nums ${
              homeGoals > awayGoals ? 'text-white' : 'text-zinc-400'
            }`}>{homeGoals}</span>
            <span className="text-zinc-600 text-sm">–</span>
            <span className={`text-xl font-bold tabular-nums ${
              awayGoals > homeGoals ? 'text-white' : 'text-zinc-400'
            }`}>{awayGoals}</span>
          </div>
          <span className={`flex-1 text-sm text-right truncate ${
            awayGoals > homeGoals ? 'text-white font-semibold' : 'text-zinc-500'
          }`}>
            {awayClub?.name ?? '?'}
          </span>
        </div>
        <XgBar homeXg={report.homeStats.xG} awayXg={report.awayStats.xG} />
      </div>

      {/* Goal scorers */}
      {goalEvents.length > 0 && (
        <div className="px-4 py-2 border-t border-zinc-800 flex flex-wrap gap-x-4 gap-y-0.5">
          {goalEvents.map((e, i) => {
            const player = gameState?.players[e.playerId]
            const club   = gameState?.clubs[e.clubId]
            return (
              <button
                key={i}
                onClick={() => player && selectPlayer(player.id)}
                className="text-[11px] text-zinc-400 hover:text-white transition-colors"
              >
                ⚽ {player?.name?.split(' ').pop() ?? '?'} {e.minute}′
                <span className="text-zinc-600 ml-0.5">({club?.shortName ?? '?'})</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Narrative + timestamp */}
      {(narrative || !item.isRead) && (
        <div className="px-4 py-2.5 border-t border-zinc-800 flex items-start justify-between gap-3">
          {narrative && (
            <p className="text-xs text-zinc-500 leading-relaxed flex-1">{narrative}</p>
          )}
          <div className="flex items-center gap-2 flex-shrink-0">
            {!item.isRead && (
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            )}
            <span className="text-[10px] text-zinc-600">{relativeTime(item.receivedAt)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Attention event card
// ---------------------------------------------------------------------------

function AttentionCard({ event }: { event: AttentionEvent }) {
  const setNavTab        = useUiStore((s) => s.setNavTab)
  const resolveAttention = useInboxStore((s) => s.resolveAttention)
  const [busy, setBusy]  = useState(false)

  const ICON: Record<string, string> = {
    transfer_offer:  '💰',
    youth_intake:    '🌱',
    injury_update:   '🏥',
    contract_expiry: '📄',
    board_message:   '📢',
  }
  const icon = ICON[event.type] ?? '📋'

  async function handlePrimary() {
    resolveAttention(event.id)
    if (event.type === 'transfer_offer') {
      setBusy(true)
      try { await simulationService.rejectBid(event.id) } catch {}
      setBusy(false)
    }
    if (event.primaryTab) setNavTab(event.primaryTab as NavTab)
  }

  function handleDismiss() {
    resolveAttention(event.id)
  }

  return (
    <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-4">
      <div className="flex items-start gap-3 mb-3">
        <span className="text-xl flex-shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-semibold leading-snug">{event.title}</p>
          <p className="text-zinc-400 text-xs mt-1 leading-relaxed">{event.body}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={handlePrimary}
          disabled={busy}
          className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white transition-colors"
        >
          {event.primaryAction}
        </button>
        <button
          onClick={handleDismiss}
          className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-zinc-700 hover:bg-zinc-600 text-white transition-colors"
        >
          {event.secondaryAction}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export default function InboxView() {
  const items          = useInboxStore(selectInboxItems)
  const unreadCount    = useInboxStore(selectUnreadCount)
  const attentionQueue = useInboxStore(selectAttentionQueue)
  const markAllRead    = useInboxStore((s) => s.markAllRead)
  const markRead       = useInboxStore((s) => s.markRead)

  const matchReports = items.filter((i) => !!i.report?.fixtureId)

  // ── Keyboard navigation state ─────────────────────────────────────────
  const [selectedIndex, setSelectedIndex] = useState(0)
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])

  // Clamp selectedIndex whenever the list length changes
  useEffect(() => {
    if (matchReports.length === 0) return
    setSelectedIndex((i) => Math.min(i, matchReports.length - 1))
  }, [matchReports.length])

  // Auto-mark as read + scroll into view whenever selection changes
  useEffect(() => {
    const item = matchReports[selectedIndex]
    if (!item) return
    if (!item.isRead) markRead(item.report.fixtureId)
    cardRefs.current[selectedIndex]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [selectedIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  // Arrow key handler — only active when inbox tab is open and no input focused
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (matchReports.length === 0) return
    const tag = (e.target as HTMLElement).tagName.toLowerCase()
    if (['input', 'textarea', 'select', 'button'].includes(tag)) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, matchReports.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
    }
  }, [matchReports.length])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <div className="p-6 max-w-5xl mx-auto">

      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Inbox</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            {unreadCount > 0
              ? `${unreadCount} unread message${unreadCount !== 1 ? 's' : ''}`
              : 'All caught up'}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            className="text-xs text-zinc-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-zinc-800"
          >
            Mark all read
          </button>
        )}
      </div>

      <div className="flex flex-col lg:flex-row gap-6">

        {/* ── Left column: Pending decisions ──────────────────────── */}
        <div className="lg:w-80 flex-shrink-0">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">
            Pending decisions
            {attentionQueue.length > 0 && (
              <span className="ml-2 bg-amber-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5">
                {attentionQueue.length}
              </span>
            )}
          </h2>

          {attentionQueue.length === 0 ? (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-8 text-center">
              <p className="text-3xl mb-2">✓</p>
              <p className="text-zinc-500 text-sm">No decisions needed</p>
              <p className="text-zinc-600 text-xs mt-1">
                Transfer bids and important events will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {attentionQueue.map((event) => (
                <AttentionCard key={event.id} event={event} />
              ))}
            </div>
          )}
        </div>

        {/* ── Right column: Match reports (always single column) ───── */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">
              Match reports
              {matchReports.length > 0 && (
                <span className="ml-2 text-zinc-600">{matchReports.length}</span>
              )}
            </h2>
            {matchReports.length > 1 && (
              <span className="text-[10px] text-zinc-600 flex items-center gap-1">
                <kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-500 font-mono">↑</kbd>
                <kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-500 font-mono">↓</kbd>
                to navigate
              </span>
            )}
          </div>

          {matchReports.length === 0 ? (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-12 text-center">
              <p className="text-3xl mb-2">📋</p>
              <p className="text-zinc-500 text-sm">No match reports yet</p>
              <p className="text-zinc-600 text-xs mt-1">
                Simulate a game to see results here. Reports appear after every
                match your club plays.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {matchReports.map((item, idx) => (
                <MatchCard
                  key={item.report.fixtureId}
                  item={item}
                  isSelected={idx === selectedIndex}
                  cardRef={(el) => { cardRefs.current[idx] = el }}
                />
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
