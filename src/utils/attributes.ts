/**
 * src/utils/attributes.ts
 *
 * Pure utility functions that derive secondary values from raw player attributes.
 * No side effects, no imports from the service layer — safe to call anywhere.
 */

import type { PlayerAttributes, IntelligenceProfile } from '../types';

// ---------------------------------------------------------------------------
// Intelligence → Modifiers
// ---------------------------------------------------------------------------

/**
 * Converts the raw `intelligence` stat [0–100] into the two runtime
 * multipliers the match engine uses:
 *
 *   findSpaceModifier    — scales chance of receiving a pass inside the box
 *   interceptionModifier — scales passive passing-lane cut chance (NOT tackling)
 *
 * Both map linearly to the range [0.5, 1.5] so that:
 *   • A player with intelligence=0  has half the base rate  (0.5×)
 *   • A player with intelligence=50 has the exact base rate (1.0×)
 *   • A player with intelligence=100 has 1.5× the base rate
 */
export function deriveIntelligenceProfile(intelligence: number): IntelligenceProfile {
  const clamped = Math.max(0, Math.min(100, intelligence));
  const normalized = clamped / 100; // 0.0 → 1.0
  const modifier = 0.5 + normalized * 1.0; // 0.5 → 1.5

  return {
    findSpaceModifier: modifier,
    interceptionModifier: modifier,
  };
}

// ---------------------------------------------------------------------------
// Current Ability (CA)
// ---------------------------------------------------------------------------

/**
 * Collapses all eight raw attributes into a single "Current Ability" number
 * (0–100) that can be used for sorting, scouting filters, and transfer
 * valuations.
 *
 * Goalkeepers: goalkeeping dominates (60 % weight) with outfield as secondary.
 * Outfield players: even spread across the seven outfield stats.
 *
 * The heuristic for detecting goalkeepers is a goalkeeping score > 60, which
 * is set by the world generator for all GK-position players.
 */
export function calculateCurrentAbility(attributes: PlayerAttributes): number {
  const {
    pace,
    finishing,
    passing,
    dribbling,
    defending,
    physical,
    goalkeeping,
    intelligence,
  } = attributes;

  const outfieldAvg =
    (pace + finishing + passing + dribbling + defending + physical + intelligence) / 7;

  // GK path: treat goalkeeping as the primary skill
  if (goalkeeping > 60) {
    return Math.round(goalkeeping * 0.6 + outfieldAvg * 0.4);
  }

  // Outfield path
  return Math.round(outfieldAvg);
}

// ---------------------------------------------------------------------------
// Potential Ability (PA) helper
// ---------------------------------------------------------------------------

/**
 * Given a player's age and current CA, estimates a rough potential ceiling.
 * Used by the scouting screen to surface young high-potential players.
 *
 * Younger players get a wider potential band; 30+ players are considered
 * peaked (PA ≈ CA).
 */
export function estimatePotentialAbility(
  currentAbility: number,
  age: number
): number {
  if (age >= 30) return currentAbility;

  // Growth band narrows linearly: age 16 → +25 max, age 29 → +2 max
  const maxGrowth = Math.round(25 * (1 - (age - 16) / 13));
  return Math.min(100, currentAbility + maxGrowth);
}

// ---------------------------------------------------------------------------
// Attribute display helpers
// ---------------------------------------------------------------------------

/**
 * Converts a raw attribute [0–100] to a colour token for UI badges.
 * Mirrors the colour thresholds used in Football Manager-style tools.
 */
export function attributeToColour(value: number): 'green' | 'yellow' | 'orange' | 'red' {
  if (value >= 75) return 'green';
  if (value >= 55) return 'yellow';
  if (value >= 35) return 'orange';
  return 'red';
}

/**
 * Returns the six "radar" attributes used on the player comparison chart.
 * Values are normalised to [0, 1] for Chart.js.
 */
export function toRadarDataset(
  attributes: PlayerAttributes
): { label: string; value: number }[] {
  const raw: [string, number][] = [
    ['Pace',       attributes.pace],
    ['Finishing',  attributes.finishing],
    ['Passing',    attributes.passing],
    ['Dribbling',  attributes.dribbling],
    ['Defending',  attributes.defending],
    ['Physical',   attributes.physical],
    ['Intelligence', attributes.intelligence],
  ];

  return raw.map(([label, value]) => ({ label, value: value / 100 }));
}
