import example from "../data/presets/adjustment-example.json";
import { parseShareStateDocument } from "./shareState";

/** The selected backup entry is shared by the box, tutorial and build-time example. */
export const createAdjustmentExampleState = () => (
  parseShareStateDocument(JSON.stringify(example.payload))
);

/** Start the tutorial before allocation so calculating and applying show the result. */
export const createAdjustmentTutorialState = () => {
  const state = createAdjustmentExampleState();
  state.target.statPoints = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  return state;
};
