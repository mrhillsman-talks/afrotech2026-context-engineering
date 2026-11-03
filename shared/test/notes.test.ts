import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { RUN_SHEET, parseNotes, notesForSheet, writeNotes, noteHeading, noteTextAllowed } from "../src/index.js";

const empty = () => RUN_SHEET.map(() => "");
// A step whose label holds " · ", so the heading split is exercised.
const trust = RUN_SHEET.findIndex((s) => s.label.includes(" · "));

test("an empty file has every step's heading, in order, and reads back with no note and no mismatch", () => {
  const parsed = parseNotes(writeNotes(empty()));
  assert.deepEqual(parsed.map((n) => [n.step, n.part, n.label]), RUN_SHEET.map((s, i) => [i + 1, s.part, s.label]));
  assert.deepEqual(notesForSheet(parsed), { notes: empty(), mismatched: [] });
});

test("notes survive a write and a read unchanged, and a second write gives the same file", () => {
  assert.ok(trust >= 0, "the run sheet has a label with ' · ' in it");
  const notes = empty();
  notes[0] = "One line.";
  notes[trust] = "  Indented first line.\n\nA second paragraph.\n- a list\n## Not a step heading";
  notes[RUN_SHEET.length - 1] = "Last step.";
  const md = writeNotes(notes);
  const back = notesForSheet(parseNotes(md));
  assert.deepEqual(back, { notes, mismatched: [] });
  assert.equal(writeNotes(back.notes), md);
});

test("blank lines around a note and Windows line endings are not part of the note", () => {
  const md = writeNotes(empty()).replace(`${noteHeading(2)}\n`, `${noteHeading(2)}\n\n\n  Say this.\n\n\n`).replace(/\n/g, "\r\n");
  assert.equal(notesForSheet(parseNotes(md)).notes[2], "  Say this.");
});

test("a section whose label, part or number no longer fits the run sheet is reported and left out", () => {
  const notes = empty();
  notes[3] = "moved"; notes[4] = "kept";
  let md = writeNotes(notes).replace(noteHeading(3), `## Step 4 · ${RUN_SHEET[3].part} · Some old label`);
  md += `\n## Step ${RUN_SHEET.length + 1} · Part 9 · Gone\n\nextra\n\n${noteHeading(4)}\n\nagain\n`;
  const { notes: out, mismatched } = notesForSheet(parseNotes(md));
  assert.deepEqual(mismatched, [4, RUN_SHEET.length + 1, 5]);
  assert.equal(out[3], "");
  assert.equal(out[4], "kept", "the first section for a step wins over a repeat");
});

test("a note may not hold a line that reads as a step heading", () => {
  assert.equal(noteTextAllowed("## Step 3 · Opening · Slide 03 base"), false);
  assert.equal(noteTextAllowed("text\r\n## Step 12 · x"), false);
  assert.equal(noteTextAllowed("## Step three\nStep 3 · Opening"), true);
});

test("writing needs one note per run-sheet step", () => {
  assert.throws(() => writeNotes(["only one"]), /expected 55 notes/);
});

test("notes/speaker-notes.md has a section for every run-sheet step, each matching the sheet, and is in written form", () => {
  const md = fs.readFileSync(new URL("../../notes/speaker-notes.md", import.meta.url), "utf8");
  const { notes, mismatched } = notesForSheet(parseNotes(md));
  assert.deepEqual(mismatched, [], "sections whose step, part or label no longer match RUN_SHEET");
  assert.equal(parseNotes(md).length, RUN_SHEET.length);
  assert.equal(writeNotes(notes), md, "the file reads back and writes out unchanged");
});
