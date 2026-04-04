/**
 * ============================================================================
 * FOOTBALL PYRAMID MANAGER — WORKER COMMUNICATION CONTRACT
 * types.ts — Single source of truth for all cross-thread types
 *
 * ARCHITECTURE NOTE:
 *   The Web Worker owns the *authoritative* GameState.
 *   The Zustand store owns a *projected* ClientGameState (read-only mirror).
 *   The Service Layer is the sole mediator — UI components never call
 *   postMessage directly.
 *
 *   postMessage boundary: only SerializedGameState crosses the wire.
 *   ClientGameState is constructed on the main thread from SerializedGameState
 *   by the Service Layer, which may attach derived/computed fields.
 * ============================================================================
 */

// ─────────────────────────────────────────────────────────────────────────────
// § 0 · PRIMITIVES & UTILITY TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** A value in [0, 100] representing a player attribute. */
export type AttributeScore = number;

/** ISO-8601 date string (e.g. "2025-08-09"). Used across the wire. */
export type ISODateString = string;

/** Stable UUID for all persistent entities. */
export type EntityId = string;

/** 0–100 inclusive. Used for simulation progress reporting. */
export type ProgressPercent = number;

// ─────────────────────────────────────────────────────────────────────────────
// § 1 · ENGLISH FOOTBALL PYRAMID
// ─────────────────────────────────────────────────────────────────────────────

export enum Tier {
  EPL          = "EPL",           // 20 clubs
  Championship = "Championship",  // 24 clubs
  LeagueOne    = "LeagueOne",     // 24 clubs
  LeagueTwo    = "LeagueTwo",     // 24 clubs
}

/** Metadata that stays constant for the lifetime of a tier. */
export interface TierConfig {
  readonly tier:              Tier;
  readonly clubCount:         number;
  readonly autoPromotionSlots: number; // Top N go up automatically
  readonly autoRelegationSlots: number; // Bottom N go down automatically
  readonly playoffEntrants:   number; // Teams that enter the playoff bracket
  readonly playoffSlots:      number; // Additional promotion spots via playoffs
  /**
   * Mean attribute score used during world-generation to bias
   * the normal distribution for clubs in this tier.
   */
  readonly meanAttributeScore: AttributeScore;
}

export const TIER_CONFIG: Readonly<Record<Tier, TierConfig>> = {
  [Tier.EPL]: {
    tier:               Tier.EPL,
    clubCount:          20,
    autoPromotionSlots: 0,
    autoRelegationSlots: 3,
    playoffEntrants:    0,
    playoffSlots:       0,
    meanAttributeScore: 80,
  },
  [Tier.Championship]: {
    tier:               Tier.Championship,
    clubCount:          24,
    autoPromotionSlots: 2,
    autoRelegationSlots: 3,
    playoffEntrants:    4,  // 3rd–6th
    playoffSlots:       1,
    meanAttributeScore: 68,
  },
  [Tier.LeagueOne]: {
    tier:               Tier.LeagueOne,
    clubCount:          24,
    autoPromotionSlots: 2,
    autoRelegationSlots: 4,
    playoffEntrants:    4,  // 3rd–6th
    playoffSlots:       1,
    meanAttributeScore: 60,
  },
  [Tier.LeagueTwo]: {
    tier:               Tier.LeagueTwo,
    clubCount:          24,
    autoPromotionSlots: 3,
    autoRelegationSlots: 2,  // Drop to Non-League (inactive)
    playoffEntrants:    4,  // 4th–7th
    playoffSlots:       1,
    meanAttributeScore: 55,
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// § 2 · PLAYER ATTRIBUTES & INTELLIGENCE PROFILE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The Core 8 player attributes.
 * All values are in [0, 100].
 *
 * INTELLIGENCE — The "off-the-ball" composite attribute.
 *   In attack: multiplier for "Finding Space" — raises the probability that
 *              this player receives a pass inside the penalty area.
 *   In defense: multiplier for "Interception Chance" — cuts passing lanes
 *               (passive anticipation, NOT manual tackling).
 *   See `deriveIntelligenceProfile()` in the Worker for runtime expansion.
 */
export interface PlayerAttributes {
  /** Sprint speed and acceleration. */
  readonly pace:         AttributeScore;
  /** Shot quality and conversion rate. */
  readonly finishing:    AttributeScore;
  /** Short/long passing accuracy and range. */
  readonly passing:      AttributeScore;
  /** Ball control and 1v1 beating ability. */
  readonly dribbling:    AttributeScore;
  /** Tackling, marking, and aerial duels. */
  readonly defending:    AttributeScore;
  /** Strength, stamina, and aerial dominance. */
  readonly physical:     AttributeScore;
  /** Handling, distribution, and shot-stopping (GK primary). */
  readonly goalkeeping:  AttributeScore;
  /**
   * Positioning & anticipation.
   * Dual-use modifier — context-dependent (see doc above).
   */
  readonly intelligence: AttributeScore;
}

/**
 * Derived at runtime inside the Worker from `PlayerAttributes.intelligence`.
 * Never persisted; never sent across the wire raw — computed on demand.
 */
export interface IntelligenceProfile {
  /** Multiplier applied to in-box pass-reception probability. */
  readonly findSpaceModifier:    number;
  /** Multiplier applied to passive passing-lane cut probability. */
  readonly interceptionModifier: number;
}

export type Position =
  | "GK"
  | "CB" | "LB" | "RB" | "LWB" | "RWB"
  | "CDM" | "CM" | "CAM"
  | "LM" | "RM" | "LW" | "RW"
  | "CF" | "ST";

export type PlayerStatus = "active" | "injured" | "suspended" | "regen";

export interface Player {
  readonly id:          EntityId;
  /** Mutable — changes on transfer. */
  clubId:               EntityId;
  readonly name:        string;
  /** Mutable — increments each season during off_season. */
  age:                  number;
  readonly position:    Position;
  readonly attributes:  PlayerAttributes;
  /** Current ability — may diverge from potential mid-season. */
  readonly currentAbility: AttributeScore;
  readonly potential:      AttributeScore;
  readonly status:         PlayerStatus;
  /** Weeks remaining if injured/suspended; 0 otherwise. */
  readonly unavailableWeeks: number;
  /** Weekly wage in GBP. */
  weeklyWage:           number;
  /** Season stats accumulated so far. */
  readonly seasonStats: PlayerSeasonStats;
}

export interface PlayerSeasonStats {
  appearances:  number;
  goals:        number;
  assists:      number;
  cleanSheets:  number;
  yellowCards:  number;
  redCards:     number;
  averageRating: number; // rolling mean, 0–10
}

// ─────────────────────────────────────────────────────────────────────────────
// § 3 · CLUBS & TACTICS
// ─────────────────────────────────────────────────────────────────────────────

export type Formation =
  | "4-4-2" | "4-3-3" | "4-2-3-1" | "3-5-2"
  | "5-3-2" | "4-5-1" | "3-4-3"  | "4-1-4-1";

export type Mentality = "ultra-defensive" | "defensive" | "balanced" | "attacking" | "ultra-attacking";

export type PressIntensity = "low" | "medium" | "high" | "gegenpressing";

export interface Tactics {
  readonly formation:      Formation;
  readonly mentality:      Mentality;
  readonly pressIntensity: PressIntensity;
  /** Player IDs in positional order (index 0 = GK, 1–10 = outfield). */
  readonly startingXI:     readonly EntityId[];
  /** Up to 5 bench slots. */
  readonly bench:          readonly EntityId[];
}

export interface ClubFinances {
  balance:        number;  // GBP
  wageBill:       number;  // per week GBP (sum of all player weeklyWage)
  transferBudget: number;  // GBP
  stadiumRevenue: number;  // per match day GBP
}

export interface Club {
  readonly id:      EntityId;
  readonly name:    string;
  readonly shortName: string; // e.g. "LFC" — 3–4 chars
  readonly city:    string;
  readonly region:  string;
  readonly tier:    Tier;
  /** The tier this club is assigned to in the CURRENT season. */
  currentTier:      Tier;
  tactics:          Tactics;
  readonly finances: ClubFinances;
  /** Whether this club is controlled by the human player. */
  isPlayerManaged:  boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 4 · SCHEDULE, FIXTURES & STANDINGS
// ─────────────────────────────────────────────────────────────────────────────

export type MatchStatus = "scheduled" | "in_progress" | "completed" | "postponed";

export type MatchContext =
  | { type: "league" }
  | { type: "playoff_semi";  leg: 1 | 2; aggregateId: EntityId }
  | { type: "playoff_final"; neutralGround: true };

export interface Fixture {
  readonly id:          EntityId;
  readonly homeClubId:  EntityId;
  readonly awayClubId:  EntityId;
  readonly date:        ISODateString;
  readonly tier:        Tier;
  readonly context:     MatchContext;
  status:               MatchStatus;
  result?:              MatchResult;
}

export interface MatchResult {
  readonly fixtureId:  EntityId;
  readonly homeGoals:  number;
  readonly awayGoals:  number;
  readonly homexG:     number;
  readonly awayxG:     number;
  readonly attendance: number;
}

export interface StandingsRow {
  readonly clubId:    EntityId;
  position:           number;
  played:             number;
  won:                number;
  drawn:              number;
  lost:               number;
  goalsFor:           number;
  goalsAgainst:       number;
  goalDifference:     number;
  points:             number;
  /** Last 5 results: 'W' | 'D' | 'L' */
  form:               string;
}

export type Standings = Record<Tier, StandingsRow[]>;

// ─────────────────────────────────────────────────────────────────────────────
// § 5 · PLAYOFF ENGINE TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type PlayoffRound = "semi_first_leg" | "semi_second_leg" | "final";

export interface PlayoffTie {
  readonly id:            EntityId;
  readonly tier:          Tier;
  readonly round:         PlayoffRound;
  readonly homeClubId:    EntityId;
  readonly awayClubId:    EntityId;
  firstLegResult?:        MatchResult;
  secondLegResult?:       MatchResult;
  aggregateHome?:         number;
  aggregateAway?:         number;
  penaltyWinnerId?:       EntityId;
  winnerId?:              EntityId;
}

export interface PlayoffBracket {
  readonly tier:   Tier;
  readonly season: number;
  ties:            PlayoffTie[];
  winnerId?:       EntityId;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 5b · TRANSFER MARKET
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A bid made by an AI club for one of the player-manager's players.
 * Lives in SerializedGameState.pendingBids — persists across saves.
 */
export interface TransferBid {
  readonly id:          EntityId;
  /** The player being targeted (always in the manager's squad). */
  readonly playerId:    EntityId;
  /** The AI club making the bid. */
  readonly fromClubId:  EntityId;
  /** Offered transfer fee in GBP. */
  readonly fee:         number;
  /** Proposed weekly wage in GBP the buying club will pay. */
  readonly weeklyWage:  number;
  /** Date the bid was generated (ISO). */
  readonly createdDate: ISODateString;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 6 · THE AUTHORITATIVE GAME STATE (lives in the Worker)
// ─────────────────────────────────────────────────────────────────────────────

export type SeasonPhase =
  | "pre_season"
  | "regular_season"
  | "playoffs"
  | "off_season";

/**
 * SerializedGameState — the wire format.
 *
 * RULES:
 *  - No functions, no class instances, no Maps (use Record<K,V>), no Sets.
 *  - All values must survive JSON.stringify ↔ JSON.parse round-trips.
 *  - This is what postMessage carries and what IndexedDB stores.
 */
export interface SerializedGameState {
  readonly saveId:     EntityId;
  readonly saveName:   string;
  readonly version:    string; // semver — used for migration guards
  season:              number; // e.g. 2025
  currentDate:         ISODateString;
  phase:               SeasonPhase;
  clubs:               Record<EntityId, Club>;
  players:             Record<EntityId, Player>;
  fixtures:            Record<EntityId, Fixture>;
  standings:           Standings;
  playoffBrackets:     Record<Tier, PlayoffBracket | null>;
  /** Player-managed club ID. */
  playerClubId:        EntityId;
  /** Clubs that dropped to Non-League (inactive) this season. */
  nonLeagueClubIds:    EntityId[];
  /** Pending AI bids for the manager's players. */
  pendingBids:         TransferBid[];
  lastUpdated:         ISODateString;
}

/**
 * ClientGameState — the Zustand mirror.
 *
 * Extends SerializedGameState with derived/UI-only fields.
 * Constructed by the Service Layer; NEVER sent to the Worker.
 */
export interface ClientGameState extends SerializedGameState {
  /** Convenience: the club the human manages. */
  readonly playerClub:        Club;
  /** Next unplayed fixture for the player's club. */
  readonly nextFixture:       Fixture | null;
  /** Derived standings row for the player's club. */
  readonly playerStandingsRow: StandingsRow | null;
  /** Whether a long simulation job is running. */
  isSimulating:               boolean;
  /** Progress of a running SIM_TO_DATE job (0–100). */
  simulationProgress:         ProgressPercent;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 7 · WORKER ACTION CONTRACT (Main Thread → Worker)
// ─────────────────────────────────────────────────────────────────────────────

interface BaseAction {
  readonly jobId: EntityId;
}

export interface InitLeagueAction extends BaseAction {
  readonly type:    "INIT_LEAGUE";
  readonly payload: {
    playerTier:    Tier;
    saveName:      string;
    seed?:         number;
  };
}

export interface SimDayAction extends BaseAction {
  readonly type:    "SIM_DAY";
  readonly payload: Record<string, never>;
}

export interface SimToDateAction extends BaseAction {
  readonly type:    "SIM_TO_DATE";
  readonly payload: {
    targetDate:  ISODateString;
    maxDays?:    number;
  };
}

export interface CancelSimAction extends BaseAction {
  readonly type:    "CANCEL_SIM";
  readonly payload: {
    targetJobId: EntityId;
  };
}

export interface UpdateTacticsAction extends BaseAction {
  readonly type:    "UPDATE_TACTICS";
  readonly payload: {
    clubId:  EntityId;
    tactics: Tactics;
  };
}

export interface SaveGameAction extends BaseAction {
  readonly type:    "SAVE_GAME";
  readonly payload: {
    slotIndex:  0 | 1 | 2 | 3 | 4;
    saveName?:  string;
  };
}

/** Manager buys a player from an AI club. */
export interface MakeTransferOfferAction extends BaseAction {
  readonly type:    "MAKE_TRANSFER_OFFER";
  readonly payload: {
    playerId:   EntityId;
    fee:        number;
    weeklyWage: number;
  };
}

/** Manager accepts an AI club's bid for one of their players. */
export interface AcceptBidAction extends BaseAction {
  readonly type:    "ACCEPT_BID";
  readonly payload: {
    bidId: EntityId;
  };
}

/** Manager rejects an AI club's bid. */
export interface RejectBidAction extends BaseAction {
  readonly type:    "REJECT_BID";
  readonly payload: {
    bidId: EntityId;
  };
}

export type WorkerAction =
  | InitLeagueAction
  | SimDayAction
  | SimToDateAction
  | CancelSimAction
  | UpdateTacticsAction
  | SaveGameAction
  | MakeTransferOfferAction
  | AcceptBidAction
  | RejectBidAction;

// ─────────────────────────────────────────────────────────────────────────────
// § 8 · WORKER RESPONSE CONTRACT (Worker → Main Thread)
// ─────────────────────────────────────────────────────────────────────────────

interface BaseResponse {
  readonly jobId: EntityId;
}

export interface SyncStateResponse extends BaseResponse {
  readonly type:    "SYNC_STATE";
  readonly payload: SerializedGameState;
}

export interface MatchResultResponse extends BaseResponse {
  readonly type:    "MATCH_RESULT";
  readonly payload: MatchReport;
}

export interface ProgressReportResponse extends BaseResponse {
  readonly type:    "PROGRESS_REPORT";
  readonly payload: {
    percent:         ProgressPercent;
    currentDate:     ISODateString;
    matchesSimulated: number;
  };
}

export interface SaveExportResponse extends BaseResponse {
  readonly type:    "SAVE_EXPORT";
  readonly payload: {
    slotIndex:    0 | 1 | 2 | 3 | 4;
    snapshot:     SerializedGameState;
    exportedAt:   ISODateString;
    sizeBytes:    number;
  };
}

export interface WorkerErrorResponse extends BaseResponse {
  readonly type:    "WORKER_ERROR";
  readonly payload: {
    code:     WorkerErrorCode;
    message:  string;
    source:   WorkerAction["type"];
  };
}

export type WorkerErrorCode =
  | "INVALID_ACTION"
  | "STATE_NOT_INITIALIZED"
  | "FIXTURE_NOT_FOUND"
  | "CLUB_NOT_FOUND"
  | "TACTICS_INVALID"
  | "SAVE_FAILED"
  | "SIM_ABORTED"
  | "INTERNAL_ERROR";

export type WorkerResponse =
  | SyncStateResponse
  | MatchResultResponse
  | ProgressReportResponse
  | SaveExportResponse
  | WorkerErrorResponse;

// ─────────────────────────────────────────────────────────────────────────────
// § 9 · MATCH REPORT (payload of MATCH_RESULT)
// ─────────────────────────────────────────────────────────────────────────────

export interface MatchEvent {
  readonly minute:    number;
  readonly type:      "goal" | "assist" | "yellow_card" | "red_card" | "substitution" | "penalty_saved";
  readonly playerId:  EntityId;
  readonly clubId:    EntityId;
  readonly relatedPlayerId?: EntityId;
}

export interface ClubMatchStats {
  readonly clubId:      EntityId;
  readonly goals:       number;
  readonly xG:          number;
  readonly shots:       number;
  readonly shotsOnTarget: number;
  readonly possession:  number;
  readonly passes:      number;
  readonly passAccuracy: number;
  readonly tackles:     number;
  readonly interceptions: number;
}

export interface PlayerMatchRating {
  readonly playerId:    EntityId;
  readonly rating:      number;
  readonly goals:       number;
  readonly assists:     number;
  readonly keyPasses:   number;
  readonly tackles:     number;
  readonly interceptions: number;
}

export interface MatchReport {
  readonly fixtureId:     EntityId;
  readonly homeStats:     ClubMatchStats;
  readonly awayStats:     ClubMatchStats;
  readonly events:        readonly MatchEvent[];
  readonly playerRatings: readonly PlayerMatchRating[];
  readonly motmPlayerId:  EntityId;
  readonly narrativeSummary: readonly string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// § 10 · SAVE / LOAD SLOT MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

export interface SaveSlotMeta {
  readonly slotIndex:   0 | 1 | 2 | 3 | 4;
  readonly saveName:    string;
  readonly season:      number;
  readonly currentDate: ISODateString;
  readonly clubName:    string;
  readonly tier:        Tier;
  readonly savedAt:     ISODateString;
  readonly version:     string;
  readonly sizeBytes:   number;
}

export interface SaveSlotRecord extends SaveSlotMeta {
  readonly snapshot: SerializedGameState;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 11 · SERVICE LAYER INTERFACE
// ─────────────────────────────────────────────────────────────────────────────

export interface ISimulationService {
  initLeague(payload: InitLeagueAction["payload"]): Promise<SyncStateResponse>;
  simDay():                                         Promise<SyncStateResponse>;
  simToDate(payload: SimToDateAction["payload"],
            onProgress?: (r: ProgressReportResponse) => void): Promise<SyncStateResponse>;
  cancelSim(targetJobId: EntityId):                 Promise<void>;
  updateTactics(payload: UpdateTacticsAction["payload"]): Promise<SyncStateResponse>;
  saveGame(payload: SaveGameAction["payload"]):     Promise<SaveExportResponse>;
  previewSaveSlot(slotIndex: SaveSlotMeta["slotIndex"]): Promise<SaveSlotMeta>;
  loadSaveSlot(slotIndex: SaveSlotMeta["slotIndex"]):    Promise<SyncStateResponse>;
  exportSnapshot():                                 Promise<string>;
  importSnapshot(json: string, slotIndex: SaveSlotMeta["slotIndex"]): Promise<SaveSlotMeta>;
  listSaveSlots():                                  Promise<SaveSlotMeta[]>;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 12 · TYPE GUARDS
// ─────────────────────────────────────────────────────────────────────────────

export function isWorkerResponse(v: unknown): v is WorkerResponse {
  return (
    typeof v === "object" &&
    v !== null &&
    "type" in v &&
    ["SYNC_STATE", "MATCH_RESULT", "PROGRESS_REPORT", "SAVE_EXPORT", "WORKER_ERROR"].includes(
      (v as WorkerResponse).type
    )
  );
}

export function isSyncStateResponse(r: WorkerResponse): r is SyncStateResponse {
  return r.type === "SYNC_STATE";
}

export function isMatchResultResponse(r: WorkerResponse): r is MatchResultResponse {
  return r.type === "MATCH_RESULT";
}

export function isProgressReportResponse(r: WorkerResponse): r is ProgressReportResponse {
  return r.type === "PROGRESS_REPORT";
}

export function isSaveExportResponse(r: WorkerResponse): r is SaveExportResponse {
  return r.type === "SAVE_EXPORT";
}

export function isWorkerErrorResponse(r: WorkerResponse): r is WorkerErrorResponse {
  return r.type === "WORKER_ERROR";
}

// ─────────────────────────────────────────────────────────────────────────────
// § 13 · WORLD GENERATION CONFIG
// ─────────────────────────────────────────────────────────────────────────────

export type GeographyRegion =
  | "north_west" | "north_east" | "yorkshire"
  | "midlands"   | "east"       | "london"
  | "south_east" | "south_west" | "wales";

export interface WorldGenConfig {
  readonly seed:       number;
  readonly season:     number;
  readonly regions:    readonly GeographyRegion[];
  readonly tierMeanOverrides?: Partial<Record<Tier, AttributeScore>>;
}
