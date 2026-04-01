/**
 * src/components/layout/Sidebar.tsx
 *
 * Always-visible left navigation column.
 *
 * Sections (top → bottom):
 *   1. Club header  — crest initials, name, city, tier badge
 *   2. Season strip — date, phase chip, budget bar
 *   3. Nav items    — mapped from NavTab; unread badges from inboxStore
 *   4. SimulateControl — pinned to the bottom
 *
 * State sources:
 *   - gameStore → club, season, phase, budget
 *   - uiStore   → activeTab (read + write)
 *   - inboxStore → unread counts for nav badges
 *
 * Architecture: reads only. Never calls workerBridge or simulationService.
 */

import React from 'react';
import { useGameStore, selectManagerClub, selectGameState } from '../../store/gameStore';
import { useUiStore, selectActiveTab, type NavTab } from '../../store/uiStore';
import { useInboxStore, selectUnreadCount, selectCurrentAttention } from '../../store/inboxStore';
import { SimulateControl } from '../dashboard/SimulateControl';
import { TIER_CONFIG, Tier } from '../../types';

// ---------------------------------------------------------------------------
// Tier badge colours
// ---------------------------------------------------------------------------

const TIER_BADGE: Record<Tier, string> = {
  [Tier.EPL]:          'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
  [Tier.Championship]: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  [Tier.LeagueOne]:    'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300',
  [Tier.LeagueTwo]:    'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
};

const TIER_LABEL: Record<Tier, string> = {
  [Tier.EPL]:          'Premier League',
  [Tier.Championship]: 'Championship',
  [Tier.LeagueOne]:    'League One',
  [Tier.LeagueTwo]:    'League Two',
};

// ---------------------------------------------------------------------------
// Phase chip
// ---------------------------------------------------------------------------

type PhaseStyle = { label: string; className: string };

const PHASE_MAP: Record<string, PhaseStyle> = {
  pre_season:     { label: 'Pre-season',     className: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400' },
  regular_season: { label: 'Regular season', className: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' },
  playoffs:       { label: 'Playoffs',       className: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' },
  off_season:     { label: 'Off season',     className: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-500' },
};

// ---------------------------------------------------------------------------
// Nav definition
// ---------------------------------------------------------------------------

interface NavItem {
  tab:    NavTab;
  label:  string;
}

const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Overview',
    items: [
      { tab: 'dashboard', label: 'Dashboard' },
      { tab: 'standings', label: 'Standings' },
    ],
  },
  {
    title: 'Club',
    items: [
      { tab: 'squad',    label: 'Squad' },
      { tab: 'tactics',  label: 'Tactics' },
      { tab: 'finances', label: 'Finances' },
    ],
  },
  {
    title: 'Market',
    items: [
      { tab: 'transfers', label: 'Transfers' },
      { tab: 'scouting',  label: 'Scouting' },
    ],
  },
  {
    title: 'System',
    items: [
      { tab: 'inbox', label: 'Inbox' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ClubCrest({ shortName }: { shortName: string }) {
  return (
    <div className="w-9 h-9 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
      <span className="text-xs font-medium text-blue-700 dark:text-blue-300">
        {shortName.slice(0, 3).toUpperCase()}
      </span>
    </div>
  );
}

function BudgetBar({ budget, maxBudget }: { budget: number; maxBudget: number }) {
  const pct = Math.min(100, Math.max(0, (budget / maxBudget) * 100));
  const colour =
    pct > 50 ? 'bg-green-500' :
    pct > 20 ? 'bg-amber-500' :
    'bg-red-500';
  return (
    <div className="h-0.5 bg-gray-200 dark:bg-gray-700 rounded-full mt-1">
      <div
        className={`h-0.5 rounded-full transition-all ${colour}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function formatBudget(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `£${(n / 1_000_000).toFixed(1)}m`;
  if (Math.abs(n) >= 1_000)     return `£${Math.round(n / 1_000)}k`;
  return `£${n}`;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Sidebar() {
  const club         = useGameStore(selectManagerClub);
  const gameState    = useGameStore(selectGameState);
  const activeTab    = useUiStore(selectActiveTab);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const openModal    = useUiStore((s) => s.openModal);
  const unreadCount  = useInboxStore(selectUnreadCount);
  const hasAttention = useInboxStore(selectCurrentAttention);

  const phase   = gameState?.phase ?? 'pre_season';
  const phaseUI = PHASE_MAP[phase] ?? PHASE_MAP.pre_season;

  // Rough transfer budget ceiling for the bar — uses tier mean * 1000 as proxy.
  // Phase 6 (economy): replace with actual club.finances.transferBudget ceiling.
  const budgetCeiling = club
    ? TIER_CONFIG[club.currentTier].meanAttributeScore * 15_000
    : 1_000_000;

  return (
    <aside className="w-48 flex-shrink-0 flex flex-col bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 h-full">

      {/* ── Club header ── */}
      {club ? (
        <div className="p-3.5 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2.5 mb-2">
            <ClubCrest shortName={club.shortName} />
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate leading-tight">
                {club.name}
              </div>
              <div className="text-xs text-gray-400 dark:text-gray-500 truncate">
                {club.city}
              </div>
            </div>
          </div>
          <span className={`inline-block text-[10px] font-medium px-2 py-0.5 rounded ${TIER_BADGE[club.currentTier]}`}>
            {TIER_LABEL[club.currentTier]}
          </span>
        </div>
      ) : (
        <div className="p-3.5 border-b border-gray-100 dark:border-gray-800">
          <div className="h-9 w-9 rounded-lg bg-gray-100 dark:bg-gray-800 mb-2" />
          <div className="h-3 w-24 rounded bg-gray-100 dark:bg-gray-800" />
        </div>
      )}

      {/* ── Season context strip ── */}
      {gameState && club && (
        <div className="px-3.5 py-2.5 border-b border-gray-100 dark:border-gray-800 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider">Season</span>
            <span className="text-[11px] font-medium text-gray-700 dark:text-gray-300">
              {gameState.season}–{String(gameState.season + 1).slice(2)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider">Phase</span>
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${phaseUI.className}`}>
              {phaseUI.label}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider">Budget</span>
            <span className="text-[11px] font-medium text-gray-700 dark:text-gray-300">
              {formatBudget(club.finances.transferBudget)}
            </span>
          </div>
          <BudgetBar budget={club.finances.transferBudget} maxBudget={budgetCeiling} />
        </div>
      )}

      {/* ── Navigation ── */}
      <nav className="flex-1 overflow-y-auto py-1">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title}>
            <div className="px-3.5 pt-3 pb-1 text-[9px] font-medium text-gray-400 dark:text-gray-600 uppercase tracking-widest">
              {section.title}
            </div>
            {section.items.map(({ tab, label }) => {
              const isActive = activeTab === tab;
              const badge =
                tab === 'inbox'   ? unreadCount :
                tab === 'scouting' ? 0 : // Phase 5: scouting alert count
                0;

              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`
                    w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-xs transition-colors relative
                    ${isActive
                      ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-medium'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 hover:text-gray-700 dark:hover:text-gray-300'
                    }
                  `}
                >
                  {/* Active indicator bar */}
                  {isActive && (
                    <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-blue-500 rounded-r" />
                  )}

                  {/* Nav dot */}
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    isActive ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
                  }`} />

                  <span className="flex-1">{label}</span>

                  {badge > 0 && (
                    <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 flex-shrink-0">
                      {badge > 99 ? '99+' : badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* ── Simulate control (pinned bottom) ── */}
      <div className="p-3 border-t border-gray-100 dark:border-gray-800 space-y-1.5">
        <SimulateControl />
        <button
          onClick={() => openModal('saveGame')}
          className="w-full text-[10px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 py-1 transition-colors"
        >
          Save game
        </button>
      </div>
    </aside>
  );
}
