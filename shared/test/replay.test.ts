import { test } from "node:test";
import assert from "node:assert/strict";
import { REPLAY_TARGET_MS, replayEvents, replayTimeline, replayRevealed, replayLine, replayPosition, replayTally } from "../src/index.js";
import type { EventLogEntry } from "../src/index.js";

let t0 = Date.parse("2026-11-02T10:00:00Z");
const ALL = { until: "2099-01-01T00:00:00Z", count: 1e9 };
const ev = (type: string, detail = "", itemId?: string): EventLogEntry => ({ at: new Date(t0++).toISOString(), type, detail, itemId });

/** A talk-shaped log: 100 joins, a run-sheet line per step, two solo phases of 100 runs, a few dozen story events. */
function talk() {
  const log: EventLogEntry[] = [ev("simulation", "100 simulated participants joined")];
  for (let i = 1; i <= 100; i++) log.push(ev("participant.joined", `P${i} joined`));
  log.push(ev("runsheet", "1. Slide 02"), ev("phase.changed", "01 Solo select"), ev("runsheet", "2. Preset 01"));
  for (let i = 1; i <= 100; i++) log.push(ev("assistant.solo", `P${i}: ${i <= 60 ? "aws" : "azure"}`));
  log.push(ev("phase.changed", "02 Solo compress"));
  for (let i = 1; i <= 100; i++) log.push(ev("assistant.solo", `P${i}: aws`));
  for (let i = 0; i < 40; i++) log.push(ev("context.active", `ATLAS-00${i % 9} available → active (speaker)`, `ATLAS-00${i % 9}`), ev("runsheet", `${i + 3}. step`));
  log.push(ev("phase.changed", "15 Close"), ev("display", "replay started"));
  return log;
}

test("crowd runs collapse to one frame each and quiet events take no frame", () => {
  const log = replayEvents(talk(), ALL);
  const t = replayTimeline(log);
  assert.equal(t.frames.filter((f) => f.crowd).length, 3);
  assert.equal(t.frames.length, 3 + 3 + 40, "three crowd frames, three phase changes, forty card moves");
  assert.equal(t.frames[0].start, 0, "the leading quiet event belongs to the first frame");
  assert.equal(t.frames[t.frames.length - 1].end, log.length, "frames cover the whole list");
  for (let i = 1; i < t.frames.length; i++) assert.equal(t.frames[i].start, t.frames[i - 1].end);
});

test("the replay lasts about the target whatever the room size, and story frames stay readable", () => {
  const t = replayTimeline(talk());
  assert.ok(Math.abs(t.durationMs - REPLAY_TARGET_MS) < 100, `${t.durationMs} ms`);
  const story = t.frames.find((f) => !f.crowd)!;
  assert.ok(story.ms >= 900, `story frame ${story.ms} ms`);
  const joins = t.frames.find((f) => f.crowd === "participant.joined")!;
  assert.ok(Math.abs(joins.ms - 2 * story.ms) <= 1, "100 joins weigh two story frames");
});

test("a short log does not stretch to the target", () => {
  const t = replayTimeline([ev("phase.changed", "01 Solo select"), ev("context.active", "x")]);
  assert.equal(t.durationMs, 2 * 1200);
});

test("chapters mark each phase change at its frame", () => {
  const t = replayTimeline(talk());
  assert.deepEqual(t.chapters.map((c) => `${c.code} ${c.name}`), ["01 Solo select", "02 Solo compress", "15 Close"]);
  for (const c of t.chapters) assert.ok(t.frames.some((f) => f.atMs === c.atMs));
});

test("crowd frames fill in across their time; story frames show at once; the end shows everything", () => {
  const log = talk();
  const t = replayTimeline(log);
  const joins = t.frames[0];
  assert.equal(replayRevealed(t, 0, log.length), 1);
  const half = replayRevealed(t, joins.atMs + joins.ms / 2, log.length);
  assert.ok(half > 40 && half < 62, `${half}`);
  const story = t.frames[1];
  assert.equal(replayRevealed(t, story.atMs, log.length), story.end);
  assert.equal(replayRevealed(t, t.durationMs, log.length), log.length);
});

test("crowd lines summarize what is shown so far", () => {
  const log = talk();
  const t = replayTimeline(log);
  assert.equal(replayLine(log, t.frames[0], t.frames[0].end).detail, "100 participants joined");
  const solo = t.frames.find((f) => f.crowd === "assistant.solo")!;
  assert.equal(replayLine(log, solo, solo.end).detail, "100 solo runs: 60 AWS · 40 AZURE");
  assert.equal(replayLine(log, solo, solo.start + 10).detail, "10 solo runs: 10 AWS");
  assert.equal(replayLine(log, t.frames[1], t.frames[1].end).type, "phase.changed", "a story line is its own event, not the quiet one after it");
});

test("the cut leaves out display events and anything after the replay started", () => {
  const log = talk();
  const until = log[50].at;
  assert.equal(replayEvents(log, { until, count: 1e9 }).length, 51);
  assert.equal(replayEvents(log, { until, count: 20 }).length, 20, "the count keeps out same-millisecond events");
  assert.ok(replayEvents(log, ALL).every((e) => e.type !== "display"));
});

test("the playhead counts on while playing and stops at the end", () => {
  const clock = { offsetMs: 1000, startedAt: 10_000, durationMs: 5000 };
  assert.equal(replayPosition(clock, 12_000), 3000);
  assert.equal(replayPosition(clock, 99_000), 5000);
  assert.equal(replayPosition({ ...clock, startedAt: undefined }, 99_000), 1000);
});

test("the tally skips the Close preset's card reset, so the end shows the cards as the room left them", () => {
  const log = [
    ev("context.states", "ATLAS-001=active ATLAS-002=compressed"), ev("phase.changed", "14 Final"),
    ev("context.evicted", "ATLAS-001 active → evicted (speaker)", "ATLAS-001"),
    ev("context.states", "ATLAS-002=available ATLAS-001=available"), ev("runsheet", "55. Preset 15"), ev("phase.changed", "15 Close"),
  ];
  const t = replayTally(log, log.length);
  assert.deepEqual(t.cards, { "ATLAS-001": "evicted", "ATLAS-002": "compressed" });
  assert.equal(t.moves["ATLAS-001"], 1);
  assert.equal(t.phase, "Close");
  const early = [ev("context.states", "ATLAS-001=active"), ev("phase.changed", "01 Solo"), ev("context.states", "ATLAS-001=available"), ev("phase.changed", "02 Context pressure")];
  assert.equal(replayTally(early, early.length).cards["ATLAS-001"], "available", "other presets' clears still apply");
});

test("counters start from the latest stats snapshot and add card moves by the server's rule", () => {
  const log = [
    ev("context.evicted", "ATLAS-001 active → evicted (speaker)", "ATLAS-001"),
    ev("stats", "decisions=40 evictions=30 summaries=20 retrievals=2 submissions=1"),
    ev("context.evicted", "ATLAS-002 active → evicted (speaker)", "ATLAS-002"),
    ev("context.active", "ATLAS-003 available → active (retrieval)", "ATLAS-003"),
    ev("context.active", "ATLAS-002 evicted → active (P7)", "ATLAS-002"),
    ev("context.active", "ATLAS-004 available → active (P3)", "ATLAS-004"),
    ev("context.compressed", "ATLAS-004 active → compressed (audience)", "ATLAS-004"),
  ];
  const t = replayTally(log, log.length);
  assert.deepEqual([t.evictions, t.summaries, t.retrievals], [31, 21, 4], "a role sending its own card and a compress of an active card are not retrievals");
  const before = replayTally(log, 1);
  assert.deepEqual([before.evictions, before.summaries, before.retrievals], [1, 0, 0], "with no snapshot yet, card moves only");
});
