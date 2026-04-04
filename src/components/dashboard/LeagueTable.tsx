/**
 * src/components/dashboard/LeagueTable.tsx
 */

import React, { useMemo } from 'react';
import { useGameStore, selectGameState } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { TIER_CONFIG, type Tier, type StandingsRow } from '../../types';

// ---------------------------------------------------------------------------
// Form sparkline — raw SVG, zero dependencies
// ---------------------------------------------------------------------------

const FORM_COLOURS = {
  W: '#16a34a',
  D: '#9ca3af',
  L: '#dc2626',
} as const;

function FormSparkline({ form }: { form: string }) {
  const chars = form
    .slice(-5)
    .split('')
    .filter((c): c is keyof typeof FORM_COLOURS => c in FORM_COLOURS);

  if (chars.length === 0) return null;

  const w = chars.length * 9 - 2;

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
// Zone logic
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

function formatGD(gd: number): string {
  if (gd > 0) return `+${gd}`;
  return String(gd);
}

const COMPACT_CONTEXT = 3;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface LeagueTableProps {
  compact?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LeagueTable({ compact = false }: LeagueTableProps) {
  const gameState    = useGameStore(selectGameState);
  const selectClub   = useUiStore((s) => s.selectClub);

  const tier         = gameState?.playerClub?.currentTier;
  const playerClubId = gameState?.playerClubId;

  const rows = useMemo<StandingsRow[]>(() => {
    const raw: StandingsRow[] = (tier ? gameState?.standings[tier] : undefined) ?? [];

    const seen = new Set<string>();
    return raw
      .filter((row) => {
        if (seen.has(row.clubId)) return false;
        seen.add(row.clubId);
        return true;
      })
      .map((row, idx) =>
        row.position > 0 ? row : { ...row, position: idx + 1 }
      );
  }, [gameState, tier]);

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

  const promotionEnd = TIER_CONFIG[tier].autoPromotionSlots;
  const playoffEnd   = promotionEnd + TIER_CONFIG[tier].playoffEntrants;
  const relegStart   = TIER_CONFIG[tier].clubCount - TIER_CONFIG[tier].autoRelegationSlots + 1;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
      <table className="w-full text-xs border-collapse" style={{ tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '26px' }} />
          <col />
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
          {visibleRows.map((row, idx) => {

            if (row === 'separator') {
              return (
                <tr key={`sep-${idx}`} className="border-b border-gray-100 dark:border-gray-800">
                  <td
                    colSpan={9}
                    className="py-1 pl-2.5 text-[9px] text-gray-400 dark:text-gray-600 tracking-widest select-none"
                  >
                    · · ·
                  </td>
                </tr>
              );
            }

            const isPlayer = row.clubId === playerClubId;
            const zone     = getZone(row.position, tier);
            const club     = gameState.clubs[row.clubId];

            const separatorBefore: string | null =
              row.position === promotionEnd + 1 && TIER_CONFIG[tier].playoffEntrants > 0
                ? `Playoff zone (${promotionEnd + 1}–${playoffEnd})`
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
                  <td className="py-1.5 pl-2.5 pr-1 text-gray-400 dark:text-gray-500 text-right">
                    {row.position}
                  </td>
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
                  {[row.played, row.won, row.drawn, row.lost].map((val, i) => (
                    <td key={i} className="py-1.5 px-1.5 text-right text-gray-500 dark:text-gray-400">
                      {val}
                    </td>
                  ))}
                  <td className={`py-1.5 px-1.5 text-right font-medium
                    ${row.goalDifference > 0 ? 'text-green-600 dark:text-green-400' :
                      row.goalDifference < 0 ? 'text-red-500 dark:text-red-400' :
                      'text-gray-400 dark:text-gray-500'}`}>
                    {formatGD(row.goalDifference)}
                  </td>
                  <td className="py-1.5 px-1.5 text-right">
                    <div className="flex justify-end">
                      <FormSparkline form={row.form} />
                    </div>
                  </td>
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
    </div>
  );
}
