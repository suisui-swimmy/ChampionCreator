import { describe, expect, it } from "vitest";
import {
  calculateBeatUpBasePower,
  getBeatUpBasePowerForPokemon,
  getBeatUpParticipantLimit,
} from "./beatUp";

describe("Beat Up mechanics", () => {
  it("derives each hit power from the participant species base Attack", () => {
    expect(calculateBeatUpBasePower(85)).toBe(13);
    expect(calculateBeatUpBasePower(115)).toBe(16);
    expect(getBeatUpBasePowerForPokemon("Torkoal")).toBe(13);
    expect(getBeatUpBasePowerForPokemon("Annihilape")).toBe(16);
    expect(getBeatUpBasePowerForPokemon("Missing Pokemon")).toBeUndefined();
  });

  it("limits participant slots by battle rule", () => {
    expect(getBeatUpParticipantLimit("singles")).toBe(3);
    expect(getBeatUpParticipantLimit("doubles")).toBe(4);
  });
});
