/**
 * Writes slides-png/speaker-notes.json ({ "<file>.png": "<plain-text notes>" }) from notes/speaker-notes.md, for
 * scripts/google-slides-import.gs to put in each Google Slides slide's speaker notes. Static slide NN gets the step that
 * names "Slide NN". An app capture (NNa-KK-…) gets the step whose action matches its "Beat (run sheet)" in
 * slides-png/README-app-backup.md, searched forward from the current step so repeated beats such as "Invoke assistant"
 * resolve to the right part. A step no image claims is appended to the image of the step before it, so no note is
 * dropped. Prints the image-to-step table for checking by hand.
 * Run: npm run gslides:notes
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOTES = path.join(ROOT, "notes/speaker-notes.md");
const DIR = path.join(ROOT, "slides-png");
const README = path.join(DIR, "README-app-backup.md");
const OUT = path.join(DIR, "speaker-notes.json");

interface Step { n: number; head: string; action: string; body: string }
interface Row { beat: string; shows: string }

/** Google Slides notes are plain text: drop **bold** and *emphasis* markers. */
const plain = (s: string) => s.trim().replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*([^*\n]+)\*/g, "$1");

// "## Step 17 · Part 2 · Voting open off, then Invoke assistant" → { n: 17, action: "Voting open off, …" }
const steps: Step[] = fs.readFileSync(NOTES, "utf8").split(/^## Step /m).slice(1).map((sec) => {
  const nl = sec.indexOf("\n");
  const head = (nl === -1 ? sec : sec.slice(0, nl)).trim();
  const [n, , ...rest] = head.split(" · ");
  return { n: Number(n), head, action: rest.join(" · "), body: plain(nl === -1 ? "" : sec.slice(nl + 1)) };
});

// README table rows: | `file.png` | `after.png` | beat | what it shows |
const rows: Record<string, Row> = {};
if (fs.existsSync(README)) {
  for (const line of fs.readFileSync(README, "utf8").split("\n")) {
    const c = line.split("|").map((x) => x.trim());
    const m = c[1]?.match(/^`(.+\.png)`$/);
    if (m) rows[m[1]] = { beat: c[3], shows: c[4] };
  }
}

/** Step index for a beat: whole beat first, then without trailing " · …" qualifiers ("Preset 01 Solo · after the room
 * runs"). The whole beat goes first because some actions contain " · " ("Trust · untrusted is data on, …"). Searches
 * from `from` onward, then the whole file. */
function findStep(beat: string, from: number): number {
  const parts = beat.split(" · ");
  for (const start of [from, 0]) {
    for (let k = parts.length; k > 0; k--) {
      const want = parts.slice(0, k).join(" · ");
      const i = steps.findIndex((s, j) => j >= start && s.action === want);
      if (i !== -1) return i;
    }
  }
  return -1;
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".png")).sort();
const stepsOf: Record<string, number[]> = {};
const claimed = new Set<number>();
let pos = 0;
for (const f of files) {
  const slide = f.match(/^(\d\d)-/);
  const i = slide
    ? steps.findIndex((s) => new RegExp(`(^|· )Slide ${slide[1]}\\b`).test(s.action))
    : rows[f] ? findStep(rows[f].beat, pos) : -1;
  stepsOf[f] = i === -1 ? [] : [i];
  if (i === -1) continue;
  claimed.add(i);
  if (slide || i > pos) pos = i;
}

// An unclaimed step rides on the last image holding the nearest earlier claimed step.
const orphans: number[] = [];
steps.forEach((s, i) => {
  if (claimed.has(i)) return;
  orphans.push(s.n);
  for (let j = i - 1; j >= 0; j--) {
    const f = [...files].reverse().find((x) => stepsOf[x].includes(j));
    if (f) { stepsOf[f].push(i); break; }
  }
});

const out: Record<string, string> = {};
for (const f of files) {
  const parts = stepsOf[f].sort((a, b) => a - b).map((i) => `[Step ${steps[i].head}]` + (steps[i].body ? "\n" + steps[i].body : ""));
  if (!parts.length && rows[f]) parts.push(`[${rows[f].beat}]\n${rows[f].shows}\nNo script for this beat in speaker-notes.md.`);
  out[f] = parts.join("\n\n");
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

for (const f of files) console.log(f.padEnd(42), stepsOf[f].map((i) => steps[i].n).join(",") || "-");
const onImage = new Set(Object.values(stepsOf).flat()).size;
console.log(`images ${files.length}, steps ${steps.length}, steps on an image ${onImage}`);
console.log(`steps no image claimed (appended to the image before): ${orphans.join(", ") || "none"}`);
console.log(`images with no step: ${files.filter((f) => !stepsOf[f].length).join(", ") || "none"}`);
console.log(`wrote ${path.relative(ROOT, OUT)}`);
