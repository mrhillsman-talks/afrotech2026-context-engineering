import fs from "node:fs";
import path from "node:path";
import { RUN_SHEET, parseNotes, notesForSheet, writeNotes, noteTextAllowed } from "@ctx/shared";
import { CommandError } from "./store.js";

/** Longest note a save accepts, in characters; the longest drafted note is about 1,200. */
export const NOTE_MAX_CHARS = 20_000;

/**
 * The speaker notes file (notes/speaker-notes.md, or NOTES_FILE). Read at start and again before a save when it changed
 * on disk since (a git pull, a hand edit), so a save never writes over an edit made outside the app. Saving is off
 * when the server was started read-only, or when a section no longer matches the run sheet: writing the file back
 * would drop that section's text.
 */
export class NotesFile {
  notes: string[] = RUN_SHEET.map(() => "");
  /** Why saving is off; undefined while it is on. */
  readOnly?: string;
  private mtime = -1;

  constructor(readonly file: string, private readonly startedReadOnly = false) { this.load(); }

  private load() {
    let md: string;
    try { md = fs.readFileSync(this.file, "utf8"); this.mtime = fs.statSync(this.file).mtimeMs; } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      // No file yet: every note is empty and the first save creates it.
      this.notes = RUN_SHEET.map(() => ""); this.mtime = -1; this.readOnly = this.startedReadOnly ? READ_ONLY : undefined;
      return;
    }
    const { notes, mismatched } = notesForSheet(parseNotes(md));
    this.notes = notes;
    this.readOnly = mismatched.length
      ? `Saving is off: the notes file's ${mismatched.length > 1 ? "sections for steps" : "section for step"} ${mismatched.join(", ")} no longer ${mismatched.length > 1 ? "match" : "matches"} the run sheet. Fix ${path.basename(this.file)}, then reload this page.`
      : this.startedReadOnly ? READ_ONLY : undefined;
  }

  /** Re-reads the file when it changed on disk since the last read or write. */
  refresh() {
    let mtime = -1;
    try { mtime = fs.statSync(this.file).mtimeMs; } catch { /* missing: same as never written */ }
    if (mtime !== this.mtime) this.load();
  }

  /** Replace step `index`'s note and write the whole file: a temporary file renamed over it, so a crash never leaves half. */
  set(index: number, text: string) {
    this.refresh();
    if (this.readOnly) throw new CommandError(this.readOnly);
    if (!Number.isInteger(index) || index < 0 || index >= RUN_SHEET.length) throw new CommandError(`No run sheet step ${index + 1}`);
    if (typeof text !== "string") throw new CommandError("A note is text");
    if (text.length > NOTE_MAX_CHARS) throw new CommandError(`A note is at most ${NOTE_MAX_CHARS} characters`);
    if (!noteTextAllowed(text)) throw new CommandError("A line in the note reads as a step heading (## Step N · …)");
    const next = [...this.notes];
    next[index] = text;
    const md = writeNotes(next);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, md);
    fs.renameSync(tmp, this.file);
    this.mtime = fs.statSync(this.file).mtimeMs;
    // Read back through the parser, so the notes sent out are the file's (trimmed) text, not what the client typed.
    this.notes = notesForSheet(parseNotes(md)).notes;
  }
}

const READ_ONLY = "Saving is off on this server (NOTES_READONLY). Edit notes/speaker-notes.md in the repository.";
