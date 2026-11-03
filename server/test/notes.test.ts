import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RUN_SHEET, parseNotes, notesForSheet, writeNotes, noteHeading } from "@ctx/shared";
import { NotesFile, NOTE_MAX_CHARS } from "../src/notes.js";
import { CommandError } from "../src/store.js";

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ctx-notes-")), "notes", "speaker-notes.md");
const onDisk = (file: string) => notesForSheet(parseNotes(fs.readFileSync(file, "utf8"))).notes;
const empty = () => RUN_SHEET.map(() => "");

test("with no file every note is empty, and the first save creates the file", () => {
  const file = tmpFile(), n = new NotesFile(file);
  assert.deepEqual(n.notes, empty());
  assert.equal(n.readOnly, undefined);
  n.set(0, "First.");
  assert.equal(onDisk(file)[0], "First.");
  assert.equal(n.notes[0], "First.");
  assert.ok(!fs.existsSync(file + ".tmp"), "the temporary file is renamed over the real one");
});

test("started read-only, a save is refused and nothing is written", () => {
  const file = tmpFile(), n = new NotesFile(file, true);
  assert.match(n.readOnly ?? "", /NOTES_READONLY/);
  assert.throws(() => n.set(0, "x"), (e) => e instanceof CommandError && /NOTES_READONLY/.test(e.message));
  assert.ok(!fs.existsSync(file));
});

test("a section that no longer matches the run sheet turns saving off, so its text is never written away", () => {
  const file = tmpFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const notes = empty(); notes[4] = "keep me";
  const md = writeNotes(notes).replace(noteHeading(4), `## Step 5 · ${RUN_SHEET[4].part} · An old label`);
  fs.writeFileSync(file, md);
  const n = new NotesFile(file);
  assert.match(n.readOnly ?? "", /section for step 5 no longer matches/);
  assert.throws(() => n.set(0, "x"), CommandError);
  assert.equal(fs.readFileSync(file, "utf8"), md);
});

test("an edit made on disk between two saves is kept", () => {
  const file = tmpFile(), n = new NotesFile(file);
  n.set(0, "from the app");
  const outside = onDisk(file); outside[2] = "from git";
  fs.writeFileSync(file, writeNotes(outside));
  const later = new Date(Date.now() + 5000); fs.utimesSync(file, later, later);
  n.set(1, "from the app again");
  assert.deepEqual(onDisk(file).slice(0, 3), ["from the app", "from the app again", "from git"]);
});

test("a save checks the step, the length and the heading rule", () => {
  const n = new NotesFile(tmpFile());
  assert.throws(() => n.set(-1, "x"), /No run sheet step 0/);
  assert.throws(() => n.set(1.5, "x"), CommandError);
  assert.throws(() => n.set(0, "x".repeat(NOTE_MAX_CHARS + 1)), /at most/);
  assert.throws(() => n.set(0, "## Step 1 · Before the talk · Slide 01 conference"), /step heading/);
  assert.deepEqual(n.notes, empty());
});
