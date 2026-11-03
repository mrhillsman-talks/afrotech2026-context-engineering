/**
 * Drafts notes/speaker-notes.md from the SAY passages of docs/speaker-transcript-human.md: each run-sheet step gets the
 * SAY text between its own cue and the next step's cue. Prints the step-to-line table for checking by hand, and exits
 * non-zero, writing nothing, if a step has no cue in the script. Will not overwrite the notes file without --force.
 * Run: npm run notes:draft [-- --force]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RUN_SHEET, PRESET_BY_PHASE, isSpeakerCmd, writeNotes } from "../shared/src/index.js";
import type { RunStep, SpeakerCommand } from "../shared/src/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "docs/speaker-transcript-human.md");
const OUT = path.join(ROOT, "notes/speaker-notes.md");
const force = process.argv.includes("--force");

/** A cue block: the cue word, its 1-based line, and its text up to the next cue, heading or rule. */
interface Block { cue: string; line: number; text: string[] }
const CUE = /^\*\*(SLIDE|LIVE|CONSOLE|SAY|ROOM|SCREEN|IF)\*\*/;

// The run of show sits between these two headings; "How to read this script" above it names the same buttons.
const lines = fs.readFileSync(SCRIPT, "utf8").replace(/\r\n?/g, "\n").split("\n");
const start = lines.indexOf("## Before the talk"), end = lines.indexOf("## Optional activities");
if (start < 0 || end < 0) throw new Error("docs/speaker-transcript-human.md: the run of show headings moved");

const blocks: Block[] = [];
for (let i = start; i < end; i++) {
  const l = lines[i], m = CUE.exec(l);
  if (m) { blocks.push({ cue: m[1], line: i + 1, text: [l] }); continue; }
  if (/^#{2,3} |^---$/.test(l)) { blocks.push({ cue: "", line: i + 1, text: [] }); continue; }
  blocks[blocks.length - 1]?.text.push(l);
}

/** The command a step's cue is found by: its first, except the slide take-down every preset step starts with. */
function primary(step: RunStep): SpeakerCommand {
  const cmds = step.cmds.filter(isSpeakerCmd);
  return cmds.find((c) => !(c.type === "slide.set" && c.index === null)) ?? cmds[0];
}

/** Whether block `b` is where the script has the speaker do `c`. */
function cueFor(c: SpeakerCommand, b: Block): boolean {
  const text = b.text.join("\n");
  const console = (s: string) => b.cue === "CONSOLE" && text.includes(s);
  switch (c.type) {
    case "slide.show": return b.cue === "SLIDE" && b.text[0].includes(`\`${String(c.number).padStart(2, "0")}-`);
    case "slide.set": return b.cue === "LIVE";
    case "preset": return console(`preset **${PRESET_BY_PHASE[c.phase].code} `);
    case "xray.set": return console("`V`");
    case "voting.set": return console("**Voting open**");
    case "item.inject": return console(`**Inject ${c.itemId}**`);
    case "assistant.run": return console("**Invoke assistant**");
    case "retrieve.voted": return console("**Admit audience pick**");
    case "retrieve.blend": return console("**Retrieve for current question**");
    case "budget.set": return console(`\`${c.budget}\``);
    case "policy.set": {
      const names: Record<string, string> = { projectScope: "Strict project scope", permissionFilter: "Permission / privacy filter", trustFilter: "Trust · untrusted is data" };
      return Object.keys(c.patch).every((k) => console(`**${names[k] ?? k}**`));
    }
    default: throw new Error(`no cue rule for ${c.type}`);
  }
}

/** A SAY block's words as paragraphs: the script's hard wraps joined, list items and blank lines kept. */
function sayText(b: Block): string {
  const rest = b.text[0].replace(CUE, "").trim();
  const body = [...(rest ? [rest] : []), ...b.text.slice(1)];
  const paras: string[] = [];
  let cur = "";
  for (const l of body) {
    const t = l.trim();
    if (!t) { if (cur) paras.push(cur); cur = ""; continue; }
    cur = cur && !/^(?:[-*] |\d+\. )/.test(t) ? `${cur} ${t}` : cur ? `${cur}\n${t}` : t;
  }
  if (cur) paras.push(cur);
  return paras.join("\n\n");
}

// Each step's cue is the first matching block after the previous step's, so the script's order is the sheet's order.
const at: number[] = [];
let cursor = 0;
for (const [i, step] of RUN_SHEET.entries()) {
  const c = primary(step);
  const j = blocks.findIndex((b, k) => k >= cursor && cueFor(c, b));
  if (j < 0) { console.error(`step ${i + 1} "${step.label}": no ${c.type} cue after line ${blocks[cursor - 1]?.line ?? start + 1}`); process.exit(1); }
  at.push(j); cursor = j + 1;
}

const notes = RUN_SHEET.map((_, i) => blocks.slice(at[i], at[i + 1] ?? blocks.length).filter((b) => b.cue === "SAY").map(sayText).join("\n\n"));
const said = blocks.filter((b) => b.cue === "SAY").length, assigned = blocks.slice(at[0]).filter((b) => b.cue === "SAY").length;

const words = (t: string) => (t.match(/\S+/g) ?? []).length;
const pad = (s: string | number, n: number) => String(s).padEnd(n);
console.log(`${pad("step", 5)}${pad("script line", 12)}${pad("words", 7)}label`);
for (const [i, step] of RUN_SHEET.entries()) console.log(`${pad(i + 1, 5)}${pad(blocks[at[i]].line, 12)}${pad(words(notes[i]), 7)}${step.label}`);
console.log(`\n${assigned} of ${said} SAY blocks placed under a step; ${notes.filter((n) => !n).length} steps have no SAY text.`);

if (fs.existsSync(OUT) && !force) { console.error(`${path.relative(ROOT, OUT)} exists; pass --force to overwrite it.`); process.exit(1); }
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, writeNotes(notes));
console.log(`wrote ${path.relative(ROOT, OUT)}`);
