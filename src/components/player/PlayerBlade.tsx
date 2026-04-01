/**
 * src/components/player/PlayerBlade.tsx
 *
 * Player profile blade — slides in from the right edge of the main content
 * area. The sidebar remains fully visible (Option A decision).
 *
 * Phase 4 scope:
 *   - Player identity: name, age, position, status
 *   - Attributes: 8-attribute bar chart (HTML, not Canvas — Phase 5 upgrades
 *     this to a Chart.js radar chart as specified in the tech stack)
 *   - Season stats: appearances, goals, assists, avg rating
 *   - Availability indicator (injured / suspended / available)
 *
 * Phase 5 additions (placeholders noted):
 *   - Chart.js radar chart
 *   - Historical xG trend (Recharts sparkline)
 *   - Transfer value estimate
 *   - Contract length
 *
 * Architecture:
 *   - Reads: gameStore (player lookup by id)
 *   - Writes: uiStore.selectPlayer(null) on close
 *   - Never talks to simulationService or workerBridge
 */

import React, { useEffect } from 'react';
import { useGameStore, selectGameState } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import type { Player, PlayerAttributes, Position } from '../../types';

// ---------------------------------------------------------------------------
// Attribute display order and labels
// ---------------------------------------------------------------------------

const ATTRIBUTE_ORDER: Array<{ key: keyof PlayerAttributes; label: string }> = [
  { key: 'pace',         label: 'Pace' },
  { key: 'finishing',    label: 'Finishing' },
  { key: 'passing',      label: 'Passing' },
  { key: 'dribbling',    label: 'Dribbling' },
  { key: 'defending',    label: 'Defending' },
  { key: 'physical',     label: 'Physical' },
  { key: 'intelligence', label: 'Intelligence' },
  { key: 'goalkeeping',  label: 'Goalkeeping' },
];

// Attributes that are "primary" for a given position family
const POSITION_PRIMARIES: Partial<Record<Position, Array<keyof PlayerAttributes>>> = {
  GK:  ['goalkeeping', 'physical', 'intelligence'],
  CB:  ['defending', 'physical', 'intelligence'],
  LB:  ['defending', 'pace', 'passing'],
  RB:  ['defending', 'pace', 'passing'],
  LWB: ['pace', 'dribbling', 'passing'],
  RWB: ['pace', 'dribbling', 'passing'],
  CDM: ['defending', 'passing', 'physical'],
  CM:  ['passing', 'intelligence', 'physical'],
  CAM: ['passing', 'intelligence', 'dribbling'],
  LM:  ['pace', 'dribbling', 'passing'],
  RM:  ['pace', 'dribbling', 'passing'],
  LW:  ['pace', 'dribbling', 'finishing'],
  RW:  ['pace', 'dribbling', 'finishing'],
  CF:  ['finishing', 'intelligence', 'dribbling'],
  ST:  ['finishing', 'pace', 'physical'],
};

// ---------------------------------------------------------------------------
// Attribute bar colour — based on value relative to tier
// ---------------------------------------------------------------------------

function attrColour(value: number): string {
  if (value >= 80) return 'bg-green-500';
  if (value >= 65) return 'bg-blue-500';
  if (value >= 50) return 'bg-amber-500';
  return 'bg-red-500';
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ player }: { player: Player }) {
  if (player.status === 'active') {
    return (
      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
        Available
      </span>
    );
  }
  if (player.status === 'injured') {
    return (
      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">
        Injured · {player.unavailableWeeks}w
      </span>
    );
  }
  if (player.status === 'suspended') {
    return (
      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
        Suspended · {player.unavailableWeeks}w
      </span>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface PlayerBladeProps {
  playerId: string;
}

export function PlayerBlade({ playerId }: PlayerBladeProps) {
  const gameState   = useGameStore(selectGameState);
  const selectPlayer = useUiStore((s) => s.selectPlayer);

  const player = gameState?.players[playerId] ?? null;
  const primaries = player ? (POSITION_PRIMARIES[player.position] ?? []) : [];

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') selectPlayer(null);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [selectPlayer]);

  if (!player) return null;

  const stats = player.seasonStats;

  return (
    <>
      {/* Scrim — only over the main content, not the sidebar */}
      <div
        className="absolute inset-0 bg-black/20 dark:bg-black/40 z-10 transition-opacity"
        onClick={() => selectPlayer(null)}
        aria-hidden
      />

      {/* Blade panel */}
      <div
        className="absolute top-0 right-0 bottom-0 w-72 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 z-20 flex flex-col shadow-xl overflow-hidden"
        role="dialog"
        aria-label={`${player.name} profile`}
      >

        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          {/* Avatar */}
          <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-medium text-blue-700 dark:text-blue-300">
              {player.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
              {player.name}
            </div>
            <div className="text-[11px] text-gray-400 dark:text-gray-500">
              {player.position} · Age {player.age}
            </div>
          </div>
          <button
            onClick={() => selectPlayer(null)}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors flex-shrink-0 p-1"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">

          {/* Status + current ability */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
            <StatusBadge player={player} />
            <div className="text-right">
              <div className="text-[10px] text-gray-400 dark:text-gray-500">Ability</div>
              <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
                {player.currentAbility}
              </div>
            </div>
          </div>

          {/* Season stats */}
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
            <div className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
              This season
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Apps',      value: stats.appearances },
                { label: 'Goals',     value: stats.goals },
                { label: 'Assists',   value: stats.assists },
                { label: 'Rating',    value: stats.averageRating.toFixed(1) },
                { label: 'Yellows',   value: stats.yellowCards },
                { label: 'Reds',      value: stats.redCards },
              ].map(({ label, value }) => (
                <div key={label} className="bg-gray-50 dark:bg-gray-800 rounded-md p-2">
                  <div className="text-[9px] text-gray-400 dark:text-gray-500">{label}</div>
                  <div className="text-sm font-medium text-gray-800 dark:text-gray-200 mt-0.5">
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Attributes */}
          <div className="px-4 py-3">
            <div className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2.5">
              Attributes
              {/* Phase 5: replace with Chart.js radar canvas */}
            </div>
            <div className="space-y-2">
              {ATTRIBUTE_ORDER.map(({ key, label }) => {
                const value      = player.attributes[key];
                const isPrimary  = primaries.includes(key);
                const isGK       = key === 'goalkeeping' && player.position !== 'GK';

                return (
                  <div key={key} className={`flex items-center gap-2.5 ${isGK ? 'opacity-30' : ''}`}>
                    <span className={`text-[11px] w-20 flex-shrink-0 ${
                      isPrimary
                        ? 'text-gray-700 dark:text-gray-300 font-medium'
                        : 'text-gray-400 dark:text-gray-500'
                    }`}>
                      {label}
                    </span>
                    <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className={`h-1.5 rounded-full transition-all ${attrColour(value)}`}
                        style={{ width: `${value}%` }}
                      />
                    </div>
                    <span className={`text-[11px] w-6 text-right flex-shrink-0 ${
                      isPrimary
                        ? 'font-medium text-gray-700 dark:text-gray-300'
                        : 'text-gray-400 dark:text-gray-500'
                    }`}>
                      {value}
                    </span>
                    {isPrimary && (
                      <span className="text-[8px] text-blue-400 dark:text-blue-500 flex-shrink-0">★</span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Phase 5 radar chart placeholder */}
            <div className="mt-4 h-32 rounded-lg border-2 border-dashed border-gray-100 dark:border-gray-800 flex items-center justify-center">
              <span className="text-[10px] text-gray-300 dark:text-gray-700">
                Radar chart — Phase 5
              </span>
            </div>
          </div>

        </div>

        {/* Footer actions */}
        <div className="flex gap-2 px-4 py-3 border-t border-gray-100 dark:border-gray-800 flex-shrink-0">
          <button className="flex-1 py-2 rounded-lg text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors">
            Scout deeper
          </button>
          <button className="flex-1 py-2 rounded-lg text-xs text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            Offer transfer
          </button>
        </div>

      </div>
    </>
  );
}
