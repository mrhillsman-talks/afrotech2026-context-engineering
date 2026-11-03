import { RUN_SHEET } from "./runsheet.js";

/**
 * Speaker notes: one per run-sheet step, kept in notes/speaker-notes.md. Each step is a `## Step N · part · label`
 * heading (N counts from 1, as the console does) followed by the note's text. The label is there so a change to the
 * run sheet that moves steps shows up as a mismatch instead of putting a note under the wrong step.
 */
export interface ParsedNote { step: number; part: string; label: string; text: string }

/** A line the parser reads as a step heading; a note may not contain one. */
export const NOTE_HEADING = /^## Step (\d+) · (.+)$/;

const PREAMBLE = [
  "# Speaker notes",
  "",
  "One section per run sheet step (shared/src/runsheet.ts), shown in the notes view as the step comes up.",
  "The server writes the headings; edit only the text under them. No line in the text may have the form `## Step N · …`.",
  "",
].join("\n");

export const noteHeading = (index: number) => `## Step ${index + 1} · ${RUN_SHEET[index].part} · ${RUN_SHEET[index].label}`;

/** Leading blank lines and trailing whitespace off; indentation of the first line and everything inside kept. */
const tidy = (text: string) => text.replace(/\r\n?/g, "\n").replace(/^(?:[ \t]*\n)+/, "").trimEnd();

/** False when the text holds a line that would read back as a step heading. */
export const noteTextAllowed = (text: string) => !tidy(text).split("\n").some((l) => NOTE_HEADING.test(l));

/** Every section in the file, in file order. Text before the first heading is the preamble and is dropped. */
export function parseNotes(md: string): ParsedNote[] {
  const out: ParsedNote[] = [];
  let cur: { note: ParsedNote; lines: string[] } | undefined;
  const close = () => { if (cur) { cur.note.text = tidy(cur.lines.join("\n")); out.push(cur.note); } };
  for (const line of md.replace(/\r\n?/g, "\n").split("\n")) {
    const m = NOTE_HEADING.exec(line);
    if (!m) { cur?.lines.push(line); continue; }
    close();
    // Part names never hold " · "; labels can ("Trust · untrusted is data on"), so split at the first one only.
    const rest = m[2], at = rest.indexOf(" · ");
    cur = { note: { step: Number(m[1]), part: at < 0 ? "" : rest.slice(0, at), label: at < 0 ? rest : rest.slice(at + 3), text: "" }, lines: [] };
  }
  close();
  return out;
}

/**
 * The parsed notes laid on the run sheet: `notes[i]` is step i's text, empty when the file has none. `mismatched` lists
 * the 1-based steps of sections whose number is out of range, repeats an earlier one, or whose part and label differ
 * from the run sheet's; their text is left out of `notes`.
 */
export function notesForSheet(parsed: readonly ParsedNote[]): { notes: string[]; mismatched: number[] } {
  const notes: string[] = RUN_SHEET.map(() => "");
  const seen = new Set<number>(), mismatched: number[] = [];
  for (const n of parsed) {
    const s = RUN_SHEET[n.step - 1];
    if (!s || seen.has(n.step) || s.part !== n.part || s.label !== n.label) { mismatched.push(n.step); continue; }
    seen.add(n.step);
    notes[n.step - 1] = n.text;
  }
  return { notes, mismatched };
}

/** The file for `notes` (one entry per run-sheet step), every step's heading included, empty notes as well. */
export function writeNotes(notes: readonly string[]): string {
  if (notes.length !== RUN_SHEET.length) throw new Error(`expected ${RUN_SHEET.length} notes, got ${notes.length}`);
  return PREAMBLE + RUN_SHEET.map((_, i) => { const t = tidy(notes[i]); return `\n${noteHeading(i)}\n${t ? `\n${t}\n` : ""}`; }).join("");
}
