/**
 * src/components/dashboard/NextFixtureCard.tsx
 *
 * Displays the manager's next scheduled fixture with:
 *   - Home vs Away matchup (club crests via initials)
 *   - Last-5 form sparklines for both sides
 *   - Fixture metadata: date, venue, match context (league / playoff leg / final)
 *   - Readiness chips: formation set, injuries in XI, tactics confirmed
 *
 * State sources (read-only):
 *   - gameState.nextFixture       → the Fixture
 *   - gameState.clubs             → opponent lookup
 *   - gameState.standings[tier]   → opponent form
 *   - gameState.players           → injury check on startingXI
 *   - gameState.playerClub.tactics → lineup validation
 *
 * Architecture: pure read — no writes to any store or service.
 */

import React from 'react';
import { useGameStore, selectGameState, selectManagerClub } from '../../store/gameStore';
import type { MatchContext } from '../../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMatchDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function contextLabel(ctx: MatchContext): string {
  switch (ctx.type) {
    case 'league':        return 'League';
    case 'playoff_semi':  return `Playoff semi — leg ${ctx.leg}`;
    case 'playoff_final': return 'Playoff final';
  }
}

const FORM_COLOURS: Record<string, string> = {
  W: '#16a34a',
  D: '#9ca3af',
  L: '#dc2626',
};

/**
 * Tiny 5-dot form sparkline — raw SVG, no library.
 *
 * FIX: guard against empty form string (pre-season / new club).
 * An empty string produces `chars.length * 9 - 2 = -2` which SVG rejects.
 * Return null until at least one result exists.
 */
function MiniForm({ form }: { form: string }) {
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
      style={{ display: 'block', overflow: 'visible' }}
    >
      {chars.map((c, i) => (
        <circle
          key={i}
          cx={i * 9 + 4}
          cy={4}
          r={3}
          fill={FORM_COLOURS[c] ?? FORM_COLOURS.D}
        />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Readiness chip
// ---------------------------------------------------------------------------

type ChipVariant = 'good' | 'warn' | 'bad';

interface Chip {
  label:   string;
  variant: ChipVariant;
}

const CHIP_STYLES: Record<ChipVariant, string> = {
  good: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800',
  warn: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800',
  bad:  'bg-red-50  dark:bg-red-900/20   text-red-700   dark:text-red-400   border-red-200   dark:border-red-800',
};

function ReadinessChip({ label, variant }: Chip) {
  return (
    <div className={`flex-1 py-1.5 rounded-md text-center text-[10px] font-medium border ${CHIP_STYLES[variant]}`}>
      {label}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Readiness derivation
// ---------------------------------------------------------------------------

function deriveReadinessChips(
  gameState: NonNullable<ReturnType<typeof selectGameState>>
): Chip[] {
  const tactics  = gameState.playerClub.tactics;
  const startXI  = tactics.startingXI;
  const players  = gameState.players;

  const formationOk = startXI.length === 11;

  const injuredInXI = startXI.filter((pid) => {
    const p = players[pid];
    return p && (p.status === 'injured' || p.status === 'suspended');
  });

  const chips: Chip[] = [
    {
      label:   formationOk ? 'Formation set' : 'Formation missing',
      variant: formationOk ? 'good' : 'bad',
    },
  ];

  if (injuredInXI.length === 0) {
    chips.push({ label: 'XI fully fit', variant: 'good' });
  } else if (injuredInXI.length === 1) {
    chips.push({ label: '1 injured in XI', variant: 'warn' });
  } else {
    chips.push({ label: `${injuredInXI.length} injured in XI`, variant: 'bad' });
  }

  chips.push({
    label:   formationOk ? 'Tactics set' : 'Tactics missing',
    variant: formationOk ? 'good' : 'warn',
  });

  return chips;
}

// ---------------------------------------------------------------------------
// Team badge
// ---------------------------------------------------------------------------

function TeamBadge({ shortName, isHome }: { shortName: string; isHome: boolean }) {
  return (
    <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-medium
      ${isHome
        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
      }`}>
      {shortName.slice(0, 3).toUpperCase()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NextFixtureCard() {
  const gameState = useGameStore(selectGameState);
  const club      = useGameStore(selectManagerClub);

  if (!gameState || !club) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <p className="text-sm text-gray-400 text-center">No upcoming fixture</p>
      </div>
    );
  }

  const fixture = gameState.nextFixture;

  if (!fixture) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <p className="text-sm text-gray-400 text-center py-4">
          No fixtures scheduled — awaiting next phase
        </p>
      </div>
    );
  }

  const isHome     = fixture.homeClubId === club.id;
  const opponentId = isHome ? fixture.awayClubId : fixture.homeClubId;
  const opponent   = gameState.clubs[opponentId];
  const tierRows   = gameState.standings[club.currentTier] ?? [];

  const myRow  = tierRows.find((r) => r.clubId === club.id);
  const oppRow = tierRows.find((r) => r.clubId === opponentId);

  const homeClub = isHome ? club : opponent;
  const awayClub = isHome ? opponent : club;
  const homeRow  = isHome ? myRow : oppRow;
  const awayRow  = isHome ? oppRow : myRow;

  const chips = deriveReadinessChips(gameState);

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">

      {/* Matchup */}
      <div className="flex items-center justify-center gap-4 px-5 pt-4 pb-3">

        {/* Home side */}
        <div className="flex flex-col items-center gap-1.5 flex-1">
          <TeamBadge shortName={homeClub?.shortName ?? '??'} isHome />
          <span className="text-xs font-medium text-gray-800 dark:text-gray-200 text-center leading-tight">
            {homeClub?.name ?? 'Home'}
          </span>
          {homeRow && (
            <div className="flex justify-center min-h-[8px]">
              <MiniForm form={homeRow.form} />
            </div>
          )}
        </div>

        {/* VS divider */}
        <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
          <span className="text-lg font-medium text-gray-300 dark:text-gray-600">vs</span>
          <span className="text-[9px] text-gray-400 dark:text-gray-500 uppercase tracking-wider">
            {isHome ? 'Home' : 'Away'}
          </span>
        </div>

        {/* Away side */}
        <div className="flex flex-col items-center gap-1.5 flex-1">
          <TeamBadge shortName={awayClub?.shortName ?? '??'} isHome={false} />
          <span className="text-xs font-medium text-gray-800 dark:text-gray-200 text-center leading-tight">
            {awayClub?.name ?? 'Away'}
          </span>
          {awayRow && (
            <div className="flex justify-center min-h-[8px]">
              <MiniForm form={awayRow.form} />
            </div>
          )}
        </div>
      </div>

      {/* Meta row */}
      <div className="flex justify-center gap-6 px-4 py-2.5 border-t border-gray-100 dark:border-gray-800">
        <div className="text-center">
          <div className="text-[10px] text-gray-400 dark:text-gray-500">Date</div>
          <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mt-0.5">
            {formatMatchDate(fixture.date)}
          </div>
        </div>
        {oppRow && (
          <div className="text-center">
            <div className="text-[10px] text-gray-400 dark:text-gray-500">Opp. position</div>
            <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mt-0.5">
              {oppRow.position}{ordinalSuffix(oppRow.position)}
            </div>
          </div>
        )}
        <div className="text-center">
          <div className="text-[10px] text-gray-400 dark:text-gray-500">Context</div>
          <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mt-0.5">
            {contextLabel(fixture.context)}
          </div>
        </div>
      </div>

      {/* Readiness chips */}
      <div className="flex gap-2 px-3 pb-3">
        {chips.map((chip) => (
          <ReadinessChip key={chip.label} {...chip} />
        ))}
      </div>

    </div>
  );
}

function ordinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] ?? s[v] ?? s[0];
}
