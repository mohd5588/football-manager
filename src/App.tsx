/**
 * src/App.tsx
 *
 * Phase 4 — the root of the application.
 *
 * Logic is simple:
 *   - No game active → show the World Generator (same screen as Phase 2)
 *   - Game active    → show the full management dashboard (AppShell)
 *
 * Nothing from Phase 2 is deleted. The World Generator just becomes
 * the "new game" screen that you pass through before the dashboard appears.
 */

import { useState, useMemo } from 'react';
import { simulationService } from './services/SimulationService';
import {
  useGameStore,
  selectGameState,
  selectIsSimulating,
  selectProgress,
} from './store/gameStore';
import { useUiStore } from './store/uiStore';
import { AppShell } from './components/layout/AppShell';
import type { WorldGenConfig } from './types';

// ---------------------------------------------------------------------------
// Root component — picks which screen to show
// ---------------------------------------------------------------------------

export default function App() {
  const gameState = useGameStore(selectGameState);

  return (
    <>
      {/*
        THE KEY CHANGE:
        Once a game exists in memory, swap to the full dashboard.
        Until then, show the World Generator screen below.
      */}
      {gameState ? <AppShell /> : <WorldGenerator />}

      {/* Toast pop-ups always sit on top of everything */}
      <ToastStack />
    </>
  );
}

// ---------------------------------------------------------------------------
// World Generator screen
// This is the same screen from Phase 2 — no changes, just moved here.
// ---------------------------------------------------------------------------

function WorldGenerator() {
  const isSimulating = useGameStore(selectIsSimulating);
  const progress     = useGameStore(selectProgress);
  const gameState    = useGameStore(selectGameState);
  const pushToast    = useUiStore((s) => s.pushToast);

  const [seed, setSeed] = useState('');

  async function handleNewGame() {
    const config: WorldGenConfig = {
      seed:          seed ? parseInt(seed, 10) : Math.floor(Math.random() * 999_999),
      managerClubId: null,
    };
    try {
      await simulationService.initLeague(config);
      pushToast('World generated! 92 clubs ready.', 'success');
    } catch (err) {
      pushToast(`Failed to generate world: ${(err as Error).message}`, 'error', 0);
    }
  }

  const clubs = useMemo(
    () => (gameState ? Object.values(gameState.clubs) : []),
    [gameState]
  );

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">

      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">
            ⚽ Football Pyramid Manager
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">Phase 4</p>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-16 space-y-8">

        {/* New Game panel */}
        <section className="bg-gray-900 rounded-xl p-8 border border-gray-800">
          <h2 className="text-2xl font-semibold mb-2">New Game</h2>
          <p className="text-sm text-gray-400 mb-6">
            Generate the English Football Pyramid — 92 clubs across 4 tiers.
            Leave the seed blank for a random world.
          </p>

          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs text-gray-400 mb-1" htmlFor="seed-input">
                World seed (optional)
              </label>
              <input
                id="seed-input"
                type="number"
                placeholder="e.g. 42"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm
                           text-white placeholder-gray-500 w-40
                           focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <button
              onClick={handleNewGame}
              disabled={isSimulating}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50
                         text-white font-semibold rounded-lg px-6 py-2 text-sm
                         transition-colors"
            >
              {isSimulating ? 'Generating…' : '▶  Start'}
            </button>
          </div>

          {/* Progress bar — shown during world generation */}
          {isSimulating && progress > 0 && (
            <div className="mt-5">
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>Building world…</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}
        </section>

        {/* Empty state message */}
        {!gameState && !isSimulating && (
          <div className="text-center py-8 text-gray-600">
            <p className="text-5xl mb-4">🏟️</p>
            <p className="text-gray-500">
              Click Start to generate 92 clubs and enter the dashboard.
            </p>
          </div>
        )}

      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toast notification stack
// Sits in App.tsx so it works on both screens (World Generator and AppShell).
// ---------------------------------------------------------------------------

function ToastStack() {
  const toasts  = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  const COLOURS: Record<string, string> = {
    info:    'bg-gray-800 border-gray-700 text-gray-100',
    success: 'bg-emerald-900 border-emerald-700 text-emerald-100',
    warning: 'bg-amber-900 border-amber-700 text-amber-100',
    error:   'bg-red-900 border-red-700 text-red-100',
  };

  return (
    <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-start gap-3 px-4 py-3 rounded-lg border
                      text-sm shadow-xl max-w-sm ${COLOURS[t.variant]}`}
        >
          <span className="flex-1">{t.message}</span>
          <button
            onClick={() => dismiss(t.id)}
            className="opacity-60 hover:opacity-100 text-xs ml-2 mt-0.5"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
