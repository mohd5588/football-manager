/**
 * src/components/layout/InboxDrawer.tsx
 *
 * The right-side action drawer — "The Inbox".
 *
 * Two tabs:
 *   1. Tactical — one card per completed match. Shows score, clubs, scorers,
 *      xG bar, and any narrative lines the Worker generated.
 *      Works correctly even when narrativeSummary is empty.
 *
 *   2. Scouting — Phase 5 placeholder.
 *
 * State sources:
 *   - inboxStore  → items (MatchReport array), unread counts
 *   - gameStore   → clubs + players (needed to resolve names from IDs)
 *   - uiStore     → selectPlayer (write) when a player name is tapped
 */

import React, { useState } from 'react';
import {
  useInboxStore,
  selectInboxItems,
  selectUnreadCount,
  type InboxItem,
} from '../../store/inboxStore';
import { useGameStore, selectGameState } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import type { MatchEvent } from '../../types';

// ---------------------------------------------------------------------------
// Ticket categorisation (keyword heuristic — pure UI, no Worker involvement)
// ---------------------------------------------------------------------------

type TicketCategory =
  | 'defensive_shape'
  | 'attacking_system'
  | 'match_prep'
  | 'intelligence'
  | 'general';

interface TicketMeta {
  label: string;
  dot:   string; // Tailwind bg class
  tag:   string; // Tailwind bg + text classes
}

const CATEGORY_META: Record<TicketCategory, TicketMeta> = {
  defensive_shape:  { label: 'Defensive shape',  dot: 'bg-red-500',   tag: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400' },
  attacking_system: { label: 'Attacking system', dot: 'bg-green-500', tag: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' },
  match_prep:       { label: 'Match prep',       dot: 'bg-amber-500', tag: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400' },
  intelligence:     { label: 'Intelligence',     dot: 'bg-blue-500',  tag: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' },
  general:          { label: 'Briefing',         dot: 'bg-gray-400',  tag: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400' },
};

const CATEGORY_KEYWORDS: Array<[TicketCategory, string[]]> = [
  ['defensive_shape',  ['press', 'shape', 'transition', 'defensive', 'block', 'interception', 'relegation']],
  ['attacking_system', ['attack', 'goal', 'chance', 'xg', 'cross', 'assist', 'penalty box', 'in-box']],
  ['match_prep',       ['flank', 'channel', 'opponent', 'coverage', 'exposure', 'weak', 'threat']],
  ['intelligence',     ['intelligence', 'anticipation', 'space', 'positioning', 'percentile', 'z-score']],
];

function categorise(text: string): TicketCategory {
  const lower = text.toLowerCase();
  for (const [cat, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((kw) => lower.includes(kw))) return cat;
  }
  return 'general';
}

// ---------------------------------------------------------------------------
// Relative time helper
// ---------------------------------------------------------------------------

function relativeTime(iso: string): string {
  const diff  = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins < 1)   return 'Just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

// ---------------------------------------------------------------------------
// xG mini-bar
// ---------------------------------------------------------------------------
// A tiny two-tone bar showing home xG vs away xG at a glance.
// Total width is fixed; each side's fill is proportional to its share.

function XgBar({ homeXg, awayXg }: { homeXg: number; awayXg: number }) {
  const total = homeXg + awayXg;
  if (total === 0) return null;
  const homePct = Math.round((homeXg / total) * 100);
  const awayPct = 100 - homePct;

  return (
    <div className="flex items-center gap-1 mt-1.5">
      <span className="text-[9px] text-gray-400 w-6 text-right">{homeXg.toFixed(1)}</span>
      <div className="flex-1 flex rounded-full overflow-hidden h-1">
        <div className="bg-blue-400" style={{ width: `${homePct}%` }} />
        <div className="bg-orange-400 flex-1" style={{ width: `${awayPct}%` }} />
      </div>
      <span className="text-[9px] text-gray-400 w-6">{awayXg.toFixed(1)}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Goal event line  e.g.  "⚽ Liam Carr  34'  (NOR)"
// ---------------------------------------------------------------------------

function GoalLine({ event, playerName, clubShortName }: {
  event:          MatchEvent;
  playerName:     string;
  clubShortName:  string;
}) {
  const icon = event.type === 'penalty_saved' ? '🧤' : '⚽';
  return (
    <div className="flex items-baseline gap-1 text-[10px] text-gray-500 dark:text-gray-400 pl-1">
      <span>{icon}</span>
      <span className="flex-1 truncate">{playerName}</span>
      <span className="text-gray-400 dark:text-gray-600 flex-shrink-0">{event.minute}′</span>
      <span className="text-gray-400 dark:text-gray-600 flex-shrink-0">({clubShortName})</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tactical match report card
// ---------------------------------------------------------------------------

function TacticalTicket({ item }: { item: InboxItem }) {
  const gameState = useGameStore(selectGameState);
  const markRead  = useInboxStore((s) => s.markRead);
  const selectPlayer = useUiStore((s) => s.selectPlayer);

  const { report } = item;

  // Resolve club objects from the game state.
  // Falls back to abbreviated IDs if state hasn't loaded yet.
  const homeClub = gameState?.clubs[report.homeStats.clubId];
  const awayClub = gameState?.clubs[report.awayStats.clubId];

  const homeGoals = report.homeStats.goals;
  const awayGoals = report.awayStats.goals;
  const homeXg    = report.homeStats.xG ?? 0;
  const awayXg    = report.awayStats.xG ?? 0;

  // Collect goal events in chronological order.
  const goalEvents = [...report.events]
    .filter((e) => e.type === 'goal')
    .sort((a, b) => a.minute - b.minute);

  // Narrative lines from the worker (may be empty — that's fine).
  const lines = report.narrativeSummary ?? [];
  const [title, ...rest] = lines;
  const body = rest.join(' ');
  const category = lines.length > 0 ? categorise(title + ' ' + body) : 'general';
  const meta = CATEGORY_META[category];

  return (
    <div
      className={`w-full text-left rounded-lg border transition-colors
        ${item.isRead
          ? 'bg-gray-50 dark:bg-gray-800/50 border-gray-100 dark:border-gray-800'
          : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 shadow-[0_1px_3px_rgba(0,0,0,0.04)]'
        }`}
    >
      {/* ── Scoreboard ─────────────────────────────────────────────── */}
      <button
        onClick={() => markRead(report.fixtureId)}
        className="w-full px-3 pt-2.5 pb-1 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors rounded-t-lg"
      >
        <div className="flex items-center justify-between gap-2">
          {/* Home team */}
          <span className={`flex-1 text-left text-xs truncate
            ${homeGoals > awayGoals
              ? 'font-semibold text-gray-800 dark:text-gray-100'
              : 'text-gray-500 dark:text-gray-400'}`}>
            {homeClub?.shortName ?? homeClub?.name ?? '?'}
          </span>

          {/* Score */}
          <span className="flex-shrink-0 text-sm font-bold text-gray-800 dark:text-gray-100 tabular-nums">
            {homeGoals} – {awayGoals}
          </span>

          {/* Away team */}
          <span className={`flex-1 text-right text-xs truncate
            ${awayGoals > homeGoals
              ? 'font-semibold text-gray-800 dark:text-gray-100'
              : 'text-gray-500 dark:text-gray-400'}`}>
            {awayClub?.shortName ?? awayClub?.name ?? '?'}
          </span>
        </div>

        {/* xG bar */}
        <XgBar homeXg={homeXg} awayXg={awayXg} />
      </button>

      {/* ── Goal events ────────────────────────────────────────────── */}
      {goalEvents.length > 0 && (
        <div className="px-3 py-1.5 border-t border-gray-100 dark:border-gray-800 flex flex-col gap-0.5">
          {goalEvents.map((event, i) => {
            const player    = gameState?.players[event.playerId];
            const club      = gameState?.clubs[event.clubId];
            const shortName = player?.name?.split(' ').pop() ?? '—';
            return (
              <button
                key={i}
                onClick={() => player && selectPlayer(player.id)}
                className="w-full text-left hover:opacity-70 transition-opacity"
              >
                <GoalLine
                  event={event}
                  playerName={shortName}
                  clubShortName={club?.shortName ?? '?'}
                />
              </button>
            );
          })}
        </div>
      )}

      {/* ── Narrative summary (worker-generated text) ──────────────── */}
      {lines.length > 0 && (
        <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-800">
          <div className="flex items-start gap-2 mb-1">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1 ${meta.dot}`} />
            <span className={`flex-1 text-[11px] font-medium leading-snug
              ${item.isRead
                ? 'text-gray-500 dark:text-gray-400'
                : 'text-gray-700 dark:text-gray-300'}`}>
              {title}
            </span>
            {!item.isRead && (
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0 mt-1" />
            )}
          </div>
          {body && (
            <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-relaxed pl-3.5">
              {body}
            </p>
          )}
          <div className="flex items-center justify-between mt-1.5 pl-3.5">
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${meta.tag}`}>
              {meta.label}
            </span>
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              {relativeTime(item.receivedAt)}
            </span>
          </div>
        </div>
      )}

      {/* ── Timestamp when there's no narrative ────────────────────── */}
      {lines.length === 0 && (
        <div className="px-3 pb-2 pt-1 flex justify-end">
          <span className="text-[10px] text-gray-400 dark:text-gray-500">
            {relativeTime(item.receivedAt)}
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty / placeholder states
// ---------------------------------------------------------------------------

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 py-10 text-center px-4">
      <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-lg">
        ✓
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500">{message}</p>
    </div>
  );
}

function ScoutingPlaceholder() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 py-10 px-4 text-center">
      <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-sm">
        🔍
      </div>
      <p className="text-xs font-medium text-gray-600 dark:text-gray-400">Scouting unlocks in Phase 5</p>
      <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">
        Attribute ranges, statistical anomalies, and wonderkid alerts will appear here once scouting reports are generated.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type DrawerTab = 'tactical' | 'scouting';

export default function InboxDrawer() {
  const [activeTab, setActiveTab] = useState<DrawerTab>('tactical');

  const items       = useInboxStore(selectInboxItems);
  const unreadCount = useInboxStore(selectUnreadCount);
  const markAllRead = useInboxStore((s) => s.markAllRead);

  // Show ALL items that have a real fixture ID — no longer filtered by narrativeSummary
  // length, so score-only reports appear even if the worker writes no narrative text.
  const tacticalItems = items.filter((i) => !!i.report.fixtureId);

  return (
    <aside className="w-64 flex-shrink-0 flex flex-col bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 h-full">

      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
        <span className="text-sm">📋</span>
        <span className="text-xs font-medium text-gray-800 dark:text-gray-200">The Inbox</span>

        {unreadCount > 0 && (
          <>
            <span className="ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400">
              {unreadCount}
            </span>
            <button
              onClick={markAllRead}
              className="text-[10px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              All read
            </button>
          </>
        )}
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────── */}
      <div className="flex border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
        {(['tactical', 'scouting'] as DrawerTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 text-[11px] capitalize transition-colors border-b-2
              ${activeTab === tab
                ? 'font-medium text-gray-800 dark:text-gray-200 border-blue-500'
                : 'text-gray-400 dark:text-gray-500 border-transparent hover:text-gray-600 dark:hover:text-gray-300'
              }`}
          >
            {tab}
            {tab === 'tactical' && unreadCount > 0 && (
              <span className="ml-1 text-[9px] text-blue-500">•</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Body ─────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-2.5 flex flex-col gap-2">
        {activeTab === 'tactical' && (
          tacticalItems.length === 0
            ? <EmptyState message="No match reports yet — simulate a game to see results here" />
            : tacticalItems.map((item) => (
                <TacticalTicket key={item.report.fixtureId} item={item} />
              ))
        )}

        {activeTab === 'scouting' && <ScoutingPlaceholder />}
      </div>
    </aside>
  );
}
