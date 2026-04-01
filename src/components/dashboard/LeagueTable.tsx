/**
 * src/components/dashboard/LeagueTable.tsx
 *
 * Renders a standings table for any tier with:
 *   - Inline raw SVG form sparklines (5 dots — no library, 60fps guaranteed)
 *   - Zone highlighting (promotion / playoff / relegation) derived from TIER_CONFIG
 *   - Player-managed club row highlighted in blue
 *   - Club name click → uiStore.selectClub() (opens Club Profile blade)
 *   - Abbreviated "mid-table" rows to keep the dashboard compact;
 *     a "Full table →" link navigates to the Standings tab
 *
 * Performance contract:
 *   The sparkline is 5 raw <circle> elements inside a tiny <svg>.
 *   No Canvas, no Chart.js, no Recharts — this component must stay
 *   render-cheap because it lives in a scrollable container.
 *
 * State sources:
 *   - gameStore → standings, playerClubId
 *   - uiStore   → selectClub (write), setActiveTab (write)
 */

import React, { useMemo } from 'react';
import { useGameStore, selectGameState } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { TIER_CONFIG, type Tier, type StandingsRow } from '../../types';

// ---------------------------------------------------------------------------
// Form sparkline — raw SVG, zero dependencies
// ---------------------------------------------------------------------------

const FORM_COLOURS = {
  W: '#16a34a', // green-600
  D: '#9ca3af', // gray-400
  L: '#dc2626', // red-600
} as const;

function FormSparkline({ form }: { form: string }) {
  // Take the last 5 characters of the form string
  const chars = form.slice(-5).split('') as Array<keyof typeof FORM_COLOURS>;
  const w = chars.length * 9 - 2; // 5 dots × 9px spacing − trailing gap

  return (
    <svg
      width={w}
      height={8}
      viewBox={`0 0 ${w} 8`}
      aria-label={`Form: ${chars.join(' ')}`}
      style={{ display: 'block', overflow: 'visible' }}
    >
      {chars.map((char, i) => (
        <circle
          key={i}
          cx={i * 9 + 4}
          cy={4}
          r={3.5}
          fill={FORM_COLOURS[char] ?? FORM_COLOURS.D}
        />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Zone logic — derived purely from TIER_CONFIG constants
// ---------------------------------------------------------------------------

type Zone = 'promotion' | 'playoff' | 'relegation' | 'none';

function getZone(position: number, tier: Tier): Zone {
  const cfg = TIER_CONFIG[tier];
  if (cfg.autoPromotionSlots > 0 && position <= cfg.autoPromotionSlots)
    return 'promotion';
  if (cfg.playoffEntrants > 0 && position <= cfg.autoPromotionSlots + cfg.playoffEntrants)
    return 'playoff';
  if (position > cfg.clubCount - cfg.autoRelegationSlots)
    return 'relegation';
  return 'none';
}

const ZONE_LEFT_BORDER: Record<Zone, string> = {
  promotion:  'border-l-2 border-l-green-500',
  playoff:    'border-l-2 border-l-amber-500',
  relegation: 'border-l-2 border-l-red-500',
  none:       'border-l-2 border-l-transparent',
};

const ZONE_SEPARATOR: Record<Zone, string | null> = {
  promotion:  'Playoff zone',
  playoff:    null, // separator rendered at mid-table boundary
  relegation: null,
  none:       null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatGD(gd: number): string {
  if (gd > 0) return `+${gd}`;
  return String(gd);
}

// How many rows to show above and below the player's row in compact mode.
const COMPACT_CONTEXT = 3;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface LeagueTableProps {
  /** Limit rows for the dashboard compact view. Omit for full standings page. */
  compact?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LeagueTable({ compact = false }: LeagueTableProps) {
  const gameState    = useGameStore(selectGameState);
  const selectClub   = useUiStore((s) => s.selectClub);
  const setActiveTab = useUiStore((s) => s.setActiveTab);

  const rows       = gameState?.standings[gameState.playerClub.currentTier] ?? [];
  const tier       = gameState?.playerClub.currentTier;
  const playerClubId = gameState?.playerClubId;

  // In compact mode, show a window around the player's row
  const visibleRows = useMemo<Array<StandingsRow | 'separator'>>(() => {
    if (!compact || !playerClubId) return rows;

    const playerIdx = rows.findIndex((r) => r.clubId === playerClubId);
    if (playerIdx === -1) return rows.slice(0, 8);

    const lo  = Math.max(0, playerIdx - COMPACT_CONTEXT);
    const hi  = Math.min(rows.length - 1, playerIdx + COMPACT_CONTEXT);
    const win = rows.slice(lo, hi + 1);

    const result: Array<StandingsRow | 'separator'> = [];
    if (lo > 0) result.push('separator');
    result.push(...win);
    if (hi < rows.length - 1) result.push('separator');
    return result;
  }, [rows, playerClubId, compact]);

  if (!gameState || !tier) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
        <div className="h-48 flex items-center justify-center text-sm text-gray-400">
          No game active
        </div>
      </div>
    );
  }

  // Zone separator label positions — insert labels before the first row of a new zone
  const promotionEnd = TIER_CONFIG[tier].autoPromotionSlots;
  const playoffEnd   = promotionEnd + TIER_CONFIG[tier].playoffEntrants;
  const relegStart   = TIER_CONFIG[tier].clubCount - TIER_CONFIG[tier].autoRelegationSlots + 1;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
      <table className="w-full text-xs border-collapse" style={{ tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '26px' }} />
          <col />                          {/* Club name — stretches */}
          <col style={{ width: '26px' }} />
          <col style={{ width: '26px' }} />
          <col style={{ width: '26px' }} />
          <col style={{ width: '26px' }} />
          <col style={{ width: '30px' }} />
          <col style={{ width: '46px' }} />
          <col style={{ width: '28px' }} />
        </colgroup>

        <thead>
          <tr className="border-b border-gray-100 dark:border-gray-800">
            {['#', 'Club', 'P', 'W', 'D', 'L', 'GD', 'Form', 'Pts'].map((h, i) => (
              <th
                key={h}
                className={`py-2 px-1.5 font-medium text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider
                  ${i > 1 ? 'text-right' : 'text-left'}
                  ${i === 0 ? 'pl-2.5' : ''}
                `}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((row, idx) => {
            if (row === undefined) return null;
            const isPlayer = row.clubId === playerClubId;
            const zone     = getZone(row.position, tier);
            const club     = gameState.clubs[row.clubId];

            // Insert zone separator rows
            const separatorBefore: string | null =
              row.position === promotionEnd + 1 && TIER_CONFIG[tier].playoffEntrants > 0
                ? `Playoff zone (${promotionEnd + 1}th–${playoffEnd}th)`
                : row.position === playoffEnd + 1
                ? 'Mid-table'
                : row.position === relegStart
                ? 'Relegation zone'
                : null;

            return (
              <React.Fragment key={row.clubId}>
                {separatorBefore && (
                  <tr>
                    <td
                      colSpan={9}
                      className="py-1 px-2.5 text-[9px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider bg-gray-50 dark:bg-gray-800/50"
                    >
                      {separatorBefore}
                    </td>
                  </tr>
                )}
                <tr
                  className={`
                    group border-b border-gray-100 dark:border-gray-800 last:border-0
                    ${ZONE_LEFT_BORDER[zone]}
                    ${isPlayer
                      ? 'bg-blue-50 dark:bg-blue-900/20'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-800/30'
                    }
                    transition-colors
                  `}
                >
                  {/* Position */}
                  <td className="py-1.5 pl-2.5 pr-1 text-gray-400 dark:text-gray-500 text-right">
                    {row.position}
                  </td>

                  {/* Club name */}
                  <td className="py-1.5 px-1.5">
                    <button
                      onClick={() => selectClub(row.clubId)}
                      className={`text-left truncate w-full transition-colors
                        ${isPlayer
                          ? 'font-medium text-blue-700 dark:text-blue-300'
                          : 'text-gray-700 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400'
                        }`}
                    >
                      {club?.shortName ?? club?.name ?? '—'}
                      {isPlayer && (
                        <span className="ml-1 text-[9px] text-blue-400 dark:text-blue-500">★</span>
                      )}
                    </button>
                  </td>

                  {/* Stats */}
                  {[row.played, row.won, row.drawn, row.lost].map((val, i) => (
                    <td key={i} className="py-1.5 px-1.5 text-right text-gray-500 dark:text-gray-400">
                      {val}
                    </td>
                  ))}

                  {/* Goal difference */}
                  <td className={`py-1.5 px-1.5 text-right font-medium
                    ${row.goalDifference > 0 ? 'text-green-600 dark:text-green-400' :
                      row.goalDifference < 0 ? 'text-red-500 dark:text-red-400' :
                      'text-gray-400 dark:text-gray-500'}`}>
                    {formatGD(row.goalDifference)}
                  </td>

                  {/* Form sparkline */}
                  <td className="py-1.5 px-1.5 text-right">
                    <div className="flex justify-end">
                      <FormSparkline form={row.form} />
                    </div>
                  </td>

                  {/* Points */}
                  <td className={`py-1.5 pr-2.5 text-right font-medium
                    ${isPlayer
                      ? 'text-blue-700 dark:text-blue-300'
                      : 'text-gray-800 dark:text-gray-200'
                    }`}>
                    {row.points}
                  </td>
                </tr>
              </React.Fragment>
            );
          })}
        </tbody>
      </table>

      {compact && (
        <div className="border-t border-gray-100 dark:border-gray-800 py-2 px-3 text-center">
          <button
            onClick={() => setActiveTab('standings')}
            className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
          >
            Full table →
          </button>
        </div>
      )}
    </div>
  );
}
