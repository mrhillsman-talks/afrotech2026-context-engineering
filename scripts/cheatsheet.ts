/**
 * Generates docs/speaker-cheat-sheet.html from the presets, so the printed sheet never drifts from the code.
 * Run: npm run cheatsheet
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRESETS, buildCards } from "../shared/src/index.js";
import type { TalkPhase } from "../shared/src/index.js";
import { slideLister } from "../server/src/slides.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cards = buildCards();
// The deck as the console lists it, so each slide cue can carry its number in the thumbnail strip.
const SLIDES_DIR = process.env.SLIDES_DIR ? path.resolve(ROOT, process.env.SLIDES_DIR) : path.join(ROOT, "slides");
const deck = slideLister(SLIDES_DIR)();

interface Beat { time: string; say: string; press: string; audience: string; expect: string; }
const BEATS: Record<TalkPhase, Beat> = {
  lobby: { time: "before", say: "The window is on the screen. You are everything that decides what goes in it. Join the room.", press: "Nothing. Watch the join count on the console.", audience: "Scan the QR, register.", expect: "Display shows QR and 0 / 400 units." },
  "solo-select": { time: "3:30", say: "First, each of you gets your own assistant. It can't have everything. Choose.", press: "Wait for the run count on the display to climb, then ask the room why the answers differ.", audience: "Pick cards within 80 units, Run assistant.", expect: "Split of AWS / Azure / Other. \"You gave them different worlds.\"" },
  "solo-compress": { time: "7:00", say: "New constraint. Your budget just got cut almost in half. Don't think only in terms of deleting.", press: "Nothing until people discover Summarize.", audience: "Keep / Summarize / Remove to fit 45 units, run again.", expect: "Contract 30 → 11. Ask: is that still the same information?" },
  "shared-collect": { time: "10:00", say: "One user is easy. Now a real system. Some of you just received a role.", press: "Roles are dealt on entry. Ask the five connectors to send; tell Monitoring, the web page and private memory to hold. X-ray ON once cards are in, and leave it on. Promote or discard staging text.", audience: "Role holders tap Send. Others may submit one sentence to staging.", expect: "Cards fly in. X-ray shows source, scope, age, authority on every card." },
  "shared-auction": { time: "13:00", say: "The window is over budget. You now operate it. Spend your relevance credits.", press: "Watch credits on the display. Voting open OFF. Invoke assistant. With X-ray on, the Inspector and the checks show beside the answer.", audience: "Allocate 100 credits. Phone shows the live packing projection.", expect: "389 / 300 overflow. The vote packs the window. Expect AWS with the checks at FAIL: capacity and approval are not known yet and the private card is in the window. If the room pushed the conversation card out, the vendor page gets in and the answer is GCP. Let it stand." },
  "realtime-update": { time: "17:00", say: "The world changed. What should happen to our context?", press: "Inject ATLAS-005 as soon as the preset loads, so phones show the alert with the poll. Then Inject ATLAS-010.", audience: "Poll: ignore / add and evict / summarize / retrieve something else.", expect: "287 / 300 on load, nothing over. The alert ranks high and gets in; the old Slack thread moves to Cannot enter, then the CEO memo when the approval arrives. Maintain, not just find." },
  scope: { time: "20:00", say: "Is this true? Should Atlas have it while answering?", press: "Toggle Strict project scope ON.", audience: "Poll yes / no.", expect: "Apollo slides out of the active window. The problem was scope, not truth." },
  privacy: { time: "22:00", say: "This card is Alice's private note. It looks relevant. Should the assistant have it?", press: "Permission filter is off on load. Invoke once (answer leaks $80,000). Permission filter ON. Invoke again.", audience: "Poll yes / no.", expect: "Eval fails on the leak, then passes. Retrieval asks could this help; authorization asks may this be used." },
  injection: { time: "24:00", say: "We retrieved a page. It contains something that looks like an instruction.", press: "Before invoking, point at the card's X-ray labels: external, untrusted, authority 0. Invoke with Trust filter off → GCP answer. Trust ON (card quarantined). Invoke again.", audience: "Poll: instruction or data?", expect: "More context is not automatically better context." },
  retrieval: { time: "26:30", say: "Does forgetting something from the window mean we lost it?", press: "Say that you set this window up with the contract pushed out. Invoke → Azure from old Slack (a live model may answer AWS from the ADR). Then Retrieve top-k or Admit audience pick. Invoke again.", audience: "Vote on which search result should enter.", expect: "Search results 5, selected 2. Similar is not the same as relevant." },
  reveal: { time: "29:00", say: "Almost everything we did happened before the model generated a word.", press: "Nothing. Point at the pipeline; toggles reflect the current policy.", audience: "Watch.", expect: "The definition, restated." },
  buy: { time: "31:00", say: "Suppose we're buying the assistant. Which sources should it be allowed to use?", press: "Nothing.", audience: "Toggle the four sources.", expect: "You vs vendor responsibility split. Buying changes who operates which controls." },
  blend: { time: "32:45", say: "Now the assistant can reach into systems we own. Enabling a source is not copying it in.", press: "Retrieve for current question.", audience: "Toggle the eight sources.", expect: "Only matching records appear. If Web is on by majority the vendor page comes too, marked untrusted. A connector expands the environment, not attention." },
  build: { time: "34:30", say: "When we build more of the system, the decisions don't disappear. We inherit them.", press: "Context budget 300 → 150, then back. Optional: Drift the contract and invoke.", audience: "Watch the policy change on their phones.", expect: "At 150 almost every card is summarized and the lowest-ranked no longer fit. Top-k changes the policy list, not the window. Buy → Blend → Build is who owns the machinery." },
  final: { time: "38:00", say: "Same question. Same model.", press: "Invoke assistant. X-ray on shows the Inspector.", audience: "See the answer on their phones.", expect: "Correct answer, eval PASS, MODEL UNCHANGED / CONTEXT ENGINEERED." },
  provenance: { time: "optional", say: "Three facts. Same words. Which would you trust operationally?", press: "X-ray OFF while the poll fills, then X-ray ON to reveal the sources.", audience: "Pick A, B or C.", expect: "Contract, Slack, web page. Text identical; only provenance differs." },
  routing: { time: "optional", say: "Two questions, one environment. Should the same context serve both?", press: "Question: deploy → Invoke. Question: color → Invoke. With X-ray on, the Inspector beside each answer shows what the window held.", audience: "Poll yes / no; phones show what the window holds for the current question.", expect: "Deployment cards leave the window for the color question; only the purple preference stays." },
  repetition: { time: "optional", say: "Five sources say Azure. One contract says AWS. Which matters?", press: "Invoke with the contract present → AWS. Evict contract → Invoke → the five copies win. With X-ray on, the five cards show authority 1–2, all copied from the memo.", audience: "Poll.", expect: "Eval fails on \"did not mistake repetition for authority\". Frequency is not authority; five copies are not five sources." },
  multiagent: { time: "optional", say: "Three agents report. The coordinator can hold 80 units. What should it receive?", press: "Nothing. Display shows transcripts 560, summaries 70, structured 36.", audience: "Poll: transcripts / summaries / structured findings.", expect: "Same budget problem one level up. Natural route into agentic context engineering." },
  structured: { time: "optional", say: "Same fact, two representations. Which would you rather reason over programmatically?", press: "Nothing.", audience: "Poll: narrative / structured.", expect: "58 units of prose vs 12 units of fields. Structure preserves the constraint through compression." },
  close: { time: "39:00", say: "We selected it, scoped it, compressed it, threw some away, retrieved some later.", press: "Event log replay starts on its own; switch it off for the stats. After the talk: End session.", audience: "Read the definition.", expect: "Stats. Names deleted and export written when you end the session." },
};

const OPTIONAL = [
  { ref: "§39", name: "Summary corruption", status: "Built", how: "Summarizer role picks the shorter drifted summary, or press Drift on the contract in the console. Invoke: constraint becomes a preference, eval fails on \"constraint not softened\". Ask what compression cost us." },
  { ref: "§40", name: "Provenance challenge", status: "Built (preset A1)", how: "Display shows the same sentence three times with sources hidden; the room votes; V reveals contract, Slack message, vendor webpage. Advance returns to the phase you left." },
  { ref: "§41", name: "Recency challenge", status: "Manual", how: "With X-ray on, read the ages: Slack 62 days, memo 45 days, ADR 14 days, monitoring 30 s. Ask which should disappear. Answer: potentially none; ask which should govern." },
  { ref: "§42", name: "Poisoning by repetition", status: "Built (preset A3)", how: "Five low-authority \"Azure preferred\" cards that copied each other, against one contract. With the contract present the answer stays AWS; evict it and the copies win, and the eval flags repetition mistaken for authority." },
  { ref: "§43", name: "Semantic retrieval failure", status: "Built (Retrieval phase)", how: "The five search results sort by similarity: contract 0.94, security policy 0.85, Apollo 0.70, old Slack 0.55, expense policy 0.20. Only the top two clear the 0.72 floor. Point at similarity vs the room's votes." },
  { ref: "§44", name: "Multi-agent coordinator", status: "Built (preset A4, display + poll)", how: "Display shows three agent findings with transcript, summary and structured costs against an 80-unit coordinator; the room votes on what the coordinator receives." },
  { ref: "§45", name: "Structured context", status: "Built (preset A5, display + poll)", how: "Display shows the contract as a 58-unit paragraph beside a 12-unit JSON object; the room votes on which it would rather reason over." },
  { ref: "§46", name: "Semantic routing", status: "Built (preset A2)", how: "Console switches the question between deployment and dashboard color; the relevance floor re-assembles the window live. Invoke for each: the color answer cites only the purple preference." },
];

/**
 * The run of show as the speaker drives it: each part is a sequence of cues. A string is a slide to put on the
 * display (its file name in slides/, without the extension); an array is a live stretch, the phases to run
 * with no slide up. Slides are checked against the deck so the sheet cannot name a file that is not there.
 */
type Cue = string | TalkPhase[];
const PARTS: { title: string; run: Cue[]; note?: string }[] = [
  { title: "Before the talk", run: ["01-conference", ["lobby"], "02-title", "03-base", "04-context-window", "05-project-atlas", "06-how-to-read-the-screen", ["lobby"]], note: "01 while the room fills, then live so the QR and join count show; 02 to 06 from 0:00. → on your first word puts up 02 and starts the clock in one press. 05 sets up Project Atlas and the six parts. Live again after 06 for the last call to join." },
  { title: "Part 1: One assistant, one budget", run: ["07-part1-one-assistant", ["solo-select", "solo-compress"], "08-part1-lessons"] },
  { title: "Part 2: A real system", run: ["09-part2-a-real-system", ["shared-collect", "shared-auction", "realtime-update"], "10-part2-lessons"] },
  { title: "Part 3: Right information, wrong context", run: ["11-part3-wrong-context", ["scope", "privacy", "injection"], "12-part3-lessons"] },
  { title: "Part 4: Beyond the window", run: ["13-part4-beyond-the-window", ["retrieval", "reveal"], "14-part4-lessons"] },
  { title: "Part 5: Who runs the machinery", run: ["15-part5-who-runs-the-machinery", "16-buy", ["buy"], "17-blend", ["blend"], "18-build", ["build"], "19-part5-lessons"], note: "One section slide before each preset." },
  { title: "Part 6: Same model", run: ["20-cwa", "21-part6-same-model", ["final", "close"], "22-part6-lessons", "23-recap", "24-questions", "25-thank-you"], note: "Load 15 before the lessons slide goes up. T pauses the clock at questions. End session after the room clears." },
  { title: "Optional activities", run: [["provenance", "routing", "repetition", "multiagent", "structured"]], note: "No slides; the display carries each one. Run when a part finishes early. Advance returns to the phase you left." },
];
const phasesOf = (part: (typeof PARTS)[number]) => part.run.flatMap((c) => (typeof c === "string" ? [] : c));
const deckNumber = (stem: string) => {
  const i = deck.findIndex((f) => f.replace(/\.[^.]+$/, "") === stem);
  if (i < 0) throw new Error(`slide ${stem} is not in ${path.relative(ROOT, SLIDES_DIR)}/`);
  return i + 1;
};
const slideCue = (stem: string) => `<span class="cue slide"><i>${deckNumber(stem)}</i>${esc(stem)}</span>`;
const liveCue = (phases: TalkPhase[]) => `<span class="cue live">LIVE ${PRESETS.filter((p) => phases.includes(p.phase)).map((p) => p.code).join(" · ")}</span>`;
const cueLine = (run: Cue[]) => run.map((c) => (typeof c === "string" ? slideCue(c) : liveCue(c))).join('<span class="arr">→</span>');

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const stateList = (p: (typeof PRESETS)[number]) => {
  const groups: Record<string, string[]> = {};
  for (const [id, st] of Object.entries(p.items)) (groups[st!] ??= []).push(id);
  const order = ["active", "compressed", "quarantined", "evicted"];
  const parts = order.filter((k) => groups[k]).map((k) => `<b>${k}</b> ${groups[k]!.map((id) => id.replace("ATLAS-", "A").replace("APOLLO-001", "APOLLO").replace("PRIVATE-001", "PRIV").replace("SYS-001", "SYS").replace("CONV-001", "CONV").replace("FILE-001", "FILE").replace("FIN-001", "FIN")).join(" ")}`);
  return parts.join(" · ") || "all available";
};
const policyList = (p: (typeof PRESETS)[number]) => {
  const on = Object.entries(p.policy).filter(([, v]) => v === true).map(([k]) => k);
  return on.length ? on.join(", ") : "all filters off";
};

const presetRow = (p: (typeof PRESETS)[number]) => {
  const b = BEATS[p.phase];
  return `<tr>
  <td class="code">${p.code}<br><span class="t">${b.time}</span></td>
  <td><b>${esc(p.name)}</b><br><span class="s">${p.mode} · ${p.budget}u${p.soloBudget ? ` · solo ${p.soloBudget}u` : ""}${p.votingOpen ? " · voting open" : ""}${p.poll ? " · poll" : ""}</span><br><span class="s">${esc(policyList(p))}</span></td>
  <td>${esc(b.say)}</td>
  <td>${esc(b.press)}</td>
  <td>${esc(b.audience)}</td>
  <td>${esc(b.expect)}<br><span class="s">${stateList(p)}</span></td>
  <td class="lesson">${esc(p.lesson)}</td>
</tr>`;
};
const covered = new Set(PARTS.flatMap(phasesOf));
const missing = PRESETS.filter((p) => !covered.has(p.phase)).map((p) => p.code);
if (missing.length) throw new Error("presets not placed in a part: " + missing.join(", "));
const rows = PARTS.map((part) => {
  const phases = phasesOf(part);
  // Each part gets its own tbody so its heading row sticks under the column header
  // and is pushed off by the next part's heading as you scroll.
  return `<tbody><tr class="part"><td colspan="7"><b>${esc(part.title)}</b><span class="run">${cueLine(part.run)}</span>${part.note ? `<span class="note">${esc(part.note)}</span>` : ""}</td></tr>\n` +
    PRESETS.filter((p) => phases.includes(p.phase)).map(presetRow).join("\n") + `</tbody>`;
}).join("\n");

const cardRows = Object.values(cards).map((c) => `<tr><td class="code">${c.id}</td><td>${esc(c.title)}</td><td>${esc(c.sourceName)}</td><td>${c.scope.project ?? c.scope.user ?? (c.scope.organization ? "org" : c.scope.session ? "session" : "none")}</td><td>${c.ageLabel}</td><td>${c.authority}</td><td>${c.trust}</td><td>${c.contextUnits}${c.summaryUnits ? ` → ${c.summaryUnits}` : ""}${c.driftUnits ? ` (drift ${c.driftUnits})` : ""}</td></tr>`).join("\n");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Context Window Live · speaker cheat sheet</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Funnel+Display:wght@300..800&family=Funnel+Sans:ital,wght@0,300..800;1,300..800&display=swap">
<style>
@page { size: letter landscape; margin: 10mm; }
body { font: 9.5px/1.3 "Funnel Sans", system-ui, sans-serif; color: #1c403e; margin: 0; padding: 10px 14px; background: #fff; }
.mast { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin: 0 0 8px; padding-bottom: 6px; border-bottom: 1px solid #1c403e; }
h1 { font: 500 20px/1 "Funnel Display", "Funnel Sans", sans-serif; margin: 0; }
h1 small { font-size: 12px; font-weight: 400; color: #4f6a67; margin-left: 8px; letter-spacing: .02em; }
.mast .m { color: #4f6a67; font-size: 8.5px; text-transform: uppercase; letter-spacing: .06em; }
h2 { font: 500 13px/1 "Funnel Display", "Funnel Sans", sans-serif; margin: 12px 0 5px; color: #167e3c; text-transform: uppercase; letter-spacing: .06em; }
.strip { display: grid; grid-template-columns: 1.15fr 1fr 1.05fr 1.2fr; gap: 0; background: #edf3f3; border-radius: 6px; margin-bottom: 8px; }
.strip > div { padding: 7px 10px; border-left: 1px solid #fff; }
.strip > div:first-child { border-left: 0; }
.strip b { display: block; font-size: 8.5px; text-transform: uppercase; letter-spacing: .06em; color: #167e3c; margin-bottom: 4px; }
.strip ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px 8px; }
.strip .hot { grid-template-columns: max-content 1fr; }
.strip .hot.two { grid-template-columns: max-content 1fr max-content 1fr; }
.strip li { display: contents; }
.strip p { margin: 0 0 3px; }
.strip p:last-child { margin-bottom: 0; }
.strip .btns { display: flex; flex-wrap: wrap; gap: 3px; }
.strip .btns span { border: 1px solid #95a6a2; border-radius: 3px; padding: 0 5px; font-size: 8.5px; line-height: 1.6; background: #fff; white-space: nowrap; }
.strip .btns .red { border-color: #b23b3b; color: #b23b3b; }
.strip .btns .adv { border-color: #1c403e; background: #1c403e; color: #c9f36b; font-weight: 700; }
.strip .fine { color: #4f6a67; font-size: 8.5px; }
kbd { display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; font: 700 8px/1 "Funnel Sans", system-ui, sans-serif; color: #1c403e; background: #fff; border: 1px solid #95a6a2; border-bottom-width: 2px; border-radius: 3px; padding: 0; white-space: nowrap; vertical-align: middle; overflow: visible; }
.strip kbd { width: 16px; height: 16px; }
.strip kbd.multi { width: 32px; height: 16px; }
table { width: 100%; border-collapse: collapse; page-break-inside: auto; }
thead { display: table-header-group; }
th { position: sticky; top: 0; z-index: 2; background: #fff; text-align: left; font-size: 8.5px; text-transform: uppercase; letter-spacing: .05em; color: #167e3c; box-shadow: inset 0 -1px 0 #1c403e; padding: 3px 5px; }
td { vertical-align: top; padding: 4px 5px; border-bottom: .5px solid #95a6a2; }
tr { page-break-inside: avoid; }
.code { font-weight: 700; white-space: nowrap; }
.t { font-weight: 400; color: #4f6a67; }
.s { color: #4f6a67; font-size: 8.5px; }
.lesson { font-style: italic; }
.part td { position: sticky; top: var(--thead-h, 17px); z-index: 1; background: #edf3f3; padding: 5px; border-bottom: 0; box-shadow: 0 1px 0 #95a6a2; }
.part b { color: #167e3c; text-transform: uppercase; letter-spacing: .05em; font-size: 8.5px; margin-right: 8px; }
.run { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 3px 4px; vertical-align: middle; }
.cue { display: inline-flex; align-items: center; gap: 4px; border-radius: 3px; padding: 1px 5px; font-size: 8.5px; line-height: 1.4; white-space: nowrap; }
.cue.slide { background: #fff; border: 1px solid #167e3c; color: #1c403e; }
.cue.slide i { font-style: normal; font-weight: 700; color: #fff; background: #167e3c; border-radius: 2px; padding: 0 3px; min-width: 8px; text-align: center; }
.cue.live { background: #1c403e; border: 1px solid #1c403e; color: #c9f36b; font-weight: 700; letter-spacing: .04em; }
.arr { color: #4f6a67; margin: 0 1px; }
.note { display: inline-block; color: #4f6a67; margin-left: 8px; vertical-align: middle; }
.key { margin: 0 0 6px; padding: 6px 8px; border: 1px solid #95a6a2; border-radius: 6px; color: #1c403e; }
.key .cue { vertical-align: middle; margin: 0 2px; }
.status { font-weight: 700; white-space: nowrap; }
.opt td:nth-child(1) { white-space: nowrap; }
.foot { margin-top: 8px; color: #4f6a67; font-size: 8.5px; }
@media print { body { padding: 0; } th, .part td { position: static; } }
</style></head><body>
<header class="mast">
  <h1 class="title">Context Engineering - AI Productivity in Your Day to Day<small>AfroTech 2026 Run Sheet</small></h1>
  <span class="m">${PRESETS.length} presets · ${deck.length} slides · ${Object.keys(cards).length} cards</span>
</header>
<div class="strip">
  <div><b>Console hotkeys</b>
    <ul class="hot two">
      <li><kbd>[</kbd><span>Back to the previous phase.</span><kbd>S</kbd><span>Show or hide the deck.</span></li>
      <li><kbd>]</kbd><span>Advance to the next phase.</span><kbd>X</kbd><span>Next slide.</span></li>
      <li><kbd>R</kbd><span>Reset the phase; votes are kept.</span><kbd>Z</kbd><span>Previous slide.</span></li>
      <li><kbd>F</kbd><span>Freeze or unfreeze the audience.</span><kbd>P</kbd><span>Take the slide down (live view).</span></li>
      <li><kbd>L</kbd><span>Load the expected state.</span><kbd>T</kbd><span>Start or pause the talk clock.</span></li>
      <li><kbd>V</kbd><span>X-ray on or off, room-wide.</span><kbd>→</kbd><span>Next step of the run sheet: everything to press before the next spoken line.</span></li>
      <li><kbd>←</kbd><span>Back one step: reloads the preset, redoes the steps since.</span></li>
    </ul>
    <p class="fine" style="margin-top:4px">Keys are ignored while a text field has focus or with Cmd, Ctrl or Alt held; click elsewhere on the console first. Esc does nothing: it would leave full screen.</p>
    <p class="fine">Notes view, <code>/session/main/notes</code>: the note for the run sheet's current step beside the display. It follows → and ←, presets loaded by hand (click, [, ], R) and slides put up by hand; <kbd>,</kbd> and <kbd>.</kbd> look at other steps' notes without changing the display, <kbd>Home</kbd> returns, <kbd>D</kbd> shows only the note, <kbd>-</kbd> <kbd>+</kbd> <kbd>0</kbd> set its text size; drag the divider to change the widths.</p>
    <p class="fine">Talk clock, center of the console header: the big figure counts down the part's slot, green, yellow in the last 30 seconds, red when it runs out. A part's setup slide starts its slot. The small line counts the talk to 40:00 beside the part's mark.</p>
  </div>
  <div><b>Display hotkeys</b>
    <ul class="hot">
      <li><kbd>V</kbd><span>X-ray overlay on this screen only. The console's X-ray also shows here.</span></li>
      <li><kbd>I</kbd><span>Context Inspector beside an answer.</span></li>
    </ul>
    <p class="fine" style="margin-top:4px">Neither key needs the console; click the display window first so it has focus. The console's X-ray also opens the Inspector beside an answer, so the console V covers the whole talk.</p>
  </div>
  <div><b>Emergency toolbar</b>
    <div class="btns"><span>Freeze audience</span><span>Load expected state</span><span>Force good answer</span><span>Force bad answer</span><span class="red">Disable live model</span><span>Reset phase</span><span class="red">End session</span><span class="adv">Advance →</span></div>
    <p class="fine" style="margin-top:4px">Reset session appears only after End session and starts a fresh room. From an optional activity, Advance returns to the phase you left.</p>
  </div>
  <div><b>Renderer and lobby</b>
    <p>Default is the live model with a deterministic fallback when the model API is configured, otherwise deterministic. A fallback is silent on the display; the console's model API line and the facilitator view show it.</p>
    <p>Late joiners are parked until the next preset. Admit them early with the "waiting in lobby" chip in the console header.</p>
  </div>
</div>
<h2>Run of show</h2>
<p class="key">Each part heading is the cue line. <span class="cue slide"><i>n</i>file</span> put that slide on the display: click thumbnail <b>n</b> in the console strip, or step to it with X (next) and Z (back); S shows or hides the deck. <span class="cue live">LIVE 01 · 02</span> take the slide down (P or Live view) and run those presets in order with no slide up. The room keeps running under a slide, so load the next preset while the slide is up and P reveals it.</p>
<table>
<thead><tr><th>Preset</th><th>Phase · mode · policy</th><th>Say</th><th>Press</th><th>Audience</th><th>Expect · card state on load</th><th>Lesson</th></tr></thead>
${rows}
</table>
<h2>Optional activities (spec §39–46)</h2>
<table class="opt">
<thead><tr><th>Ref</th><th>Activity</th><th>Status</th><th>How to run it</th></tr></thead>
<tbody>${OPTIONAL.map((o) => `<tr><td class="code">${o.ref}</td><td><b>${esc(o.name)}</b></td><td class="status">${esc(o.status)}</td><td>${esc(o.how)}</td></tr>`).join("\n")}</tbody>
</table>
<h2>Cards</h2>
<table>
<thead><tr><th>ID</th><th>Title</th><th>Source</th><th>Scope</th><th>Age</th><th>Auth</th><th>Trust</th><th>Units (summary)</th></tr></thead>
<tbody>${cardRows}</tbody>
</table>
<script>
// Pin each part heading directly beneath the column header, and let the next part push it off.
// Browsers confine a sticky cell to the whole table, not its tbody, so the push is computed here.
const fit = () => {
  for (const t of document.querySelectorAll("table")) {
    const h = t.tHead.getBoundingClientRect().height;
    t.style.setProperty("--thead-h", h + "px");
    for (const td of t.querySelectorAll(".part td")) {
      const part = td.closest("tbody").getBoundingClientRect();
      td.style.top = Math.min(h, part.bottom - td.getBoundingClientRect().height) + "px";
    }
  }
};
let queued = false;
const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; fit(); }); } };
fit(); addEventListener("scroll", onScroll, { passive: true }); addEventListener("resize", onScroll);
</script>
<p class="foot">Generated from shared/src/presets.ts and cards.ts by <code>npm run cheatsheet</code>. Card-state abbreviations: A = ATLAS, PRIV = PRIVATE-001. Expected well-grounded answer needs A002, A005 and A010 in the window; it must not depend on APOLLO, A006, A008, PRIV or A009.</p>
</body></html>`;

const out = path.join(ROOT, "docs", "speaker-cheat-sheet.html");
fs.writeFileSync(out, html);
console.log("wrote", path.relative(ROOT, out), `${(html.length / 1024).toFixed(1)} kB`);
