/**
 * src/components/dashboard/SimulateControl.tsx
 *
 * The primary simulation control — lives at the bottom of the Sidebar.
 *
 * Four states:
 *   1. IDLE        — Primary button + chevron dropdown
 *   2. DROPDOWN    — Dropdown open showing four sim-mode options
 *   3. SIMULATING  — Progress bar with a Stop button
 *   4. ATTENTION   — Simulation halted; an AttentionEvent awaits decision
 *
 * UX rules:
 *   - Spacebar fires the primary action when IDLE and no input is focused.
 *   - Selecting a dropdown option updates the primary label but does NOT fire.
 *   - The chevron ▾ button is always separate from the primary.
 *   - Any AttentionEvent in the queue transitions to the ATTENTION state,
 *     regardless of whether a sim was running.
 *
 * Architecture:
 *   Reads:  gameStore (isSimulating, progress, nextFixture)
 *   Reads:  inboxStore (currentAttention)
 *   Writes: simulationService (never the worker directly)
 *   Writes: uiStore (setActiveTab when navigating from an attention CTA)
 *   Writes: inboxStore (resolveAttention)
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useGameStore, selectIsSimulating, selectProgress, selectGameState } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { useInboxStore, selectCurrentAttention } from '../../store/inboxStore';
import { simulationService } from '../../services/SimulationService';
import type { NavTab } from '../../store/uiStore';

// ---------------------------------------------------------------------------
// Sim-mode config
// ---------------------------------------------------------------------------

export type SimMode = 'to_fixture' | 'one_day' | 'matchweek' | 'custom';

interface SimOption {
  mode:  SimMode;
  label: string;
  sub:   string;
}

const SIM_OPTIONS: SimOption[] = [
  {
    mode:  'to_fixture',
    label: 'To next fixture',
    sub:   'Default · fast-forward to kick-off',
  },
  {
    mode:  'one_day',
    label: 'One day',
    sub:   'Advance calendar by 24 hrs',
  },
  {
    mode:  'matchweek',
    label: 'To end of matchweek',
    sub:   'Simulate all MW fixtures',
  },
  {
    mode:  'custom',
    label: 'Custom date…',
    sub:   'Open date picker',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the ISO date string for the last day of the current matchweek.
 * A matchweek is treated as the 7-day window starting from currentDate.
 * Phase 5: replace with proper matchweek-boundary lookup in the fixture list.
 */
function getMatchweekEndDate(currentDate: string): string {
  const d = new Date(currentDate);
  d.setDate(d.getDate() + 7);
  return d.toISOString().split('T')[0];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SimulateControl() {
  const isSimulating     = useGameStore(selectIsSimulating);
  const progress         = useGameStore(selectProgress);
  const gameState        = useGameStore(selectGameState);
  const currentAttention = useInboxStore(selectCurrentAttention);
  const setActiveTab     = useUiStore((s) => s.setActiveTab);
  const resolveAttention = useInboxStore((s) => s.resolveAttention);
  const openModal        = useUiStore((s) => s.openModal);

  const [simMode, setSimMode]         = useState<SimMode>('to_fixture');
  const [dropdownOpen, setDropdown]   = useState(false);
  const [customDate, setCustomDate]   = useState<string>('');

  const dropdownRef   = useRef<HTMLDivElement>(null);
  const currentJobRef = useRef<string | null>(null);

  // Derived label for the primary button
  const activeOption = SIM_OPTIONS.find((o) => o.mode === simMode)!;

  // ── Close dropdown on outside click ────────────────────────────────────────
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  // ── Spacebar fires primary when idle ───────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const tag = (e.target as HTMLElement).tagName.toLowerCase();
      if (['input', 'textarea', 'select', 'button'].includes(tag)) return;
      if (isSimulating || currentAttention) return;
      e.preventDefault();
      handleSimulate();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSimulating, currentAttention, simMode, gameState]);

  // ── Core simulation dispatch ────────────────────────────────────────────────
  const handleSimulate = useCallback(async () => {
    if (!gameState) return;

    if (simMode === 'one_day') {
      await simulationService.simDay();
      return;
    }

    if (simMode === 'to_fixture') {
      const target = gameState.nextFixture?.date;
      if (!target) return;
      await simulationService.simToDate({ targetDate: target });
      return;
    }

    if (simMode === 'matchweek') {
      const target = getMatchweekEndDate(gameState.currentDate);
      await simulationService.simToDate({ targetDate: target });
      return;
    }

    if (simMode === 'custom') {
      if (customDate) {
        await simulationService.simToDate({ targetDate: customDate });
      } else {
        openModal('settings'); // placeholder — open date-picker modal in Phase 5
      }
    }
  }, [simMode, gameState, customDate, openModal]);

  const handleStop = useCallback(() => {
    // SimulationService tracks its own current jobId internally.
    // Phase 5: expose simulationService.cancelCurrentSim() on ISimulationService.
    (simulationService as any).cancelCurrentSim?.();
  }, []);

  const handleAttentionPrimary = useCallback((event: NonNullable<typeof currentAttention>) => {
    resolveAttention(event.id);
    if (event.primaryTab) setActiveTab(event.primaryTab as NavTab);
  }, [resolveAttention, setActiveTab]);

  const handleAttentionSecondary = useCallback((event: NonNullable<typeof currentAttention>) => {
    resolveAttention(event.id);
    // Continue simulation automatically after resolving
    handleSimulate();
  }, [resolveAttention, handleSimulate]);

  // ── STATE 4: Attention required ────────────────────────────────────────────
  if (currentAttention) {
    return (
      <div className="rounded-lg border border-amber-200 dark:border-amber-800 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/30">
          <span className="text-amber-600 dark:text-amber-400 text-sm">⚠</span>
          <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
            Simulation paused
          </span>
        </div>
        <div className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400 leading-relaxed border-t border-amber-100 dark:border-amber-900">
          <span className="font-medium text-gray-800 dark:text-gray-200 block mb-0.5">
            {currentAttention.title}
          </span>
          {currentAttention.body}
        </div>
        <div className="flex gap-2 px-3 pb-3 pt-1">
          <button
            onClick={() => handleAttentionPrimary(currentAttention)}
            className="flex-1 py-1.5 rounded-md text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
          >
            {currentAttention.primaryAction}
          </button>
          <button
            onClick={() => handleAttentionSecondary(currentAttention)}
            className="flex-1 py-1.5 rounded-md text-xs text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            {currentAttention.secondaryAction}
          </button>
        </div>
      </div>
    );
  }

  // ── STATE 3: Simulating ────────────────────────────────────────────────────
  if (isSimulating) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Progress bar track */}
        <div className="h-0.5 bg-gray-100 dark:bg-gray-800">
          <div
            className="h-0.5 bg-blue-500 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex items-center gap-2 px-3 py-2.5">
          {/* Spinner */}
          <svg
            className="animate-spin h-3.5 w-3.5 text-blue-500 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <span className="flex-1 text-xs text-gray-500 dark:text-gray-400 truncate">
            Simulating… {Math.round(progress)}%
          </span>
          <button
            onClick={handleStop}
            className="text-xs text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 transition-colors flex-shrink-0"
          >
            Stop
          </button>
        </div>
      </div>
    );
  }

  // ── STATE 1 & 2: Idle / Dropdown open ─────────────────────────────────────
  return (
    <div ref={dropdownRef} className="flex flex-col gap-1">

      {/* Dropdown menu — rendered ABOVE the button when open */}
      {dropdownOpen && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden shadow-sm">
          {SIM_OPTIONS.map((option) => (
            <button
              key={option.mode}
              onClick={() => {
                setSimMode(option.mode);
                setDropdown(false);
              }}
              className="w-full flex items-start gap-2 px-3 py-2.5 text-left border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-gray-800 dark:text-gray-200">
                  {option.label}
                </div>
                <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                  {option.sub}
                </div>
              </div>
              {simMode === option.mode && (
                <span className="text-blue-500 text-xs flex-shrink-0 mt-0.5">✓</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Primary row */}
      <div className="flex gap-1.5">
        {/* Primary action button */}
        <button
          onClick={handleSimulate}
          disabled={!gameState}
          className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <span>▶</span>
          <span className="flex-1 text-left truncate">{activeOption.label}</span>
          <kbd className="text-[9px] px-1 py-0.5 rounded border border-blue-300 dark:border-blue-700 opacity-60 flex-shrink-0">
            Space
          </kbd>
        </button>

        {/* Dropdown chevron */}
        <button
          onClick={() => setDropdown((v) => !v)}
          className={`flex items-center justify-center w-8 rounded-lg border text-xs transition-colors flex-shrink-0
            ${dropdownOpen
              ? 'bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300'
              : 'border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
          aria-label="Simulation options"
        >
          {dropdownOpen ? '▴' : '▾'}
        </button>
      </div>
    </div>
  );
}
