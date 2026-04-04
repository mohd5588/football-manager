/**
 * src/components/dashboard/SimulateControl.tsx
 *
 * Simple stacked layout:
 *   - Three mode buttons (tap to select)
 *   - One big Simulate button that fires the selected mode
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  useGameStore,
  selectIsSimulating,
  selectProgress,
  selectGameState,
} from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { useInboxStore, selectCurrentAttention } from '../../store/inboxStore';
import { simulationService } from '../../services/SimulationService';
import type { NavTab } from '../../store/uiStore';

type SimMode = 'to_fixture' | 'one_day' | 'matchweek';

const MODES: { mode: SimMode; label: string }[] = [
  { mode: 'to_fixture', label: 'Next fixture' },
  { mode: 'one_day',    label: 'One day'      },
  { mode: 'matchweek',  label: 'Matchweek'    },
];

function getMatchweekEnd(date: string): string {
  const d = new Date(date);
  d.setDate(d.getDate() + 7);
  return d.toISOString().split('T')[0];
}

export default function SimulateControl() {
  const isSimulating     = useGameStore(selectIsSimulating);
  const progress         = useGameStore(selectProgress);
  const gameState        = useGameStore(selectGameState);
  const currentAttention = useInboxStore(selectCurrentAttention);
  const setNavTab        = useUiStore((s) => s.setNavTab);   // ← was setActiveTab
  const resolveAttention = useInboxStore((s) => s.resolveAttention);

  const [simMode, setSimMode] = useState<SimMode>('to_fixture');

  const handleSimulate = useCallback(async () => {
    if (!gameState) return;
    if (simMode === 'one_day') {
      await simulationService.simDay();
      return;
    }
    if (simMode === 'to_fixture') {
      const target = gameState.nextFixture?.date;
      await (target
        ? simulationService.simToDate({ targetDate: target })
        : simulationService.simDay());
      return;
    }
    if (simMode === 'matchweek') {
      await simulationService.simToDate({
        targetDate: getMatchweekEnd(gameState.currentDate),
      });
    }
  }, [simMode, gameState]);

  // Spacebar shortcut
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const tag = (e.target as HTMLElement).tagName.toLowerCase();
      if (['input', 'textarea', 'select', 'button'].includes(tag)) return;
      if (isSimulating || currentAttention) return;
      e.preventDefault();
      handleSimulate();
    };
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSimulating, currentAttention, simMode, gameState]);

  const handleAttentionPrimary = useCallback(
    (ev: NonNullable<typeof currentAttention>) => {
      resolveAttention(ev.id);
      if (ev.primaryTab) setNavTab(ev.primaryTab as NavTab);  // ← was setActiveTab
    },
    [resolveAttention, setNavTab]
  );

  const handleAttentionSecondary = useCallback(
    (ev: NonNullable<typeof currentAttention>) => {
      resolveAttention(ev.id);
      handleSimulate();
    },
    [resolveAttention, handleSimulate]
  );

  // ── Attention required ────────────────────────────────────────────────────
  if (currentAttention) {
    return (
      <div className="rounded-lg border border-amber-200 dark:border-amber-800 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/30">
          <span className="text-amber-500">⚠</span>
          <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
            Simulation paused
          </span>
        </div>
        <div className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400 border-t border-amber-100 dark:border-amber-900">
          <span className="font-medium text-gray-800 dark:text-gray-200 block mb-0.5">
            {currentAttention.title}
          </span>
          {currentAttention.body}
        </div>
        <div className="flex gap-2 px-3 pb-3 pt-1">
          <button
            onClick={() => handleAttentionPrimary(currentAttention)}
            className="flex-1 py-1.5 rounded-md text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 transition-colors"
          >
            {currentAttention.primaryAction}
          </button>
          <button
            onClick={() => handleAttentionSecondary(currentAttention)}
            className="flex-1 py-1.5 rounded-md text-xs text-gray-500 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            {currentAttention.secondaryAction}
          </button>
        </div>
      </div>
    );
  }

  // ── Simulating in progress ────────────────────────────────────────────────
  if (isSimulating) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="h-0.5 bg-gray-100 dark:bg-gray-800">
          <div
            className="h-0.5 bg-blue-500 transition-all duration-300"
            style={{ width: `${progress || 5}%` }}
          />
        </div>
        <div className="flex items-center gap-2 px-3 py-2.5">
          <svg className="animate-spin h-3.5 w-3.5 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <span className="flex-1 text-xs text-gray-500 dark:text-gray-400">
            Simulating… {Math.round(progress)}%
          </span>
          <button
            onClick={() => (simulationService as any).cancelCurrentSim?.()}
            className="text-xs text-red-500 hover:text-red-600 transition-colors"
          >
            Stop
          </button>
        </div>
      </div>
    );
  }

  // ── Idle ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-1.5">

      {/* Mode selector */}
      <div className="flex gap-1">
        {MODES.map(({ mode, label }) => (
          <button
            key={mode}
            onClick={() => setSimMode(mode)}
            className={`flex-1 py-1 rounded-md text-[10px] font-medium transition-colors border
              ${simMode === mode
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-transparent text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Simulate button */}
      <button
        onClick={handleSimulate}
        disabled={!gameState}
        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold transition-colors"
      >
        <span>▶</span>
        <span>Simulate</span>
        <kbd className="text-[9px] px-1 py-0.5 rounded border border-blue-400 opacity-60">
          Space
        </kbd>
      </button>

    </div>
  );
}
