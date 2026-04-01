/**
 * src/components/dashboard/Dashboard.tsx
 *
 * The "dashboard" tab — the default view when the game is active.
 *
 * Layout (two columns on wider viewports, stacked on narrow):
 *   Left  (primary):  Next Fixture card + League Table (compact)
 *   Right (secondary): Season summary metrics (Phase 6: Tremor cards)
 *
 * Phase 4 scope:
 *   - NextFixtureCard
 *   - LeagueTable (compact mode, centred on player's row)
 *   - Topbar with date and matchweek context
 *   - Placeholder metric cards (Phase 6 will wire real finance data)
 *
 * State sources (read-only):
 *   - gameStore → gameState for topbar context
 */

import React from 'react';
import { useGameStore, selectGameState, selectManagerClub } from '../../store/gameStore';
import { NextFixtureCard } from './NextFixtureCard';
import { LeagueTable } from './LeagueTable';

// ---------------------------------------------------------------------------
// Topbar
// ---------------------------------------------------------------------------

function formatDisplayDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function Topbar() {
  const gameState = useGameStore(selectGameState);

  return (
    <div className="flex items-center gap-3 px-5 py-2.5 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
      <span className="text-sm font-medium text-gray-800 dark:text-gray-200">Dashboard</span>
      {gameState && (
        <>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {formatDisplayDate(gameState.currentDate)}
          </span>
          <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">
            Season {gameState.season}
          </span>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Placeholder metric card (Phase 6: replace with Tremor Metric component)
// ---------------------------------------------------------------------------

interface MetricCardProps {
  label: string;
  value: string;
  sub?: string;
  subColour?: 'green' | 'red' | 'neutral';
}

function MetricCard({ label, value, sub, subColour = 'neutral' }: MetricCardProps) {
  const subColourClass = {
    green:   'text-green-600 dark:text-green-400',
    red:     'text-red-500 dark:text-red-400',
    neutral: 'text-gray-400 dark:text-gray-500',
  }[subColour];

  return (
    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
      <div className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">
        {label}
      </div>
      <div className="text-xl font-medium text-gray-900 dark:text-gray-100">
        {value}
      </div>
      {sub && (
        <div className={`text-[11px] mt-0.5 ${subColourClass}`}>{sub}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Dashboard() {
  const gameState = useGameStore(selectGameState);
  const club      = useGameStore(selectManagerClub);

  if (!gameState || !club) {
    return (
      <div className="flex flex-col h-full">
        <Topbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-sm text-gray-400 text-center">
            <div className="mb-2 text-2xl">⚽</div>
            Start a new game to begin managing
          </div>
        </div>
      </div>
    );
  }

  const myRow     = gameState.playerStandingsRow;
  const winRate   = myRow && myRow.played > 0
    ? Math.round((myRow.won / myRow.played) * 100)
    : 0;
  const balance   = club.finances.balance;
  const balanceStr = balance >= 0
    ? `£${(balance / 1_000_000).toFixed(1)}m`
    : `-£${(Math.abs(balance) / 1_000_000).toFixed(1)}m`;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Topbar />

      <div className="flex-1 overflow-y-auto">
        <div className="p-5 grid grid-cols-1 xl:grid-cols-[1fr_220px] gap-5 items-start">

          {/* ── Left column ── */}
          <div className="space-y-5">

            {/* Next fixture */}
            <section>
              <div className="flex items-center justify-between mb-2.5">
                <h2 className="text-[11px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                  Next fixture
                </h2>
              </div>
              <NextFixtureCard />
            </section>

            {/* League table */}
            <section>
              <div className="flex items-center justify-between mb-2.5">
                <h2 className="text-[11px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                  {club.currentTier.replace(/([A-Z])/g, ' $1').trim()} — table
                </h2>
              </div>
              <LeagueTable compact />
            </section>

          </div>

          {/* ── Right column — season metrics ── */}
          <div className="space-y-3">
            <h2 className="text-[11px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
              Season snapshot
            </h2>

            {myRow ? (
              <>
                <MetricCard
                  label="Position"
                  value={`${myRow.position}${ordinal(myRow.position)}`}
                  sub={`of ${club.currentTier === 'EPL' ? 20 : 24}`}
                />
                <MetricCard
                  label="Points"
                  value={String(myRow.points)}
                  sub={`${myRow.played} played`}
                />
                <MetricCard
                  label="Win rate"
                  value={`${winRate}%`}
                  sub={`${myRow.won}W · ${myRow.drawn}D · ${myRow.lost}L`}
                  subColour={winRate >= 50 ? 'green' : winRate >= 33 ? 'neutral' : 'red'}
                />
                <MetricCard
                  label="Goal diff"
                  value={myRow.goalDifference >= 0 ? `+${myRow.goalDifference}` : String(myRow.goalDifference)}
                  sub={`${myRow.goalsFor} scored · ${myRow.goalsAgainst} conceded`}
                  subColour={myRow.goalDifference > 0 ? 'green' : myRow.goalDifference < 0 ? 'red' : 'neutral'}
                />
              </>
            ) : (
              <div className="text-xs text-gray-400 dark:text-gray-500">
                Standings pending first matchday
              </div>
            )}

            {/* Finance snapshot — Phase 6 replaces with live Tremor cards */}
            <div className="border-t border-gray-100 dark:border-gray-800 pt-3 mt-3 space-y-3">
              <h2 className="text-[11px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                Finances
              </h2>
              <MetricCard
                label="Balance"
                value={balanceStr}
                subColour={balance >= 0 ? 'green' : 'red'}
              />
              <MetricCard
                label="Wage bill"
                value={`£${Math.round(club.finances.wageBill / 1000)}k/wk`}
                sub="per week"
              />
              <MetricCard
                label="Transfer budget"
                value={`£${(club.finances.transferBudget / 1_000_000).toFixed(1)}m`}
                subColour={club.finances.transferBudget > 500_000 ? 'green' : 'red'}
              />
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] ?? s[v] ?? s[0];
}
