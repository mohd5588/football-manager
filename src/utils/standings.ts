/**
 * src/utils/standings.ts
 *
 * Pure functions for computing and displaying league standings tables.
 *
 * The authoritative standings object lives in the worker.  These helpers
 * are used on the *UI thread* to sort, filter, and annotate the data that
 * Zustand already holds as a plain JS object.
 *
 * Nothing here touches the worker or the store — inputs come in, outputs
 * go out, no side effects.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One row in a standings table as stored in SerializedGameState.standings */
export interface StandingRow {
  clubId:    string;
  clubName:  string;
  tier:      string;
  played:    number;
  won:       number;
  drawn:     number;
  lost:      number;
  goalsFor:  number;
  goalsAgainst: number;
  points:    number;
}

/** Annotation tags shown alongside a club's position in the table */
export type PositionTag =
  | 'champions'          // 1st place
  | 'autoPromote'        // automatic promotion slot
  | 'playoffPlace'       // playoff contention zone
  | 'safe'               // mid-table
  | 'autoRelegate'       // automatic relegation
  | 'nonLeagueRelegate'; // League Two bottom → non-league

export interface AnnotatedRow extends StandingRow {
  position:    number;
  goalDiff:    number;
  tag:         PositionTag;
}

// ---------------------------------------------------------------------------
// Tier zone configs (mirrors TIER_CONFIG in types.ts)
// ---------------------------------------------------------------------------

interface ZoneConfig {
  autoPromote:      number; // rows 1..n are auto-promoted
  playoffStart:     number; // first playoff row (1-indexed)
  playoffEnd:       number; // last  playoff row (1-indexed)
  autoRelegateFrom: number; // first auto-relegation row (1-indexed)
  total:            number; // total clubs in tier
}

const ZONE_CONFIG: Record<string, ZoneConfig> = {
  EPL: {
    autoPromote:      0,
    playoffStart:     0,
    playoffEnd:       0,
    autoRelegateFrom: 18,  // 18th, 19th, 20th relegated
    total:            20,
  },
  Championship: {
    autoPromote:      2,
    playoffStart:     3,
    playoffEnd:       6,
    autoRelegateFrom: 22,  // 22nd, 23rd, 24th relegated
    total:            24,
  },
  LeagueOne: {
    autoPromote:      2,
    playoffStart:     3,
    playoffEnd:       6,
    autoRelegateFrom: 21,  // 21st–24th relegated (4 teams)
    total:            24,
  },
  LeagueTwo: {
    autoPromote:      3,
    playoffStart:     4,
    playoffEnd:       7,
    autoRelegateFrom: 23,  // 23rd, 24th → non-league
    total:            24,
  },
};

// ---------------------------------------------------------------------------
// Core sort
// ---------------------------------------------------------------------------

/**
 * Sort an array of StandingRow objects by the standard Football League rules:
 *   1. Points (desc)
 *   2. Goal difference (desc)
 *   3. Goals scored (desc)
 *   4. Club name (asc) — rarely needed, breaks true ties
 */
export function sortStandings(rows: StandingRow[]): StandingRow[] {
  return [...rows].sort((a, b) => {
    const ptsDiff = b.points - a.points;
    if (ptsDiff !== 0) return ptsDiff;

    const gdA = a.goalsFor - a.goalsAgainst;
    const gdB = b.goalsFor - b.goalsAgainst;
    const gdDiff = gdB - gdA;
    if (gdDiff !== 0) return gdDiff;

    const gfDiff = b.goalsFor - a.goalsFor;
    if (gfDiff !== 0) return gfDiff;

    return a.clubName.localeCompare(b.clubName);
  });
}

// ---------------------------------------------------------------------------
// Annotation
// ---------------------------------------------------------------------------

/**
 * Take a raw standings array (already sorted), add `position`, `goalDiff`,
 * and `tag` to each row, and return the annotated version.
 *
 * The `tier` parameter determines which zone boundaries to apply.
 */
export function annotateStandings(
  rows: StandingRow[],
  tier: string
): AnnotatedRow[] {
  const sorted = sortStandings(rows);
  const cfg    = ZONE_CONFIG[tier];

  return sorted.map((row, i) => {
    const position = i + 1; // 1-indexed
    const goalDiff = row.goalsFor - row.goalsAgainst;

    let tag: PositionTag = 'safe';

    if (!cfg) {
      // Unknown tier — no annotations
    } else if (position === 1 && cfg.autoPromote >= 1) {
      tag = 'champions';
    } else if (position <= cfg.autoPromote) {
      tag = 'autoPromote';
    } else if (cfg.playoffStart > 0 && position >= cfg.playoffStart && position <= cfg.playoffEnd) {
      tag = 'playoffPlace';
    } else if (position >= cfg.autoRelegateFrom) {
      tag = tier === 'LeagueTwo' ? 'nonLeagueRelegate' : 'autoRelegate';
    }

    return { ...row, position, goalDiff, tag };
  });
}

// ---------------------------------------------------------------------------
// Promotion / relegation helpers (used by the Season Reset in Phase 3)
// ---------------------------------------------------------------------------

/**
 * Returns the club IDs that are automatically promoted from a given tier.
 * Call this AFTER sorting — position is assumed from array index.
 */
export function getAutoPromotedIds(rows: StandingRow[], tier: string): string[] {
  const cfg = ZONE_CONFIG[tier];
  if (!cfg || cfg.autoPromote === 0) return [];

  const sorted = sortStandings(rows);
  return sorted.slice(0, cfg.autoPromote).map((r) => r.clubId);
}

/**
 * Returns the club IDs that qualify for the promotion playoffs.
 */
export function getPlayoffIds(rows: StandingRow[], tier: string): string[] {
  const cfg = ZONE_CONFIG[tier];
  if (!cfg || cfg.playoffStart === 0) return [];

  const sorted = sortStandings(rows);
  // playoffStart/End are 1-indexed
  return sorted
    .slice(cfg.playoffStart - 1, cfg.playoffEnd)
    .map((r) => r.clubId);
}

/**
 * Returns the club IDs that are automatically relegated from a given tier.
 */
export function getAutoRelegatedIds(rows: StandingRow[], tier: string): string[] {
  const cfg = ZONE_CONFIG[tier];
  if (!cfg) return [];

  const sorted = sortStandings(rows);
  return sorted
    .slice(cfg.autoRelegateFrom - 1) // autoRelegateFrom is 1-indexed
    .map((r) => r.clubId);
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Format goal difference with a leading + for positive values. */
export function formatGD(gd: number): string {
  if (gd > 0) return `+${gd}`;
  return String(gd);
}

/** Colour class for the position tag badge. */
export const TAG_COLOURS: Record<PositionTag, string> = {
  champions:         'bg-amber-400  text-amber-950',
  autoPromote:       'bg-green-500  text-white',
  playoffPlace:      'bg-sky-500    text-white',
  safe:              'bg-gray-700   text-gray-300',
  autoRelegate:      'bg-red-600    text-white',
  nonLeagueRelegate: 'bg-red-900    text-red-200',
};

/** Short label shown in the position tag badge. */
export const TAG_LABELS: Record<PositionTag, string> = {
  champions:         'C',
  autoPromote:       'P',
  playoffPlace:      'PO',
  safe:              '',
  autoRelegate:      'R',
  nonLeagueRelegate: 'R↓',
};
