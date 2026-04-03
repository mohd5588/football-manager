/**
 * src/App.tsx
 *
 * New-game flow:
 *   Step 1 — Welcome screen (seed input + New Game button)
 *   Step 2 — Pick a tier  (4 cards: EPL / Championship / League One / League Two)
 *   Step 3 — Pick a club  (grid of clubs in the chosen tier)
 *
 * How the two-pass world generation works:
 *   Pass 1: INIT_LEAGUE with no playerClubId → worker generates clubs.
 *           We read those clubs to populate the picker. gameReady stays false
 *           so we don't jump to AppShell yet.
 *   Pass 2: INIT_LEAGUE with same seed + chosen clubId → worker regenerates
 *           the identical world but marks the correct club as player-managed.
 *           We then set gameReady = true → AppShell renders.
 *
 * Because the seed is fixed, both passes produce identical clubs/players.
 * The only difference is which club has isPlayerManaged = true.
 */

import { useState, useMemo } from 'react';
import { simulationService } from './services/SimulationService';
import {
  useGameStore,
  selectGameState,
  selectIsSimulating,
} from './store/gameStore';
import { useUiStore } from './store/uiStore';
import { AppShell } from './components/layout/AppShell';
import { Tier, TIER_CONFIG } from './types';

// ---------------------------------------------------------------------------
// Setup flow types
// ---------------------------------------------------------------------------

type SetupStep = 'welcome' | 'pick_tier' | 'pick_club';

const TIER_DISPLAY: Record<Tier, { label: string; colour: string; badge: string }> = {
  [Tier.EPL]:          { label: 'Premier League',  colour: 'border-purple-500 hover:bg-purple-900/20', badge: 'bg-purple-900/40 text-purple-300' },
  [Tier.Championship]: { label: 'Championship',    colour: 'border-amber-500  hover:bg-amber-900/20',  badge: 'bg-amber-900/40  text-amber-300'  },
  [Tier.LeagueOne]:    { label: 'League One',       colour: 'border-sky-500    hover:bg-sky-900/20',    badge: 'bg-sky-900/40    text-sky-300'    },
  [Tier.LeagueTwo]:    { label: 'League Two',       colour: 'border-green-500  hover:bg-green-900/20', badge: 'bg-green-900/40  text-green-300'  },
};

const TIER_ORDER: Tier[] = [Tier.EPL, Tier.Championship, Tier.LeagueOne, Tier.LeagueTwo];

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export default function App() {
  const gameState   = useGameStore(selectGameState);
  const [gameReady, setGameReady] = useState(false);

  // Once the user has confirmed their club, gameReady flips to true
  if (gameReady && gameState) {
    return (
      <>
        <AppShell />
        <ToastStack />
      </>
    );
  }

  return (
    <>
      <NewGameFlow onReady={() => setGameReady(true)} />
      <ToastStack />
    </>
  );
}

// ---------------------------------------------------------------------------
// New Game Flow
// ---------------------------------------------------------------------------

function NewGameFlow({ onReady }: { onReady: () => void }) {
  const isSimulating = useGameStore(selectIsSimulating);
  const gameState    = useGameStore(selectGameState);
  const pushToast    = useUiStore((s) => s.pushToast);

  const [step, setStep]               = useState<SetupStep>('welcome');
  const [seedInput, setSeedInput]     = useState('');
  const [activeSeed, setActiveSeed]   = useState<number>(0);
  const [selectedTier, setSelectedTier] = useState<Tier | null>(null);

  // All clubs for the chosen tier (populated after pass-1 world gen)
  const tierClubs = useMemo(() => {
    if (!gameState || !selectedTier) return [];
    return Object.values(gameState.clubs)
      .filter((c) => c.tier === selectedTier)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [gameState, selectedTier]);

  // ── Step 1 → 2: generate world for preview, then show tier picker ─────────
  async function handleStart() {
    const seed = seedInput ? parseInt(seedInput, 10) : Math.floor(Math.random() * 999_999);
    setActiveSeed(seed);
    try {
      // Pass 1 — no player club yet, just get the clubs generated
      await simulationService.initLeague({ seed, managerClubId: null } as any);
      setStep('pick_tier');
    } catch (err) {
      pushToast(`Failed to generate world: ${(err as Error).message}`, 'error', 0);
    }
  }

  // ── Step 2 → 3: user picks a tier ────────────────────────────────────────
  function handlePickTier(tier: Tier) {
    setSelectedTier(tier);
    setStep('pick_club');
  }

  // ── Step 3: user picks a club → pass-2 init, then enter dashboard ─────────
  async function handlePickClub(clubId: string) {
    try {
      // Pass 2 — same seed, now with the chosen club marked as player-managed
      await simulationService.initLeague({ seed: activeSeed, managerClubId: clubId } as any);
      onReady();
    } catch (err) {
      pushToast(`Failed to start game: ${(err as Error).message}`, 'error', 0);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans flex flex-col">

      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4 flex items-center gap-3">
        <span className="text-2xl">⚽</span>
        <div>
          <h1 className="text-lg font-bold text-white tracking-tight">Football Pyramid Manager</h1>
          <p className="text-xs text-gray-500">English Football — 92 Clubs · 4 Tiers</p>
        </div>

        {/* Step indicator */}
        {step !== 'welcome' && (
          <div className="ml-auto flex items-center gap-2">
            {(['welcome', 'pick_tier', 'pick_club'] as SetupStep[]).map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center
                  ${step === s ? 'bg-blue-600 text-white' :
                    i < (['welcome','pick_tier','pick_club'] as SetupStep[]).indexOf(step)
                      ? 'bg-gray-600 text-gray-300'
                      : 'bg-gray-800 text-gray-600'}`}>
                  {i + 1}
                </div>
                {i < 2 && <div className="w-6 h-px bg-gray-700" />}
              </div>
            ))}
          </div>
        )}
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-12">

        {/* ── Step 1: Welcome ── */}
        {step === 'welcome' && (
          <div className="w-full max-w-lg text-center space-y-8">
            <div>
              <div className="text-6xl mb-4">🏆</div>
              <h2 className="text-3xl font-bold text-white mb-2">New Game</h2>
              <p className="text-gray-400 text-sm leading-relaxed">
                You'll manage a club through the English Football Pyramid — from League Two
                all the way up to the Premier League. 92 clubs. 1,840 players. One goal.
              </p>
            </div>

            <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800 space-y-4 text-left">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">
                  World seed <span className="text-gray-600">(optional — leave blank for random)</span>
                </label>
                <input
                  type="number"
                  placeholder="e.g. 42"
                  value={seedInput}
                  onChange={(e) => setSeedInput(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="text-[11px] text-gray-600 mt-1">
                  Same seed = same generated world. Useful for sharing saves with friends.
                </p>
              </div>

              <button
                onClick={handleStart}
                disabled={isSimulating}
                className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2"
              >
                {isSimulating ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                    </svg>
                    Generating world…
                  </>
                ) : (
                  <>▶  Start</>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Pick tier ── */}
        {step === 'pick_tier' && (
          <div className="w-full max-w-2xl space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-white mb-1">Choose your tier</h2>
              <p className="text-sm text-gray-400">Which division do you want to start in?</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {TIER_ORDER.map((tier) => {
                const cfg     = TIER_CONFIG[tier];
                const display = TIER_DISPLAY[tier];
                return (
                  <button
                    key={tier}
                    onClick={() => handlePickTier(tier)}
                    className={`p-6 rounded-2xl border-2 bg-gray-900 text-left transition-all hover:scale-[1.02] active:scale-100 ${display.colour}`}
                  >
                    <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-full mb-3 ${display.badge}`}>
                      {display.label}
                    </span>
                    <div className="text-lg font-bold text-white mb-1">{cfg.clubCount} clubs</div>
                    <div className="text-xs text-gray-400 space-y-0.5">
                      <div>Avg ability: <span className="text-gray-300 font-medium">{cfg.meanAttributeScore}</span></div>
                      {cfg.autoPromotionSlots > 0 && (
                        <div>Auto promotion: <span className="text-green-400 font-medium">Top {cfg.autoPromotionSlots}</span></div>
                      )}
                      {cfg.playoffSlots > 0 && (
                        <div>Playoff spot: <span className="text-amber-400 font-medium">+{cfg.playoffSlots}</span></div>
                      )}
                      <div>Relegation: <span className="text-red-400 font-medium">Bottom {cfg.autoRelegationSlots}</span></div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="text-center">
              <button
                onClick={() => setStep('welcome')}
                className="text-xs text-gray-500 hover:text-gray-400 transition-colors"
              >
                ← Back
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Pick club ── */}
        {step === 'pick_club' && selectedTier && (
          <div className="w-full max-w-3xl space-y-6">
            <div className="text-center">
              <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-full mb-2 ${TIER_DISPLAY[selectedTier].badge}`}>
                {TIER_DISPLAY[selectedTier].label}
              </span>
              <h2 className="text-2xl font-bold text-white mb-1">Choose your club</h2>
              <p className="text-sm text-gray-400">
                {tierClubs.length} clubs available · Sorted A–Z
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2.5 max-h-[60vh] overflow-y-auto pr-1">
              {tierClubs.map((club) => {
                // Average current ability across all the club's players
                const clubPlayers = gameState
                  ? Object.values(gameState.players).filter((p) => p.clubId === club.id)
                  : [];
                const avgAbility = clubPlayers.length
                  ? Math.round(clubPlayers.reduce((s, p) => s + p.currentAbility, 0) / clubPlayers.length)
                  : TIER_CONFIG[selectedTier].meanAttributeScore;

                return (
                  <button
                    key={club.id}
                    onClick={() => handlePickClub(club.id)}
                    disabled={isSimulating}
                    className="flex items-center gap-3 p-4 rounded-xl bg-gray-900 border border-gray-800 hover:border-gray-600 hover:bg-gray-800 text-left transition-all disabled:opacity-50 group"
                  >
                    {/* Crest initials */}
                    <div className="w-10 h-10 rounded-lg bg-gray-800 group-hover:bg-gray-700 flex items-center justify-center flex-shrink-0 transition-colors">
                      <span className="text-xs font-bold text-gray-300">
                        {club.shortName.slice(0, 3).toUpperCase()}
                      </span>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-white truncate">{club.name}</div>
                      <div className="text-xs text-gray-500 truncate">{club.city}</div>
                    </div>

                    <div className="flex-shrink-0 text-right">
                      <div className="text-xs font-bold text-gray-300">{avgAbility}</div>
                      <div className="text-[9px] text-gray-600">ability</div>
                    </div>

                    {isSimulating && (
                      <svg className="animate-spin h-3.5 w-3.5 text-blue-500 ml-auto flex-shrink-0" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="text-center">
              <button
                onClick={() => setStep('pick_tier')}
                className="text-xs text-gray-500 hover:text-gray-400 transition-colors"
              >
                ← Back to tier selection
              </button>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toast notification stack
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
          className={`flex items-start gap-3 px-4 py-3 rounded-lg border text-sm shadow-xl max-w-sm ${COLOURS[t.variant]}`}
        >
          <span className="flex-1">{t.message}</span>
          <button onClick={() => dismiss(t.id)} className="opacity-60 hover:opacity-100 text-xs ml-2 mt-0.5">✕</button>
        </div>
      ))}
    </div>
  );
}
