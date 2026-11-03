import { test } from "node:test";
import assert from "node:assert/strict";
import { RUN_SHEET, MAIN_PHASES, PRESET_BY_PHASE, isSpeakerCmd, runSheetCheckpoint, runSheetIndexOfPreset, runSheetIndexOfSlide } from "../src/index.js";

const cmds = RUN_SHEET.flatMap((s) => s.cmds.filter(isSpeakerCmd));
const presetLabel = (phase: keyof typeof PRESET_BY_PHASE) => `Preset ${PRESET_BY_PHASE[phase].code} ${PRESET_BY_PHASE[phase].name}`;

test("the run sheet loads every main preset once, in talk order, and no activity", () => {
  const phases = cmds.filter((c) => c.type === "preset").map((c) => (c as { phase: string }).phase);
  assert.deepEqual(phases, [...MAIN_PHASES]);
});

test("the run sheet shows slides 1 to 25 once each, in order", () => {
  const slides = cmds.filter((c) => c.type === "slide.show").map((c) => (c as { number: number }).number);
  assert.deepEqual(slides, Array.from({ length: 25 }, (_, i) => i + 1));
});

test("one step per beat: presets take the slide down, and cues the script gives together are one press", () => {
  for (const s of RUN_SHEET) {
    const i = s.cmds.findIndex((c) => isSpeakerCmd(c) && c.type === "preset");
    if (i >= 0) assert.deepEqual(s.cmds[i - 1], { type: "slide.set", index: null }, s.label);
  }
  const labels = RUN_SHEET.map((s) => s.label);
  for (const l of [
    "Voting open off, then Invoke assistant", `${presetLabel("realtime-update")}, then Inject ATLAS-005`,
    "Permission / privacy filter on, then Invoke assistant", "Trust · untrusted is data on, then Invoke assistant",
    `${presetLabel("retrieval")}, then Invoke assistant`, "Admit audience pick, then Invoke assistant", "Slide 24 questions, then Pause the talk clock",
    "Slide 02 title, then Start the talk clock",
  ]) assert.ok(labels.includes(l), l);
  assert.equal(labels.filter((l) => l === "Live view").length, 1, "only the live view after slide 06 stands on its own");
  assert.equal(RUN_SHEET.length, 55);
});

test("a step replays from the last preset at or before it; before the first preset, from the top", () => {
  const lobby = runSheetIndexOfPreset("lobby");
  assert.equal(runSheetCheckpoint(0), 0);
  assert.equal(runSheetCheckpoint(lobby), lobby);
  assert.equal(runSheetCheckpoint(runSheetIndexOfSlide(10)), runSheetIndexOfPreset("realtime-update"));
  assert.equal(runSheetCheckpoint(RUN_SHEET.length - 1), runSheetIndexOfPreset("close"));
  assert.equal(runSheetIndexOfPreset("provenance"), -1);
  assert.equal(runSheetIndexOfSlide(99), -1);
});
