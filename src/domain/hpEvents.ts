export const CHAMPIONS_HP_RULESET_ID = "pokemon-champions-hp-events-v4";

export const KNOWN_HP_EVENT_EFFECT_IDS = [
  "life-orb-recoil",
  "sandstorm-damage",
  "poison-damage",
  "toxic-damage",
  "burn-damage",
  "stealth-rock-damage",
  "spikes-damage",
  "salt-cure-damage",
  "sitrus-berry-heal",
  "leftovers-heal",
] as const;

export type SupportedHpEventEffectId = typeof KNOWN_HP_EVENT_EFFECT_IDS[number];
export type HpEventSubject = "attacker" | "defender";
export type HpEventTiming =
  | "onEntry"
  | "beforeMove"
  | "afterHit"
  | "afterMove"
  | "endOfTurn"
  | "onMoveFail"
  | "onFaint";
export type HpEventFrequency = "once" | "perMove" | "perHit" | "perTurn";
export type HpEventSequenceContext = "currentMove" | "priorMove";

export interface HpEvent {
  id: string;
  effectId: string;
  enabled: boolean;
  sequenceContext: HpEventSequenceContext;
  toxicStage?: number;
  spikesLayers?: number;
}

export interface HpEventEvaluation {
  cardId: string;
  eventId: string;
  effectId: string;
  label: string;
  subject: HpEventSubject;
  subjectBuildId: string;
  timing: HpEventTiming;
  frequency: HpEventFrequency;
  sequenceContext: HpEventSequenceContext;
  occurrence: number;
  damage: number;
  healing?: number;
  applied: boolean;
  activationProbability: number;
  supported: boolean;
  reason?: string;
}

const supportedHpEventEffectIds = new Set<string>(KNOWN_HP_EVENT_EFFECT_IDS);

export const isSupportedHpEventEffectId = (
  value: string,
): value is SupportedHpEventEffectId => supportedHpEventEffectIds.has(value);
