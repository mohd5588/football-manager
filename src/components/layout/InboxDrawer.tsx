/**
 * src/components/layout/InboxDrawer.tsx
 *
 * The right-side action drawer — "The Inbox".
 *
 * Two tabs:
 *   1. Tactical — MatchReport.narrativeSummary strings rendered as Ticket cards.
 *      Each narrative line is pre-authored by the Worker; the UI only categorises
 *      and formats it. Categorisation is a keyword heuristic (no Worker involvement).
 *
 *   2. Scouting — Phase 5 placeholder. The tab renders an empty state with a
 *      message. Phase 5 will add ScoutReport types and proper cards here.
 *
 * State sources:
 *   - inboxStore → items (MatchReport array), unread counts
 *   - uiStore    → selectPlayer (write) when a player name is tapped
 *
 * Architecture:
 *   Pure read + local UI state (activeTab). No service or worker calls.
 */

import React, { useState } from 'react';
import { useInboxStore, selectInboxItems, selectUnreadCount, type InboxItem } from '../../store/inboxStore';
import { useUiStore } from '../../store/uiStore';

// ---------------------------------------------------------------------------
// Ticket categorisation (heuristic — pure UI, no Worker involvement)
// ---------------------------------------------------------------------------

type TicketCategory =
  | 'defensive_shape'
  | 'attacking_system'
  | 'match_prep'
  | 'intelligence'
  | 'general';

interface TicketMeta {
  label:   string;
  dot:     string; // Tailwind bg class
  tag:     string; // Tailwind bg + text classes
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
// Relative time
// ---------------------------------------------------------------------------

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
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
// Sub-components
// ---------------------------------------------------------------------------

function TacticalTicket({ item }: { item: InboxItem }) {
  const markRead = useInboxStore((s) => s.markRead);

  // Each narrative string becomes one card; render all lines from the report
  const lines = item.report.narrativeSummary;
  if (lines.length === 0) return null;

  // Use the first line as the title, rest as body text
  const [title, ...rest] = lines;
  const body = rest.join(' ');
  const category = categorise(title + ' ' + body);
  const meta = CATEGORY_META[category];

  return (
    <button
      onClick={() => markRead(item.report.fixtureId)}
      className={`w-full text-left rounded-lg border transition-colors
        ${item.isRead
          ? 'bg-gray-50 dark:bg-gray-800/50 border-gray-100 dark:border-gray-800'
          : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 shadow-[0_1px_3px_rgba(0,0,0,0.04)]'
        }
        hover:bg-gray-50 dark:hover:bg-gray-800 p-2.5`}
    >
      {/* Header row */}
      <div className="flex items-start gap-2 mb-1.5">
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1 ${meta.dot}`} />
        <span className={`flex-1 text-xs font-medium leading-snug
          ${item.isRead
            ? 'text-gray-500 dark:text-gray-400'
            : 'text-gray-800 dark:text-gray-200'
          }`}>
          {title}
        </span>
        {!item.isRead && (
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0 mt-1" />
        )}
      </div>

      {/* Body */}
      {body && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed mb-2 pl-3.5">
          {body}
        </p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pl-3.5">
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${meta.tag}`}>
          {meta.label}
        </span>
        <span className="text-[10px] text-gray-400 dark:text-gray-500">
          {relativeTime(item.receivedAt)}
        </span>
      </div>
    </button>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 py-10 text-center">
      <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-300 dark:text-gray-600 text-lg">
        ✓
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500">{message}</p>
    </div>
  );
}

function ScoutingPlaceholder() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 py-10 px-4 text-center">
      <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-400 dark:text-gray-600 text-sm">
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

export function InboxDrawer() {
  const [activeTab, setActiveTab] = useState<DrawerTab>('tactical');

  const items       = useInboxStore(selectInboxItems);
  const unreadCount = useInboxStore(selectUnreadCount);
  const markAllRead = useInboxStore((s) => s.markAllRead);

  const tacticalItems = items.filter((i) => i.report.narrativeSummary.length > 0);

  return (
    <aside className="w-64 flex-shrink-0 flex flex-col bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 h-full">

      {/* Header */}
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

      {/* Tabs */}
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

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-2.5 flex flex-col gap-2">
        {activeTab === 'tactical' && (
          tacticalItems.length === 0
            ? <EmptyState message="No match reports yet — simulate a game to see tactical insights" />
            : tacticalItems.map((item) => (
                <TacticalTicket key={item.report.fixtureId} item={item} />
              ))
        )}

        {activeTab === 'scouting' && <ScoutingPlaceholder />}
      </div>
    </aside>
  );
}
