import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { replayEvents, replayTimeline, replayPosition, replayTally, runSheetIndexOfPreset, SOLO_CARD_IDS } from "@ctx/shared";
import { Store, CommandError } from "../src/store.js";

function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-replay-"));
  return { st: new Store({ fresh: true, dataDir: dir }), dir };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("replay clock", () => {
  test("controls refuse while replay is off", async () => {
    const { st } = fresh();
    for (const cmd of [{ type: "replay.play" }, { type: "replay.pause" }, { type: "replay.seek", ms: 0 }] as const)
      await assert.rejects(st.handleSpeaker(cmd), CommandError);
  });

  test("turning replay on cuts the log there and builds the same timeline the display will", async () => {
    const { st } = fresh();
    for (let i = 0; i < 30; i++) st.register("Ada", "Okafor", "use", true);
    await st.handleSpeaker({ type: "preset", phase: "solo-select" });
    await st.handleSpeaker({ type: "replay.set", on: true });
    const c = st.state.replayClock!;
    assert.ok(c.startedAt !== undefined && c.offsetMs === 0);
    const t = replayTimeline(replayEvents(st.state.events, c));
    assert.equal(c.durationMs, t.durationMs);
    assert.deepEqual(c.chapters.map((x) => x.code), ["01"]);
    st.register("Late", "Joiner", "use", true);
    assert.equal(replayEvents(st.state.events, c).length, c.count, "later events stay out, even in the same millisecond");
  });

  test("pause banks the position, seek clamps and keeps paused, play at the end starts over", async () => {
    const { st } = fresh();
    await st.handleSpeaker({ type: "preset", phase: "solo-select" });
    await st.handleSpeaker({ type: "replay.set", on: true });
    await sleep(30);
    await st.handleSpeaker({ type: "replay.pause" });
    const c = st.state.replayClock!;
    assert.equal(c.startedAt, undefined);
    assert.ok(c.offsetMs >= 25, `${c.offsetMs}`);
    await st.handleSpeaker({ type: "replay.seek", ms: 1e9 });
    assert.equal(st.state.replayClock!.offsetMs, c.durationMs);
    assert.equal(st.state.replayClock!.startedAt, undefined, "seek keeps it paused");
    await st.handleSpeaker({ type: "replay.play" });
    assert.equal(st.state.replayClock!.offsetMs, 0, "play at the end starts over");
    await st.handleSpeaker({ type: "replay.seek", ms: -5 });
    assert.equal(st.state.replayClock!.offsetMs, 0);
    assert.ok(st.state.replayClock!.startedAt !== undefined, "seek keeps it playing");
    assert.ok(replayPosition(st.state.replayClock!, Date.now()) <= c.durationMs);
    // Ran out while playing: Play starts over too.
    st.state.replayClock = { ...st.state.replayClock!, startedAt: Date.now() - c.durationMs - 1000 };
    await st.handleSpeaker({ type: "replay.play" });
    assert.ok(replayPosition(st.state.replayClock!, Date.now()) < 100);
  });

  test("preset 15 starts the replay with its own phase change as the last chapter; any other preset stops it", async () => {
    const { st } = fresh();
    await st.handleSpeaker({ type: "preset", phase: "solo-select" });
    await st.handleSpeaker({ type: "preset", phase: "close" });
    assert.equal(st.state.replay, true);
    assert.deepEqual(st.state.replayClock!.chapters.map((x) => x.code), ["01", "15"]);
    await st.handleSpeaker({ type: "preset", phase: "solo-select" });
    assert.equal(st.state.replay, false);
    assert.equal(st.state.replayClock, undefined);
  });

  test("replay off clears the clock, and replay controls do not show up in the replay", async () => {
    const { st } = fresh();
    await st.handleSpeaker({ type: "replay.set", on: true });
    await st.handleSpeaker({ type: "replay.pause" });
    await st.handleSpeaker({ type: "replay.set", on: false });
    assert.equal(st.state.replayClock, undefined);
    assert.ok(replayEvents(st.state.events, { until: "2099-01-01T00:00:00Z", count: 1e9 }).every((e) => e.type !== "display"));
  });

  test("a snapshot taken during replay without a clock gets one on restart", async () => {
    const { st, dir } = fresh();
    await st.handleSpeaker({ type: "replay.set", on: true });
    const { replayClock: _, ...old } = st.state;
    fs.writeFileSync(path.join(dir, "snapshot.json"), JSON.stringify({ state: old, participants: [], nextNumber: 1 }));
    const again = new Store({ fresh: false, dataDir: dir });
    assert.ok(again.state.replayClock);
  });
});

describe("replay tally against the session", () => {
  test("after the whole run sheet the replay ends on the Close screen's numbers and on the cards as 14 left them", async () => {
    const { st } = fresh();
    await st.handleSpeaker({ type: "renderer.set", renderer: "deterministic" });
    const people = ["A", "B", "C"].map((n) => st.register(n, "Test", "use", true));
    const close = runSheetIndexOfPreset("close");
    let before: Record<string, string> = {};
    for (let i = 0; i <= close; i++) {
      if (i === close) before = Object.fromEntries(Object.values(st.state.items).map((it) => [it.id, it.state]));
      await st.handleSpeaker({ type: "run.next" });
      // Solo choices change the stats without a card event; the snapshot at the next preset carries them.
      if (st.state.phase === "solo-select" && !people[0].solo.ranIn)
        for (const p of people) { st.handleParticipant(p, { type: "solo.set", itemId: SOLO_CARD_IDS[0], state: "active" }); st.handleParticipant(p, { type: "solo.set", itemId: SOLO_CARD_IDS[0], state: "available" }); }
    }
    assert.equal(st.state.phase, "close");
    const events = replayEvents(st.state.events, st.state.replayClock!);
    const t = replayTally(events, events.length);
    const s = st.state.stats;
    assert.ok(s.evictions >= 3, JSON.stringify(s));
    assert.deepEqual([t.evictions, t.summaries, t.retrievals], [s.evictions, s.summaries, s.retrievals]);
    for (const [id, state] of Object.entries(t.cards)) assert.equal(state, before[id], id);
    assert.ok(Object.values(t.cards).some((x) => x !== "available"));
  });
});
