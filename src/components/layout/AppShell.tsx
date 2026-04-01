/**
 * src/components/layout/AppShell.tsx
 *
 * The three-zone application shell. Rendered once at the app root when a
 * game is active (the main menu / new-game flow lives outside this component).
 *
 * Zone layout:
 *   ┌─────────┬─────────────────────────┬──────────┐
 *   │ Sidebar │   Main content area     │  Inbox   │
 *   │ (196px) │   (flex-1)              │ Drawer   │
 *   │         │                         │  (256px) │
 *   │         │   [PlayerBlade overlay] │          │
 *   └─────────┴─────────────────────────┴──────────┘
 *
 * PlayerBlade (Option A):
 *   - Overlays only the main content area — Sidebar remains fully interactive
 *   - Implemented via `position: absolute` within the main zone
 *   - A semi-transparent scrim sits behind the blade but inside the main zone
 *
 * Tab routing:
 *   - Each NavTab maps to a content component
 *   - Unbuilt tabs render a <ComingSoon> placeholder rather than crashing
 *   - All components are lazy-loaded to keep the initial bundle small
 *
 * Architecture:
 *   - Reads uiStore.activeTab to switch content
 *   - Reads uiStore.selectedPlayerId to conditionally mount PlayerBlade
 *   - Never talks to gameStore or simulationService directly
 */

import React, { lazy, Suspense } from 'react';
import { useUiStore, selectActiveTab, selectSelectedPlayerId, type NavTab } from '../../store/uiStore';
import { Sidebar } from './Sidebar';
import { InboxDrawer } from './InboxDrawer';
import { PlayerBlade } from '../player/PlayerBlade';

// ---------------------------------------------------------------------------
// Lazy tab views
// ---------------------------------------------------------------------------

const Dashboard = lazy(() =>
  import('../dashboard/Dashboard').then((m) => ({ default: m.Dashboard }))
);

// Phase 5+ stubs — replace with real components as they are built
const StandingsView = lazy(() => Promise.resolve({ default: () => <ComingSoon tab="standings" /> }));
const SquadView     = lazy(() => Promise.resolve({ default: () => <ComingSoon tab="squad" /> }));
const TacticsView   = lazy(() => Promise.resolve({ default: () => <ComingSoon tab="tactics" /> }));
const FinancesView  = lazy(() => Promise.resolve({ default: () => <ComingSoon tab="finances" /> }));
const TransfersView = lazy(() => Promise.resolve({ default: () => <ComingSoon tab="transfers" /> }));
const ScoutingView  = lazy(() => Promise.resolve({ default: () => <ComingSoon tab="scouting" /> }));
const InboxView     = lazy(() => Promise.resolve({ default: () => <ComingSoon tab="inbox" /> }));

// ---------------------------------------------------------------------------
// Tab → component map
// ---------------------------------------------------------------------------

const TAB_COMPONENTS: Record<NavTab, React.LazyExoticComponent<() => JSX.Element>> = {
  dashboard: Dashboard as any,
  standings: StandingsView,
  squad:     SquadView,
  tactics:   TacticsView,
  finances:  FinancesView,
  transfers: TransfersView,
  scouting:  ScoutingView,
  inbox:     InboxView,
};

// ---------------------------------------------------------------------------
// Coming soon placeholder
// ---------------------------------------------------------------------------

function ComingSoon({ tab }: { tab: NavTab }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 h-full text-center px-8">
      <div className="text-3xl">🚧</div>
      <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300 capitalize">
        {tab} view
      </h2>
      <p className="text-xs text-gray-400 dark:text-gray-500 max-w-xs">
        This section is under construction and will be available in a future phase.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab content suspense wrapper
// ---------------------------------------------------------------------------

function TabContent({ tab }: { tab: NavTab }) {
  const Component = TAB_COMPONENTS[tab];
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center">
          <div className="text-xs text-gray-400 dark:text-gray-500">Loading…</div>
        </div>
      }
    >
      <Component />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// Main shell
// ---------------------------------------------------------------------------

export function AppShell() {
  const activeTab        = useUiStore(selectActiveTab);
  const selectedPlayerId = useUiStore(selectSelectedPlayerId);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100 dark:bg-gray-950">

      {/* ── Zone 1: Left Sidebar — always visible ── */}
      <Sidebar />

      {/* ── Zone 2: Main content ── */}
      {/*
        `relative` here is the layout anchor for the PlayerBlade overlay.
        The blade uses `position: absolute` within this zone, leaving
        the sidebar fully interactive (Option A).
      */}
      <main className="relative flex-1 flex flex-col min-w-0 overflow-hidden bg-gray-50 dark:bg-gray-950">
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <TabContent tab={activeTab} />
        </div>

        {/* Player blade — overlays main zone only */}
        {selectedPlayerId && (
          <PlayerBlade playerId={selectedPlayerId} />
        )}
      </main>

      {/* ── Zone 3: Right Inbox Drawer — always visible ── */}
      <InboxDrawer />

    </div>
  );
}
