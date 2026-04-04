/**
 * worldGen.ts — The World Generator
 *
 * Plain English: When you start a new game, this file runs ONCE and
 * creates the entire football world from scratch:
 *   - 92 fictional clubs (20 EPL, 24 Championship, 24 L1, 24 L2)
 *   - ~20 players per club (~1,840 players total)
 *   - Realistic attribute distributions per tier
 *   - Geography-based fictional names (e.g. "Preston Rovers")
 *
 * It uses a "seed" number so the same seed always produces the exact
 * same world — useful for debugging and for sharing worlds with friends.
 */

import {
  Tier,
  TIER_CONFIG,
  type Club,
  type Player,
  type EntityId,
  type PlayerAttributes,
  type Position,
  type Formation,
  type Mentality,
  type WorldGenConfig,
} from '../../types';

// ─────────────────────────────────────────────────────────────────────────────
// § 1 · Seeded Random Number Generator (Mulberry32 algorithm)
// ─────────────────────────────────────────────────────────────────────────────

type Rng = () => number;

function createRng(seed: number): Rng {
  let s = seed >>> 0;
  return function (): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(arr: readonly T[], rng: Rng): T {
  return arr[Math.floor(rng() * arr.length)];
}

function randInt(min: number, max: number, rng: Rng): number {
  return min + Math.floor(rng() * (max - min + 1));
}

// ─────────────────────────────────────────────────────────────────────────────
// § 2 · Name Data — Geography & Nicknames
// ─────────────────────────────────────────────────────────────────────────────

const CITIES_BY_REGION: Record<string, readonly string[]> = {
  north_west: ['Manchester', 'Liverpool', 'Preston', 'Blackburn', 'Bolton', 'Burnley', 'Wigan', 'Oldham', 'Chester', 'Carlisle', 'Blackpool', 'Lancaster'],
  north_east: ['Newcastle', 'Sunderland', 'Middlesbrough', 'Hartlepool', 'Darlington', 'Durham', 'Stockton', 'Gateshead', 'Whitby'],
  yorkshire:  ['Leeds', 'Sheffield', 'Bradford', 'Hull', 'Huddersfield', 'Doncaster', 'Rotherham', 'York', 'Barnsley', 'Wakefield', 'Harrogate'],
  midlands:   ['Birmingham', 'Nottingham', 'Leicester', 'Derby', 'Coventry', 'Wolverhampton', 'Stoke', 'Shrewsbury', 'Walsall', 'Burton', 'Crewe'],
  east:       ['Norwich', 'Ipswich', 'Cambridge', 'Peterborough', 'Colchester', 'Southend', 'Luton', 'Northampton', 'Stevenage'],
  london:     ['Woolwich', 'Whitechapel', 'Highbury', 'Battersea', 'Bermondsey', 'Stratford', 'Fulham', 'Wimbledon', 'Millwall', 'Lewisham', 'Tottenham'],
  south_east: ['Brighton', 'Southampton', 'Portsmouth', 'Reading', 'Watford', 'Oxford', 'Crawley', 'Gillingham', 'Brentford'],
  south_west: ['Bristol', 'Exeter', 'Plymouth', 'Swindon', 'Gloucester', 'Cheltenham', 'Yeovil', 'Torquay'],
  wales:      ['Cardiff', 'Swansea', 'Newport', 'Wrexham', 'Aberystwyth'],
};

const NICKNAMES: readonly string[] = [
  'City', 'United', 'Town', 'Rovers', 'Wanderers',
  'Athletic', 'FC', 'County', 'Rangers', 'Albion',
  'Vale', 'Orient', 'Stanley', 'Alexandra',
];

function toShortName(name: string): string {
  const words = name.split(' ');
  if (words.length === 1) return name.slice(0, 3).toUpperCase();
  if (words[words.length - 1] === 'FC') {
    return words[0].slice(0, 3).toUpperCase();
  }
  return (words[0][0] + words[1].slice(0, 2)).toUpperCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// § 3 · Player Name Data
// ─────────────────────────────────────────────────────────────────────────────

const FIRST_NAMES: readonly string[] = [
  'James', 'Oliver', 'Harry', 'George', 'Jack', 'Noah', 'Charlie', 'Jacob',
  'Alfie', 'Freddie', 'Oscar', 'Ethan', 'Archie', 'Leo', 'Thomas', 'Henry',
  'William', 'Daniel', 'Samuel', 'Lucas', 'Mason', 'Logan', 'Kai', 'Reuben',
  'Mohammed', 'Ibrahim', 'Yusuf', 'Mateo', 'Luca', 'Tyler', 'Nathan', 'Ryan',
  'Dylan', 'Callum', 'Cameron', 'Kieran', 'Connor', 'Declan', 'Rhys', 'Liam',
];

const LAST_NAMES: readonly string[] = [
  'Smith', 'Jones', 'Williams', 'Taylor', 'Brown', 'Davies', 'Evans',
  'Wilson', 'Thomas', 'Roberts', 'Johnson', 'White', 'Harris', 'Martin',
  'Thompson', 'Robinson', 'Clark', 'Lewis', 'Walker', 'Hall',
  'Allen', 'Young', 'King', 'Wright', 'Scott', 'Adams', 'Baker', 'Green',
  'Hill', 'Turner', 'Phillips', 'Campbell', 'Parker', 'Edwards', 'Collins',
];

// ─────────────────────────────────────────────────────────────────────────────
// § 4 · Attribute Generation
// ─────────────────────────────────────────────────────────────────────────────

function gaussianRandom(rng: Rng, mean: number, stdDev: number): number {
  const u1 = Math.max(1e-10, rng());
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.round(Math.max(1, Math.min(99, mean + z * stdDev)));
}

function generateAttributes(rng: Rng, mean: number, position: Position): PlayerAttributes {
  const base = (boost = 0) => gaussianRandom(rng, mean + boost, 8);

  const isGK  = position === 'GK';
  const isDef = ['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(position);
  const isMid = ['CDM', 'CM', 'CAM', 'LM', 'RM'].includes(position);
  const isFwd = ['LW', 'RW', 'CF', 'ST'].includes(position);

  return {
    pace:         isFwd ? base(8)  : isDef ? base(-6) : base(),
    finishing:    isFwd ? base(10) : isGK  ? base(-20) : isDef ? base(-8) : base(-2),
    passing:      isMid ? base(8)  : isGK  ? base(-5)  : base(),
    dribbling:    isFwd || isMid ? base(4) : isDef ? base(-4) : base(-10),
    defending:    isDef ? base(10) : isFwd ? base(-10) : isMid ? base(-2) : base(-20),
    physical:     isDef ? base(6)  : base(),
    goalkeeping:  isGK  ? base(15) : base(-25),
    intelligence: base(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// § 5 · Squad Template & Player Generation
// ─────────────────────────────────────────────────────────────────────────────

const SQUAD_POSITIONS: readonly Position[] = [
  // Starting XI (indices 0–10)
  'GK',
  'CB', 'CB', 'LB', 'RB',
  'CDM', 'CM', 'CM',
  'LW', 'RW', 'ST',
  // Squad / Bench (indices 11–19)
  'GK',
  'CB', 'LB',
  'CM', 'CAM',
  'LW', 'ST',
  'CDM', 'RB',
];

function generatePlayer(
  rng: Rng,
  clubId: EntityId,
  position: Position,
  tierMean: number,
): Player {
  const age        = randInt(17, 34, rng);
  const attributes = generateAttributes(rng, tierMean, position);

  const allValues      = Object.values(attributes);
  const currentAbility = Math.round(allValues.reduce((a, b) => a + b, 0) / allValues.length);

  const potentialBonus = age < 23 ? randInt(5, 25, rng) : randInt(0, 8, rng);
  const potential      = Math.min(99, currentAbility + potentialBonus);

  // Weekly wage: ability * £200/week. An EPL star (80 OVR) earns ~£16k/wk.
  const weeklyWage = currentAbility * 200;

  return {
    id:              crypto.randomUUID(),
    clubId,
    name:            `${pick(FIRST_NAMES, rng)} ${pick(LAST_NAMES, rng)}`,
    age,
    position,
    attributes,
    currentAbility,
    potential,
    status:          'active',
    unavailableWeeks: 0,
    weeklyWage,
    seasonStats: {
      appearances:   0,
      goals:         0,
      assists:       0,
      cleanSheets:   0,
      yellowCards:   0,
      redCards:      0,
      averageRating: 0,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// § 6 · Club Finances — Tier-scaled starting budgets
// ─────────────────────────────────────────────────────────────────────────────

interface TierFinanceBase {
  balance:        number;
  wageBill:       number;
  transferBudget: number;
  stadiumRevenue: number;
}

const FINANCE_BASES: Record<Tier, TierFinanceBase> = {
  [Tier.EPL]:          { balance: 50_000_000, wageBill: 2_000_000, transferBudget: 20_000_000, stadiumRevenue: 3_000_000 },
  [Tier.Championship]: { balance: 10_000_000, wageBill:   400_000, transferBudget:  3_000_000, stadiumRevenue:   500_000 },
  [Tier.LeagueOne]:    { balance:  2_000_000, wageBill:    80_000, transferBudget:    500_000, stadiumRevenue:   100_000 },
  [Tier.LeagueTwo]:    { balance:    500_000, wageBill:    20_000, transferBudget:    100_000, stadiumRevenue:    30_000 },
};

function generateFinances(tier: Tier, rng: Rng) {
  const base  = FINANCE_BASES[tier];
  const vary  = (v: number) => Math.round(v * (0.5 + rng()));
  return {
    balance:        vary(base.balance),
    wageBill:       vary(base.wageBill),
    transferBudget: vary(base.transferBudget),
    stadiumRevenue: vary(base.stadiumRevenue),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// § 7 · Club Generation
// ─────────────────────────────────────────────────────────────────────────────

interface ClubGenResult {
  club:    Club;
  players: Player[];
}

function generateClub(
  rng:       Rng,
  tier:      Tier,
  usedNames: Set<string>,
): ClubGenResult {
  const regionKey = pick(Object.keys(CITIES_BY_REGION), rng);
  const city      = pick(CITIES_BY_REGION[regionKey], rng);

  let name    = `${city} ${pick(NICKNAMES, rng)}`;
  let attempt = 0;
  while (usedNames.has(name) && attempt < 30) {
    name = `${city} ${pick(NICKNAMES, rng)}`;
    attempt++;
  }
  usedNames.add(name);

  const clubId:   EntityId = crypto.randomUUID();
  const tierMean: number   = TIER_CONFIG[tier].meanAttributeScore;

  const players:    Player[]   = [];
  const startingXI: EntityId[] = [];
  const bench:      EntityId[] = [];

  SQUAD_POSITIONS.forEach((position, index) => {
    const player = generatePlayer(rng, clubId, position, tierMean);
    players.push(player);
    if (index < 11) startingXI.push(player.id);
    else            bench.push(player.id);
  });

  const club: Club = {
    id:            clubId,
    name,
    shortName:     toShortName(name),
    city,
    region:        regionKey,
    tier,
    currentTier:   tier,
    isPlayerManaged: false,
    tactics: {
      formation:      '4-3-3' as Formation,
      mentality:      'balanced' as Mentality,
      pressIntensity: 'medium',
      startingXI,
      bench: bench.slice(0, 5),
    },
    finances: generateFinances(tier, rng),
  };

  return { club, players };
}

// ─────────────────────────────────────────────────────────────────────────────
// § 8 · Main Export — generateWorld()
// ─────────────────────────────────────────────────────────────────────────────

export interface WorldGenResult {
  clubs:   Record<EntityId, Club>;
  players: Record<EntityId, Player>;
}

const TIER_CLUB_COUNTS: [Tier, number][] = [
  [Tier.EPL,          20],
  [Tier.Championship, 24],
  [Tier.LeagueOne,    24],
  [Tier.LeagueTwo,    24],
];

export function generateWorld(config: WorldGenConfig): WorldGenResult {
  const rng       = createRng(config.seed);
  const usedNames = new Set<string>();

  const clubs:   Record<EntityId, Club>   = {};
  const players: Record<EntityId, Player> = {};

  for (const [tier, count] of TIER_CLUB_COUNTS) {
    for (let i = 0; i < count; i++) {
      const { club, players: squad } = generateClub(rng, tier, usedNames);
      clubs[club.id] = club;
      for (const player of squad) {
        players[player.id] = player;
      }
    }
  }

  console.log(
    `[worldGen] Generated ${Object.keys(clubs).length} clubs` +
    ` and ${Object.keys(players).length} players` +
    ` with seed ${config.seed}`
  );

  return { clubs, players };
}
