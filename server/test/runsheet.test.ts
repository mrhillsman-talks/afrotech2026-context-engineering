import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RUN_SHEET, PRESET_BY_PHASE, POLL_REVEAL_DELAY_MS, runSheetIndexOfPreset, runSheetIndexOfSlide } from "@ctx/shared";
import { Store, CommandError } from "../src/store.js";
import { slideLister } from "../src/slides.js";
import { participantView, displayView } from "../src/views.js";

const idx = (label: string) => { const i = RUN_SHEET.findIndex((s) => s.label === label); assert.ok(i >= 0, label); return i; };
const inWindow = (st: Store, id: string) => ["active", "compressed"].includes(st.state.items[id].state);
const P05 = `Preset ${PRESET_BY_PHASE["realtime-update"].code} ${PRESET_BY_PHASE["realtime-update"].name}, then Inject ATLAS-005`;

/** A fresh store with a 25-slide deck named like the real one, rendering deterministically whatever the shell env says. */
async function fresh(slides = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-sheet-"));
  const st = new Store({ fresh: true, dataDir: dir });
  if (slides) {
    const deck = path.join(dir, "slides"); fs.mkdirSync(deck);
    for (let i = 1; i <= 25; i++) fs.writeFileSync(path.join(deck, `${String(i).padStart(2, "0")}-slide.svg`), "");
    st.slides = slideLister(deck);
  }
  await st.handleSpeaker({ type: "renderer.set", renderer: "deterministic" });
  return st;
}

describe("run sheet", () => {
  test("the right arrow walks the whole talk; the end refuses", async () => {
    const st = await fresh();
    assert.equal(st.state.runStep, undefined);
    for (let i = 0; i < RUN_SHEET.length; i++) {
      await st.handleSpeaker({ type: "run.next" });
      assert.equal(st.state.runStep, i);
    }
    assert.equal(st.state.phase, "close");
    assert.equal(st.state.slide, 24, "thank-you slide is up");
    assert.equal(st.state.timer.startedAt, undefined, "clock paused for questions");
    assert.ok(st.state.timer.elapsedMs >= 0);
    assert.equal(st.state.runs.length, 8, "every Invoke ran once");
    assert.ok(st.state.xray);
    await assert.rejects(st.handleSpeaker({ type: "run.next" }), CommandError);
    assert.equal(st.state.runStep, RUN_SHEET.length - 1);
  });

  test("each step leaves the room where the script says", async () => {
    const st = await fresh();
    const upTo = async (label: string) => { while ((st.state.runStep ?? -1) < idx(label)) await st.handleSpeaker({ type: "run.next" }); };
    await upTo("Slide 01 conference"); assert.equal(st.state.slide, 0);
    await upTo("Preset 00 Lobby"); assert.equal(st.state.phase, "lobby"); assert.equal(st.state.slide, undefined, "the preset step takes slide 01 down");
    await upTo("Slide 02 title, then Start the talk clock"); assert.equal(st.state.slide, 1); assert.ok(st.state.timer.startedAt);
    await upTo("Live view"); assert.equal(st.state.slide, undefined); assert.equal(st.state.phase, "lobby");
    await upTo("Preset 01 Solo"); assert.equal(st.state.phase, "solo-select"); assert.equal(st.state.slide, undefined);
    await upTo("Voting open off, then Invoke assistant"); assert.equal(st.state.phase, "shared-auction"); assert.equal(st.state.votingOpen, false); assert.ok(st.state.xray); assert.equal(st.state.runs.length, 1);
    await upTo(P05); assert.equal(st.state.phase, "realtime-update"); assert.ok(inWindow(st, "ATLAS-005")); assert.ok(!inWindow(st, "ATLAS-010"));
    await upTo("Inject ATLAS-010"); assert.ok(inWindow(st, "ATLAS-010"));
    await upTo("Strict project scope on"); assert.equal(st.state.phase, "scope"); assert.ok(st.state.policy.projectScope);
    await upTo("Permission / privacy filter on, then Invoke assistant"); assert.equal(st.state.phase, "privacy"); assert.ok(st.state.policy.permissionFilter); assert.equal(st.state.runs.length, 3);
    await upTo("Trust · untrusted is data on, then Invoke assistant"); assert.equal(st.state.phase, "injection"); assert.ok(st.state.policy.trustFilter); assert.equal(st.state.runs.length, 5);
    await upTo("Admit audience pick, then Invoke assistant"); assert.equal(st.state.phase, "retrieval"); assert.ok(inWindow(st, "ATLAS-002"), "nobody voted, so top-k brought the contract back"); assert.equal(st.state.runs.length, 7); assert.equal(st.state.votingOpen, false, "admitting the picks froze the vote");
    const ev = st.state.events;
    const topk = ev.findIndex((e) => e.type === "runsheet" && /top-k as well/.test(e.detail));
    assert.ok(topk >= 0);
    assert.ok(ev.slice(topk + 1).some((e) => e.type === "assistant.completed"), "the Invoke in that step came after the top-k");
    await upTo("Retrieve for current question"); assert.equal(st.state.phase, "blend");
    await upTo("Context budget 150"); assert.equal(st.state.phase, "build"); assert.equal(st.state.budget, 150);
    await upTo("Context budget 300"); assert.equal(st.state.budget, 300);
    await upTo("Slide 24 questions, then Pause the talk clock"); assert.equal(st.state.phase, "close"); assert.equal(st.state.slide, 23); assert.equal(st.state.timer.startedAt, undefined);
  });

  test("the left arrow and goto replay from the preset the step sits under", async () => {
    const st = await fresh();
    await st.handleSpeaker({ type: "run.goto", index: idx("Inject ATLAS-010") });
    assert.equal(st.state.phase, "realtime-update"); assert.ok(inWindow(st, "ATLAS-005")); assert.ok(inWindow(st, "ATLAS-010"));
    await st.handleSpeaker({ type: "run.back" });
    assert.equal(st.state.runStep, idx(P05));
    assert.ok(inWindow(st, "ATLAS-005")); assert.ok(!inWindow(st, "ATLAS-010"), "the preset was reloaded, then only the first inject redone");
    await st.handleSpeaker({ type: "run.back" });
    assert.equal(st.state.runStep, idx("Voting open off, then Invoke assistant"));
    assert.equal(st.state.phase, "shared-auction"); assert.equal(st.state.votingOpen, false); assert.equal(st.state.runs.length, 1, "preset 04 reloaded, voting closed, the answer redone");
    // Back across a preset boundary lands in the previous phase with its slide up.
    await st.handleSpeaker({ type: "run.goto", index: runSheetIndexOfPreset("scope") });
    assert.equal(st.state.phase, "scope"); assert.equal(st.state.slide, undefined);
    await st.handleSpeaker({ type: "run.back" });
    assert.equal(st.state.phase, "realtime-update", "slide 11 goes up over part 2's last state");
    assert.equal(st.state.slide, 10); assert.ok(inWindow(st, "ATLAS-010"));
    await st.handleSpeaker({ type: "run.back" });
    assert.equal(st.state.slide, 9, "slide 10");
    await assert.rejects(new Promise((_, rej) => st.handleSpeaker({ type: "run.goto", index: -1 }).catch(rej)), CommandError);
  });

  test("the left arrow leaves the display the way the script has it at that step", async () => {
    const st = await fresh();
    const backFrom = async (label: string) => { await st.handleSpeaker({ type: "run.goto", index: idx(label) }); await st.handleSpeaker({ type: "run.back" }); return RUN_SHEET[st.state.runStep!].label; };
    // From a lessons slide back onto a live step: the slide comes down, because the replay starts at a preset.
    assert.equal(await backFrom("Slide 10 part 2 lessons"), "Inject ATLAS-010"); assert.equal(st.state.slide, undefined); assert.ok(inWindow(st, "ATLAS-010"));
    assert.equal(await backFrom("Slide 14 part 4 lessons"), "Preset 10 Reveal pipeline"); assert.equal(st.state.slide, undefined); assert.equal(st.state.phase, "reveal");
    assert.equal(await backFrom("Slide 19 part 5 lessons"), "Context budget 300"); assert.equal(st.state.slide, undefined); assert.equal(st.state.budget, 300);
    // The two clock steps sit under a slide, and the replay puts that slide back.
    assert.equal(await backFrom("Slide 03 base"), "Slide 02 title, then Start the talk clock"); assert.equal(st.state.slide, 1); assert.ok(st.state.timer.startedAt, "the clock keeps running");
    assert.equal(await backFrom("Slide 25 thank you"), "Slide 24 questions, then Pause the talk clock"); assert.equal(st.state.slide, 23); assert.equal(st.state.timer.startedAt, undefined);
  });

  test("a preset or slide chosen by hand moves the sheet; activities and unknown slides do not", async () => {
    const st = await fresh();
    await st.handleSpeaker({ type: "preset", phase: "privacy" });
    assert.equal(st.state.runStep, runSheetIndexOfPreset("privacy"));
    await st.handleSpeaker({ type: "run.next" });
    assert.equal(st.state.runs.length, 1, "the step after preset 07 is Invoke");
    await st.handleSpeaker({ type: "advance" });
    assert.equal(st.state.runStep, runSheetIndexOfPreset("injection"));
    await st.handleSpeaker({ type: "reset" });
    assert.equal(st.state.runStep, runSheetIndexOfPreset("injection"));
    await st.handleSpeaker({ type: "preset", phase: "provenance" });
    assert.equal(st.state.runStep, runSheetIndexOfPreset("injection"), "an activity leaves the cursor where it was");
    await st.handleSpeaker({ type: "slide.set", index: 12 });
    assert.equal(st.state.runStep, runSheetIndexOfSlide(13));
    await st.handleSpeaker({ type: "slide.step", delta: 1 });
    assert.equal(st.state.runStep, runSheetIndexOfSlide(14));
    // A preset clicked by hand leaves the slide up; the sheet's own preset step takes it down.
    await st.handleSpeaker({ type: "preset", phase: "buy" });
    assert.equal(st.state.slide, 13); assert.equal(st.state.runStep, runSheetIndexOfPreset("buy"));
    await st.handleSpeaker({ type: "run.next" }); assert.equal(st.state.slide, 16, "slide 17 blend");
    await st.handleSpeaker({ type: "run.next" }); assert.equal(st.state.phase, "blend"); assert.equal(st.state.slide, undefined);
    await st.handleSpeaker({ type: "session.reset" });
    assert.equal(st.state.runStep, undefined);
  });

  test("the cursor moves when a step starts, so a slow Invoke shows as current at once; a failed step puts it back", async () => {
    const st = await fresh();
    const invoke = runSheetIndexOfPreset("privacy") + 1;
    assert.equal(RUN_SHEET[invoke].label, "Invoke assistant");
    await st.handleSpeaker({ type: "run.goto", index: invoke - 1 });
    // A model that answers only when told to.
    const answer = st.runAssistant.bind(st);
    let release!: () => void;
    st.runAssistant = async (force) => { await new Promise<void>((r) => { release = r; }); return answer(force); };
    const going = st.handleSpeaker({ type: "run.next" });
    await new Promise((r) => setImmediate(r));
    assert.equal(st.state.runStep, invoke, "current before the answer");
    assert.equal(st.state.runs.length, 0);
    release(); await going;
    assert.equal(st.state.runStep, invoke);
    assert.equal(st.state.runs.length, 1);
    await st.handleSpeaker({ type: "run.back" });
    st.runAssistant = async () => { throw new CommandError("model down"); };
    await assert.rejects(st.handleSpeaker({ type: "run.next" }), /model down/);
    assert.equal(st.state.runStep, invoke - 1, "the failed step is not current");
  });

  test("the last slide shown outlives the live view and a restart, so S after a reload does not go back to slide 1", async () => {
    const st = await fresh();
    await st.handleSpeaker({ type: "slide.set", index: 12 });
    await st.handleSpeaker({ type: "slide.set", index: null });
    assert.equal(st.state.slide, undefined);
    assert.equal(st.state.lastSlide, 12);
    await new Promise((r) => setTimeout(r, 2200)); // the snapshot is written two seconds after a change
    const again = new Store({ fresh: false, dataDir: st.dataDir });
    assert.equal(again.state.lastSlide, 12);
    await again.handleSpeaker({ type: "session.reset" });
    assert.equal(again.state.lastSlide, undefined, "a fresh room starts from the first slide");
  });

  test("without a deck, slide steps are skipped and the sheet still runs", async () => {
    const st = await fresh(false);
    while ((st.state.runStep ?? -1) < runSheetIndexOfPreset("solo-select")) await st.handleSpeaker({ type: "run.next" });
    assert.equal(st.state.slide, undefined);
    assert.equal(st.state.phase, "solo-select");
    assert.ok(st.state.events.some((e) => /no slide 1 in slides/.test(e.detail)));
  });

  test("presets 01 and 02 each allow one run, then lock the picks", async () => {
    const st = await fresh(false);
    const p = st.register("Ada", "Lovelace", "use");
    await st.handleSpeaker({ type: "preset", phase: "solo-select" });
    st.handleParticipant(p, { type: "solo.toggle", itemId: "ATLAS-002" });
    st.handleParticipant(p, { type: "solo.run" });
    const first = p.solo.lastRun;
    assert.throws(() => st.handleParticipant(p, { type: "solo.toggle", itemId: "ATLAS-002" }), CommandError);
    assert.throws(() => st.handleParticipant(p, { type: "solo.set", itemId: "ATLAS-002", state: "available" }), CommandError);
    assert.throws(() => st.handleParticipant(p, { type: "solo.run" }), CommandError);
    assert.equal(p.solo.items["ATLAS-002"], "active"); assert.equal(p.solo.lastRun, first);
    await st.handleSpeaker({ type: "preset", phase: "solo-compress" });
    st.handleParticipant(p, { type: "solo.set", itemId: "ATLAS-002", state: "compressed" });
    st.handleParticipant(p, { type: "solo.run" });
    assert.notEqual(p.solo.lastRun, first, "02 gets its own run");
    assert.throws(() => st.handleParticipant(p, { type: "solo.run" }), CommandError);
    assert.throws(() => st.handleParticipant(p, { type: "solo.set", itemId: "ATLAS-002", state: "active" }), CommandError);
    assert.equal(p.solo.items["ATLAS-002"], "compressed");
    await st.handleSpeaker({ type: "preset", phase: "solo-compress" });
    assert.throws(() => st.handleParticipant(p, { type: "solo.run" }), CommandError, "re-clicking 02 keeps the lock");
  });

  test("preset 03 role Send opens after the countdown", async () => {
    const st = await fresh(false);
    const p = st.register("Ada", "Lovelace", "use");
    await st.handleSpeaker({ type: "preset", phase: "shared-collect" });
    assert.equal(p.role, "crm");
    assert.throws(() => st.handleParticipant(p, { type: "role.send" }), /Send opens in 10 s/);
    assert.equal(p.roleSent, false);
    st.state.roleSendOpensAt = Date.now() - 1; // the countdown has run out
    st.handleParticipant(p, { type: "role.send" });
    assert.equal(p.roleSent, true);
    assert.equal(st.state.items["ATLAS-002"].state, "active");
    // Held roles never send; their cards come in with later presets.
    const held = st.register("Grace", "Hopper", "use");
    held.parked = false; held.role = "monitoring"; // joined mid-phase, so unpark it for the check
    assert.throws(() => st.handleParticipant(held, { type: "role.send" }), /speaker brings your card in/);
    assert.equal(held.roleSent, false);
  });

  test("a phone sees poll tallies only after its own vote or when the poll closes", async () => {
    const st = await fresh(false);
    const a = st.register("Ada", "Lovelace", "use"); const b = st.register("Grace", "Hopper", "use");
    await st.handleSpeaker({ type: "preset", phase: "realtime-update" });
    const poll = st.state.polls[st.state.activePollId!]; const opt = poll.options[0].id;
    st.handleParticipant(a, { type: "poll.vote", pollId: poll.id, optionId: opt });
    const seenByB = participantView(st, b).poll!;
    assert.deepEqual(seenByB.counts, {}); assert.equal(seenByB.countsHidden, true); assert.equal(seenByB.answers, 1);
    assert.deepEqual(participantView(st, a).poll!.counts, { [opt]: 1 }, "the voter sees results");
    await st.handleSpeaker({ type: "poll.close" });
    assert.deepEqual(participantView(st, b).poll!.counts, { [opt]: 1 }, "closing reveals to everyone");
  });

  test("the big screen holds poll percentages for 15 seconds after the poll opens", async () => {
    const st = await fresh(false);
    await st.handleSpeaker({ type: "preset", phase: "realtime-update" });
    const ms = displayView(st, "").pollRevealInMs;
    assert.ok(ms > POLL_REVEAL_DELAY_MS - 1000 && ms <= POLL_REVEAL_DELAY_MS, `held back ${ms} ms`);
    st.state.pollOpenedAt = Date.now() - POLL_REVEAL_DELAY_MS; // 15 s later
    assert.equal(displayView(st, "").pollRevealInMs, 0);
    await st.handleSpeaker({ type: "preset", phase: "realtime-update" });
    assert.equal(displayView(st, "").pollRevealInMs, 0, "Reset of the same preset does not restart the wait");
    await st.handleSpeaker({ type: "poll.close" });
    await st.handleSpeaker({ type: "poll.open", pollId: st.state.activePollId! });
    assert.ok(displayView(st, "").pollRevealInMs > 0, "Reopen poll restarts the wait");
  });

  test("preset 05 injects spotlight the arrival and the card it pushes out", async () => {
    const st = await fresh(false);
    await st.handleSpeaker({ type: "preset", phase: "realtime-update" });
    assert.equal(st.state.spotlight, undefined);
    await st.handleSpeaker({ type: "item.inject", itemId: "ATLAS-005" });
    assert.equal(st.state.spotlight?.[0], "ATLAS-005");
    assert.ok(st.state.spotlight!.includes("ATLAS-006"), `old Slack pushed out: ${st.state.spotlight}`);
    await st.handleSpeaker({ type: "item.inject", itemId: "ATLAS-010" });
    assert.equal(st.state.spotlight?.[0], "ATLAS-010");
    assert.ok(st.state.spotlight!.includes("ATLAS-007"), `CEO memo pushed out: ${st.state.spotlight}`);
    await st.handleSpeaker({ type: "preset", phase: "scope" });
    assert.equal(st.state.spotlight, undefined, "a new preset clears it");
  });

  test("preset 06 hides tallies from phones until they vote and holds the big screen 15 seconds", async () => {
    const st = await fresh(false);
    const a = st.register("Ada", "Lovelace", "use"); const b = st.register("Grace", "Hopper", "use");
    await st.handleSpeaker({ type: "preset", phase: "realtime-update" });
    st.state.pollOpenedAt = Date.now() - POLL_REVEAL_DELAY_MS; // 05's wait is long over
    await st.handleSpeaker({ type: "preset", phase: "scope" });
    assert.ok(displayView(st, "").pollRevealInMs > POLL_REVEAL_DELAY_MS - 1000, "06 starts its own 15 s wait");
    const poll = st.state.polls[st.state.activePollId!]; const opt = poll.options[0].id;
    st.handleParticipant(a, { type: "poll.vote", pollId: poll.id, optionId: opt });
    assert.equal(participantView(st, b).poll!.countsHidden, true);
    assert.deepEqual(participantView(st, b).poll!.counts, {});
    assert.deepEqual(participantView(st, a).poll!.counts, { [opt]: 1 });
  });

  test("preset 15 turns the event log replay on; other presets turn it off", async () => {
    const st = await fresh(false);
    await st.handleSpeaker({ type: "preset", phase: "final" });
    assert.equal(st.state.replay, false);
    await st.handleSpeaker({ type: "preset", phase: "close" });
    assert.equal(st.state.replay, true);
    await st.handleSpeaker({ type: "replay.set", on: false });
    assert.equal(st.state.replay, false, "the console switch still turns it off");
    await st.handleSpeaker({ type: "preset", phase: "final" });
    assert.equal(st.state.replay, false);
  });

  test("09 hides pick counts from phones until they pick and holds the big screen back", async () => {
    const st = await fresh(false);
    const ps = ["Ada", "Grace", "Alan", "Edsger"].map((n) => st.register(n, "X", "use"));
    await st.handleSpeaker({ type: "preset", phase: "retrieval" });
    const [a] = st.state.retrievalCandidates;
    assert.deepEqual(displayView(st, "").retrievalReveal, { picks: 0, hidden: true, inMs: -1 }, "no pick yet: held, no countdown");
    st.handleParticipant(ps[0], { type: "retrieval.vote", itemId: a });
    const pv = participantView(st, ps[1]);
    assert.equal(pv.retrievalVotesHidden, true); assert.deepEqual(pv.retrievalVotes, {});
    assert.deepEqual(participantView(st, ps[0]).retrievalVotes, { [a]: 1 }, "the picker sees the room");
    const r1 = displayView(st, "").retrievalReveal;
    assert.equal(r1.hidden, true); assert.ok(r1.inMs > POLL_REVEAL_DELAY_MS - 1000, "15 s from the first pick");
    st.handleParticipant(ps[1], { type: "retrieval.vote", itemId: a });
    assert.equal(displayView(st, "").retrievalReveal.hidden, false, "half the room has picked");
    await st.handleSpeaker({ type: "preset", phase: "build" });
    await st.handleSpeaker({ type: "preset", phase: "retrieval" });
    st.handleParticipant(ps[2], { type: "retrieval.vote", itemId: a });
    st.state.retrievalFirstPickAt = Date.now() - POLL_REVEAL_DELAY_MS;
    assert.equal(displayView(st, "").retrievalReveal.hidden, false, "15 s after the first pick");
  });

  test("a poll answer is final; Reopen poll clears it", async () => {
    const st = await fresh(false);
    const p = st.register("Ada", "Lovelace", "use");
    await st.handleSpeaker({ type: "preset", phase: "scope" });
    const poll = st.state.polls[st.state.activePollId!];
    const [yes, no] = poll.options.map((o) => o.id);
    st.handleParticipant(p, { type: "poll.vote", pollId: poll.id, optionId: yes });
    assert.throws(() => st.handleParticipant(p, { type: "poll.vote", pollId: poll.id, optionId: no }), CommandError);
    assert.throws(() => st.handleParticipant(p, { type: "poll.vote", pollId: poll.id, optionId: yes }), CommandError);
    assert.deepEqual(st.state.polls[poll.id].counts, { [yes]: 1 });
    await st.handleSpeaker({ type: "preset", phase: "scope" });
    assert.deepEqual(st.state.polls[poll.id].counts, { [yes]: 1 }, "Reset phase keeps the room's answers");
    await st.handleSpeaker({ type: "poll.close" });
    await st.handleSpeaker({ type: "poll.open", pollId: poll.id });
    st.handleParticipant(p, { type: "poll.vote", pollId: poll.id, optionId: no });
    assert.deepEqual(st.state.polls[poll.id].counts, { [no]: 1 });
  });

  test("a retrieval pick is final on the first tap", async () => {
    const st = await fresh(false);
    const p = st.register("Ada", "Lovelace", "use");
    await st.handleSpeaker({ type: "preset", phase: "retrieval" });
    await st.handleSpeaker({ type: "assistant.run" });
    const [a, b] = st.state.retrievalCandidates;
    st.handleParticipant(p, { type: "retrieval.vote", itemId: a });
    assert.throws(() => st.handleParticipant(p, { type: "retrieval.vote", itemId: b }), /locked in/);
    assert.deepEqual(st.retrievalVotes(), { [a]: 1 });
    await st.handleSpeaker({ type: "retrieve.voted" });
    assert.equal(st.state.votingOpen, false);
    assert.throws(() => st.handleParticipant(p, { type: "retrieval.vote", itemId: a }), CommandError);
  });
});
