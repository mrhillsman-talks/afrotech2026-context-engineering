import type { SpeakerCommand, TalkPhase } from "./types.js";
import { PRESET_BY_PHASE } from "./presets.js";

/**
 * The run sheet: docs/speaker-transcript-human.md as the commands the console would send, one step per beat. A beat is
 * everything the script has the speaker press between two spoken passages, so a LIVE and the preset after it is one step,
 * and so is a switch and the Invoke under it. The right arrow does the next step; the left arrow goes back one by
 * reloading the preset the step sits under and redoing the steps since (see Store.gotoSheet). Every preset step takes
 * the slide down first, since the script never loads a preset behind a slide; a preset clicked by hand leaves the slide
 * alone. Not on the sheet: the IF branches that need the speaker's judgement, the optional activities, and End session,
 * which deletes names and belongs on a confirmed click.
 */
export type RunCmd =
  | SpeakerCommand
  /** Sent only when this card is still outside the window at that point in the step: the script's IF, done for you. */
  | { ifOut: string; label: string; cmds: SpeakerCommand[] };
export interface RunStep {
  /** Part of the talk, as the clock names it. */
  part: string;
  /** What the step does, in the console's own words. */
  label: string;
  cmds: RunCmd[];
}
export const isSpeakerCmd = (c: RunCmd): c is SpeakerCommand => "type" in c;

const step = (part: string, label: string, ...cmds: RunCmd[]): RunStep => ({ part, label, cmds });
/** Two cues the script gives with nothing said between them: one press. */
const then = (a: RunStep, b: RunStep): RunStep => ({ part: a.part, label: `${a.label}, then ${b.label}`, cmds: [...a.cmds, ...b.cmds] });
const slide = (part: string, number: number, name: string): RunStep => step(part, `Slide ${String(number).padStart(2, "0")} ${name}`, { type: "slide.show", number });
const live = (part: string): RunStep => step(part, "Live view", { type: "slide.set", index: null });
const preset = (part: string, phase: TalkPhase): RunStep => { const p = PRESET_BY_PHASE[phase]; return step(part, `Preset ${p.code} ${p.name}`, { type: "slide.set", index: null }, { type: "preset", phase }); };
const invoke = (part: string): RunStep => step(part, "Invoke assistant", { type: "assistant.run" });

const BEFORE = "Before the talk", OPEN = "Opening", P1 = "Part 1", P2 = "Part 2", P3 = "Part 3", P4 = "Part 4", P5 = "Part 5", P6 = "Part 6";

export const RUN_SHEET: readonly RunStep[] = [
  slide(BEFORE, 1, "conference"),
  preset(BEFORE, "lobby"),

  // The title slide goes up as the talk starts, so one press shows it and starts the clock.
  then(slide(OPEN, 2, "title"), step(OPEN, "Start the talk clock", { type: "timer.start" })),
  slide(OPEN, 3, "base"),
  slide(OPEN, 4, "context window"),
  slide(OPEN, 5, "project atlas"),
  slide(OPEN, 6, "how to read the screen"),
  live(OPEN),

  slide(P1, 7, "part 1"),
  preset(P1, "solo-select"),
  preset(P1, "solo-compress"),
  slide(P1, 8, "part 1 lessons"),

  slide(P2, 9, "part 2"),
  preset(P2, "shared-collect"),
  step(P2, "X-ray on", { type: "xray.set", on: true }),
  preset(P2, "shared-auction"),
  then(step(P2, "Voting open off", { type: "voting.set", open: false }), invoke(P2)),
  then(preset(P2, "realtime-update"), step(P2, "Inject ATLAS-005", { type: "item.inject", itemId: "ATLAS-005" })),
  step(P2, "Inject ATLAS-010", { type: "item.inject", itemId: "ATLAS-010" }),
  slide(P2, 10, "part 2 lessons"),

  slide(P3, 11, "part 3"),
  preset(P3, "scope"),
  step(P3, "Strict project scope on", { type: "policy.set", patch: { projectScope: true } }),
  preset(P3, "privacy"),
  invoke(P3),
  then(step(P3, "Permission / privacy filter on", { type: "policy.set", patch: { permissionFilter: true } }), invoke(P3)),
  preset(P3, "injection"),
  invoke(P3),
  then(step(P3, "Trust · untrusted is data on", { type: "policy.set", patch: { trustFilter: true } }), invoke(P3)),
  slide(P3, 12, "part 3 lessons"),

  slide(P4, 13, "part 4"),
  then(preset(P4, "retrieval"), invoke(P4)),
  then(step(P4, "Admit audience pick", { type: "retrieve.voted" },
    { ifOut: "ATLAS-002", label: "the room's picks left the contract out: Retrieve top-k as well", cmds: [{ type: "retrieve.topk" }] }), invoke(P4)),
  preset(P4, "reveal"),
  slide(P4, 14, "part 4 lessons"),

  slide(P5, 15, "part 5"),
  slide(P5, 16, "buy"),
  preset(P5, "buy"),
  slide(P5, 17, "blend"),
  preset(P5, "blend"),
  step(P5, "Retrieve for current question", { type: "retrieve.blend" }),
  slide(P5, 18, "build"),
  preset(P5, "build"),
  step(P5, "Context budget 150", { type: "budget.set", budget: 150 }),
  step(P5, "Context budget 300", { type: "budget.set", budget: 300 }),
  slide(P5, 19, "part 5 lessons"),

  slide(P6, 20, "cwa"),
  slide(P6, 21, "part 6"),
  preset(P6, "final"),
  invoke(P6),
  preset(P6, "close"),
  slide(P6, 22, "part 6 lessons"),
  slide(P6, 23, "recap"),
  then(slide(P6, 24, "questions"), step(P6, "Pause the talk clock", { type: "timer.pause" })),
  slide(P6, 25, "thank you"),
];

const has = (s: RunStep, pred: (c: SpeakerCommand) => boolean) => s.cmds.some((c) => isSpeakerCmd(c) && pred(c));

/** The step to replay from to land on `target`: the last preset at or before it, since a preset rebuilds the window. */
export function runSheetCheckpoint(target: number): number {
  for (let i = Math.min(target, RUN_SHEET.length - 1); i > 0; i--) if (has(RUN_SHEET[i], (c) => c.type === "preset")) return i;
  return 0;
}
/** Index of the step that loads `phase`, so a preset clicked by hand moves the cursor there; -1 for the activities. */
export function runSheetIndexOfPreset(phase: TalkPhase): number {
  return RUN_SHEET.findIndex((s) => has(s, (c) => c.type === "preset" && c.phase === phase));
}
/** Index of the step that shows the slide whose file name starts with `number`; -1 if the sheet has none. */
export function runSheetIndexOfSlide(number: number): number {
  return RUN_SHEET.findIndex((s) => has(s, (c) => c.type === "slide.show" && c.number === number));
}
