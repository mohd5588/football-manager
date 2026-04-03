/**
 * src/components/layout/AppShell.tsx
 *
 * Three-zone application shell + global modal layer.
 *
 * The SimSettings modal is rendered HERE (at AppShell level) rather than
 * inside SimulateControl. This means it is a sibling of the Sidebar in the
 * React tree — completely outside the sidebar's DOM subtree and its
 * overflow constraints. Nothing can clip it.
 */

import React, { lazy, Suspense } from 'react';
import {
  useUiStore,
  selectActiveTab,
  selectSelectedPlayerId,
  selectOpenModal,
  type NavTab,
} from '../../store/uiStore';
import { Sidebar }      from './Sidebar';
import { InboxDrawer }  from './InboxDrawer';
import { PlayerBlade }  from '../player/PlayerBlade';

// ---------------------------------------------------------------------------
// Lazy tab views
// ---------------------------------------------------------------------------

const Dashboard = lazy(() =>
  import('../dashboard/Dashboard').then((m) => ({ default: m.Dashboard }))
);

const StandingsView = lazy(() => Promise.resolve({ default: () => <ComingSoon tab="standings" /> }));
const SquadView     = lazy(() => Promise.resolve({ default: () => <ComingSoon tab="squad" /> }));
const TacticsView   = lazy(() => Promise.resolve({ default: () => <ComingSoon tab="tactics" /> }));
const FinancesView  = lazy(() => Promise.resolve({ default: () => <ComingSoon tab="finances" /> }));
const TransfersView = lazy(() => Promise.resolve({ default: () => <ComingSoon tab="transfers" /> }));
const ScoutingView  = lazy(() => Promise.resolve({ default: () => <ComingSoon tab="scouting" /> }));
const InboxView     = lazy(() => Promise.resolve({ default: () => <ComingSoon tab="inbox" /> }));

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
// Helpers
// ---------------------------------------------------------------------------

function ComingSoon({ tab }: { tab: NavTab }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 h-full text-center px-8">
      <div className="text-3xl">🚧</div>
      <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300 capitalize">{tab} view</h2>
      <p className="text-xs text-gray-400 dark:text-gray-500 max-w-xs">
        This section is under construction and will be available in a future phase.
      </p>
    </div>
  );
}

function TabContent({ tab }: { tab: NavTab }) {
  const Component = TAB_COMPONENTS[tab];
  return (
    <Suspense fallback={<div className="flex-1 flex items-center justify-center"><div className="text-xs text-gray-400">Loading…</div></div>}>
      <Component />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// SimSettings Modal
// ---------------------------------------------------------------------------

type SimMode = 'to_fixture' | 'one_day' | 'matchweek';

const SIM_OPTIONS: { mode: SimMode; label: string; description: string; icon: string }[] = [
  {
    mode:        'to_fixture',
    label:       'To next fixture',
    description: 'Fast-forward through quiet days and stop on your next match day. All other fixtures across the pyramid are simulated en route.',
    icon:        '⚽',
  },
  {
    mode:        'one_day',
    label:       'One day',
    description: 'Advance the calendar by exactly 24 hours. On a match day all scheduled games are simulated. On a quiet day only the date changes.',
    icon:        '📅',
  },
  {
    mode:        'matchweek',
    label:       'Full matchweek',
    description: 'Simulate a full 7-day window from today. Every club in every tier plays their scheduled fixtures.',
    icon:        '🗓️',
  },
];

function SimSettingsModal() {
  const simMode    = useUiStore((s) => s.simMode);
  const setSimMode = useUiStore((s) => s.setSimMode);
  const closeModal = useUiStore((s) => s.closeModal);

  const [draft, setDraft] = React.useState<SimMode>(simMode);

  // Close on Escape
  React.useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') closeModal(); };
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [closeModal]);

  const handleSave = () => {
    setSimMode(draft);
    closeModal();
  };

  return (
    // Full-screen overlay — fixed inset-0 covers the entire viewport
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
    >
      <div className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Simulation Settings</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Choose how far to advance the calendar</p>
          </div>
          <button
            onClick={closeModal}
            className="w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Options */}
        <div className="p-3 flex flex-col gap-2">
          {SIM_OPTIONS.map((option) => {
            const isSelected = draft === option.mode;
            return (
              <button
                key={option.mode}
                onClick={() => setDraft(option.mode)}
                className={`w-full flex items-start gap-3 p-3.5 rounded-xl border-2 text-left transition-all
                  ${isSelected
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                  }`}
              >
                <span className="text-xl flex-shrink-0 mt-0.5">{option.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-semibold ${isSelected ? 'text-blue-700 dark:text-blue-300' : 'text-gray-800 dark:text-gray-200'}`}>
                    {option.label}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
                    {option.description}
                  </div>
                </div>
                <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center transition-colors
                  ${isSelected ? 'border-blue-500 bg-blue-500' : 'border-gray-300 dark:border-gray-600'}`}>
                  {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                </div>
              </button>
            );
          })}

          {/* ── Phase 5: Custom Date Picker ────────────────────────────────
              Replace this block with a real <DatePicker> component.
              When selected, reveal a date input below the row.
              Pass the chosen date to simulationService.simToDate().
          ─────────────────────────────────────────────────────────────── */}
          <div className="flex items-center gap-3 p-3.5 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 opacity-50 cursor-not-allowed select-none">
            <span className="text-xl flex-shrink-0">🗓</span>
            <div>
              <div className="text-sm font-semibold text-gray-500 dark:text-gray-400">Custom date</div>
              <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Coming in Phase 5</div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-4 pb-4">
          <button
            onClick={closeModal}
            className="flex-1 py-2.5 rounded-xl text-sm text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 transition-colors"
          >
            Save &amp; Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main shell
// ---------------------------------------------------------------------------

export function AppShell() {
  const activeTab        = useUiStore(selectActiveTab);
  const selectedPlayerId = useUiStore(selectSelectedPlayerId);
  const openModal        = useUiStore(selectOpenModal);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100 dark:bg-gray-950">

      {/* ── Zone 1: Left Sidebar ── */}
      <Sidebar />

      {/* ── Zone 2: Main content ── */}
      <main className="relative flex-1 flex flex-col min-w-0 overflow-hidden bg-gray-50 dark:bg-gray-950">
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <TabContent tab={activeTab} />
        </div>
        {selectedPlayerId && <PlayerBlade playerId={selectedPlayerId} />}
      </main>

      {/* ── Zone 3: Right Inbox Drawer ── */}
      <InboxDrawer />

      {/* ── Global modal layer ─────────────────────────────────────────────
          Rendered OUTSIDE all three zones so no overflow can clip it.
          Add new modals here as ModalId cases grow in Phase 5+.
      ───────────────────────────────────────────────────────────────── */}
      {openModal === 'simSettings' && <SimSettingsModal />}
    </div>
  );
}
