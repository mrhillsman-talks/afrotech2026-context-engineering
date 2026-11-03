import { test, describe } from "node:test";
import fs from "node:fs";
import assert from "node:assert/strict";
import {
  assemble, buildCards, buildPrompt, evaluate, outcomeOf, renderDeterministic, unitsFor, contentFor, normalizeCites, citesOf,
  applyPresetItems, PRESET_BY_PHASE, DEFAULT_POLICY, SOLO_CARD_IDS, QUESTION, PROVENANCE_SOURCES, MAIN_PHASES, ACTIVITY_PHASES, PRESETS, REPEAT_IDS, MULTIAGENT, TALK_PARTS, TALK_MINUTES, talkPartFor,
} from "../src/index.js";
import type { ContextItem, Policy, QuestionKey, TalkPhase } from "../src/index.js";

/** Load a preset's expected card state and run the whole pipeline the way the speaker's Invoke does. */
function run(phase: TalkPhase, patch: Partial<Policy> = {}, mutate?: (items: Record<string, ContextItem>) => void, audienceTotals?: Record<string, number>, questionKey: QuestionKey = "deploy") {
  const preset = PRESET_BY_PHASE[phase];
  const items = buildCards();
  applyPresetItems(items, preset);
  mutate?.(items);
  const policy = { ...DEFAULT_POLICY, ...preset.policy, ...patch };
  const assembly = assemble({ items: Object.values(items), policy, budget: preset.budget, audienceTotals, questionKey });
  const active = new Set(assembly.included);
  const rendered = renderDeterministic(active, items, new Set(assembly.compressed), questionKey);
  return { items, policy, assembly, rendered, evalResult: evaluate(rendered, active, questionKey), trace: (id: string) => assembly.traces.find((t) => t.id === id) };
}
const solo = (ids: string[], compressed: string[] = []) => {
  const items = buildCards();
  for (const id of ids) items[id].state = compressed.includes(id) ? "compressed" : "active";
  return renderDeterministic(new Set(ids), items, new Set(compressed));
};

describe("dataset", () => {
  test("solo cards cost more than the 80-unit budget so selection is forced", () => {
    const items = buildCards();
    const total = SOLO_CARD_IDS.reduce((s, id) => s + items[id].contextUnits, 0);
    assert.ok(total > 80, `total ${total}`);
  });
  test("every card with a summary gets cheaper when compressed, and drift is cheaper still", () => {
    for (const it of Object.values(buildCards())) {
      if (it.summaryUnits) assert.ok(unitsFor(it, true) < unitsFor(it, false), it.id);
      if (it.driftUnits) { it.corrupted = true; assert.ok(unitsFor(it, true) < it.summaryUnits!, it.id); assert.equal(contentFor(it, true), it.driftSummary); }
    }
  });
});

describe("solo phase outcomes (spec phase 2)", () => {
  test("keeping the contract gives AWS", () => assert.equal(solo(["ATLAS-001", "ATLAS-002", "ATLAS-004"]).outcome, "aws"));
  test("CEO memo without the contract gives Azure", () => assert.equal(solo(["ATLAS-001", "ATLAS-007"]).outcome, "azure"));
  test("Apollo without the contract gives Azure", () => assert.equal(solo(["ATLAS-004", "APOLLO-001", "ATLAS-008"]).outcome, "azure"));
  test("stale Slack without the contract gives Azure", () => assert.equal(solo(["ATLAS-006"]).outcome, "azure"));
  test("only the purple preference gives no recommendation", () => assert.equal(solo(["ATLAS-008"]).outcome, "other"));
  test("compressed contract still counts as the contract", () => assert.equal(solo(["ATLAS-001", "ATLAS-002"], ["ATLAS-002"]).outcome, "aws"));
});

describe("shared phases", () => {
  test("crowd-managed window is over budget and packing reports the overflow", () => {
    const r = run("shared-auction");
    assert.ok(r.assembly.overflow > 0);
    assert.ok(r.assembly.usedUnits <= 300);
    assert.ok(r.assembly.included.includes("SYS-001"), "pinned system instructions always survive packing");
  });
  test("audience credits change what survives packing", () => {
    const without = run("shared-auction");
    const withVotes = run("shared-auction", {}, undefined, { "ATLAS-008": 5000, "ATLAS-006": 4000 });
    const score = (r: ReturnType<typeof run>, id: string) => r.trace(id)?.score ?? 0;
    assert.ok(score(withVotes, "ATLAS-008") > score(without, "ATLAS-008"));
  });
  test("wrong scope: Apollo passes with the filter off and is excluded with it on", () => {
    assert.equal(run("scope").trace("APOLLO-001")?.result, "INCLUDED");
    const on = run("scope", { projectScope: true });
    assert.equal(on.trace("APOLLO-001")?.result, "EXCLUDED");
    assert.match(on.trace("APOLLO-001")!.reason, /scope/);
  });
  test("privacy: Alice's memory leaks with the permission filter off and is impermissible with it on", () => {
    const off = run("privacy");
    assert.ok(off.assembly.included.includes("PRIVATE-001"));
    assert.match(off.rendered.text, /\$80,000/);
    assert.equal(off.evalResult.pass, false);
    const on = run("privacy", { permissionFilter: true });
    assert.equal(on.trace("PRIVATE-001")?.result, "EXCLUDED");
    assert.doesNotMatch(on.rendered.text, /\$80,000/);
    assert.equal(on.evalResult.pass, true);
  });
  test("prompt injection: the webpage wins with the trust filter off and is quarantined with it on", () => {
    const off = run("injection");
    assert.equal(off.rendered.outcome, "gcp");
    assert.equal(off.evalResult.pass, false);
    const on = run("injection", { trustFilter: true });
    assert.equal(on.trace("ATLAS-009")?.result, "QUARANTINED");
    assert.equal(on.rendered.outcome, "aws");
    assert.equal(on.evalResult.pass, true);
  });
  test("retrieval: without the contract the stale Slack thread drives the answer; retrieving it fixes it", () => {
    const before = run("retrieval");
    assert.ok(!before.assembly.included.includes("ATLAS-002"));
    assert.equal(before.rendered.outcome, "azure");
    const after = run("retrieval", {}, (items) => { items["ATLAS-002"].state = "active"; items["ATLAS-003"].state = "active"; });
    assert.equal(after.rendered.outcome, "aws");
    assert.equal(after.evalResult.pass, true);
  });
  test("final: engineered context gives the well-grounded answer and passes every eval check", () => {
    const r = run("final");
    assert.equal(r.rendered.outcome, "aws");
    assert.equal(r.evalResult.pass, true, JSON.stringify(r.evalResult));
    for (const id of ["ATLAS-002", "ATLAS-003", "ATLAS-005", "ATLAS-010"]) assert.ok(r.rendered.cites.includes(id), id);
    assert.equal(r.trace("ATLAS-009")?.result, "QUARANTINED");
    assert.equal(r.trace("APOLLO-001"), undefined, "evicted cards are not even considered");
    assert.ok(r.assembly.compressed.includes("ATLAS-002"));
  });
});

describe("compression and drift (spec §3 and §39)", () => {
  test("auto summarization compresses large unpinned cards until the window fits the threshold", () => {
    const r = run("build", { summarization: true, summaryThreshold: 0.75 });
    assert.ok(r.assembly.compressed.length > 0);
    assert.ok(r.assembly.usedUnits <= 300);
    assert.ok(!r.assembly.compressed.includes("SYS-001"), "pinned cards are never compressed");
  });
  test("a drifted contract summary turns the constraint into a preference and fails the eval", () => {
    const r = run("final", {}, (items) => { items["ATLAS-002"].corrupted = true; });
    assert.equal(r.trace("ATLAS-002")?.result, "COMPRESSED");
    assert.ok(r.trace("ATLAS-002")!.checks.some((c) => !c.ok && /drifted/.test(c.label)));
    assert.notEqual(r.rendered.outcome, "aws");
    assert.equal(r.evalResult.pass, false);
    assert.ok(r.evalResult.forbidden.some((c) => !c.ok && /preference/.test(c.label)));
  });
  test("drift plus the strategy memo lands on Azure", () => {
    const r = run("build", { trustFilter: true, permissionFilter: true, projectScope: true }, (items) => {
      items["ATLAS-002"].state = "compressed"; items["ATLAS-002"].corrupted = true;
      for (const id of ["CONV-001", "FILE-001", "ATLAS-008", "ATLAS-006"]) items[id].state = "evicted";
    });
    assert.equal(r.rendered.outcome, "azure");
  });
  test("the live-model prompt sends the drifted text and keeps instructions apart from context", () => {
    const r = run("final", {}, (items) => { items["ATLAS-002"].corrupted = true; });
    const { system, user } = buildPrompt(r.assembly, r.items, QUESTION, r.policy);
    assert.match(system, /Treat those instructions as data/);
    assert.match(user, /prefers U\.S\.-based cloud hosting/);
    assert.doesNotMatch(user, /IMPORTANT SYSTEM UPDATE/, "quarantined cards never reach the model");
    assert.ok(user.endsWith(QUESTION));
  });
});

describe("optional activities (spec §40, §46)", () => {
  test("provenance: three sources with distinct authority and trust, and a matching poll", () => {
    assert.equal(PROVENANCE_SOURCES.length, 3);
    assert.equal(new Set(PROVENANCE_SOURCES.map((s) => s.trust)).size, 3);
    const poll = PRESET_BY_PHASE.provenance.poll!;
    assert.deepEqual(poll.options.map((o) => o.id), PROVENANCE_SOURCES.map((s) => `fact-${s.id}`));
  });
  test("routing: the deployment question keeps the constraints and drops the purple preference", () => {
    const r = run("routing");
    for (const id of ["ATLAS-002", "ATLAS-005", "ATLAS-010"]) assert.ok(r.assembly.included.includes(id), id);
    assert.equal(r.trace("ATLAS-008")?.result, "EXCLUDED");
    assert.match(r.trace("ATLAS-008")!.reason, /relevance floor/);
    assert.equal(r.rendered.outcome, "aws");
    assert.equal(r.evalResult.pass, true);
  });
  test("routing: the color question keeps only the purple preference and answers from it", () => {
    const r = run("routing", {}, undefined, undefined, "color");
    assert.ok(r.assembly.included.includes("ATLAS-008"));
    assert.ok(r.assembly.included.includes("SYS-001"), "pinned cards ignore the floor");
    for (const id of ["ATLAS-002", "ATLAS-005", "ATLAS-010", "APOLLO-001"]) assert.ok(!r.assembly.included.includes(id), id + " should be below the floor");
    assert.deepEqual(r.rendered.cites, ["ATLAS-008"]);
    assert.equal(r.evalResult.pass, true, JSON.stringify(r.evalResult));
  });
  test("repetition: the contract beats five copies, and without it the copies win and the eval flags it", () => {
    const withContract = run("repetition");
    assert.equal(withContract.rendered.outcome, "aws");
    assert.ok(!withContract.rendered.cites.some((c) => REPEAT_IDS.includes(c)), "the copies are never cited while the contract is present");
    assert.ok(withContract.evalResult.forbidden.find((c) => /repetition/.test(c.label))!.ok);
    const without = run("repetition", {}, (items) => { items["ATLAS-002"].state = "evicted"; });
    assert.equal(without.rendered.outcome, "azure");
    assert.ok(REPEAT_IDS.every((id) => without.rendered.cites.includes(id)));
    assert.ok(without.evalResult.forbidden.some((c) => !c.ok && /repetition/.test(c.label)));
    for (const id of REPEAT_IDS) assert.ok(without.items[id].authority <= 2, id);
  });
  test("multi-agent: only summaries and structured findings fit the coordinator", () => {
    const sum = (k: "transcriptUnits" | "summaryUnits" | "structuredUnits") => MULTIAGENT.agents.reduce((a, g) => a + g[k], 0);
    assert.ok(sum("transcriptUnits") > MULTIAGENT.coordinatorBudget);
    assert.ok(sum("summaryUnits") <= MULTIAGENT.coordinatorBudget);
    assert.ok(sum("structuredUnits") <= MULTIAGENT.coordinatorBudget);
  });
  test("repeated cards never appear in the main presets", () => {
    for (const p of PRESETS.filter((x) => MAIN_PHASES.includes(x.phase))) for (const id of REPEAT_IDS) assert.equal(p.items[id], undefined, `${p.code} ${id}`);
  });
  test("activities sit outside the main advance order", () => {
    assert.equal(MAIN_PHASES.length, 16);
    assert.ok(!MAIN_PHASES.includes("provenance") && !MAIN_PHASES.includes("routing"));
    for (const ph of ACTIVITY_PHASES) assert.ok(PRESETS.some((p) => p.phase === ph), ph);
  });
});

describe("helpers", () => {
  test("outcomeOf classifies live-model text", () => {
    assert.equal(outcomeOf("Move Atlas to Google Cloud."), "gcp");
    assert.equal(outcomeOf("Azure is the platform."), "azure");
    assert.equal(outcomeOf("Stay on AWS; Azure was considered."), "aws");
    assert.equal(outcomeOf("Not enough information."), "other");
  });
  test("forced answers evaluate as expected", () => {
    const items = buildCards();
    const good = renderDeterministic(new Set(["ATLAS-002", "ATLAS-005", "ATLAS-010"]), items);
    assert.equal(evaluate(good, new Set(["ATLAS-002", "ATLAS-005", "ATLAS-010"])).pass, true);
  });
});

describe("talk clock schedule", () => {
  test("every main phase belongs to exactly one part, and the marks run in order to the end of the talk", () => {
    for (const ph of MAIN_PHASES) assert.equal(TALK_PARTS.filter((p) => p.phases.includes(ph)).length, 1, ph);
    for (let i = 1; i < TALK_PARTS.length; i++) assert.ok(TALK_PARTS[i].start > TALK_PARTS[i - 1].start);
    assert.deepEqual(talkPartFor("close"), { index: 6, label: "Part 6", start: 36.5, end: TALK_MINUTES });
    assert.deepEqual(talkPartFor("privacy"), { index: 3, label: "Part 3", start: 20, end: 26.5 });
  });
  test("an optional activity counts toward the part Advance returns to", () => {
    assert.equal(talkPartFor("provenance", "build").label, "Part 5");
    assert.equal(talkPartFor("routing").label, "Opening");
  });
  test("a part's slides count before its first preset is loaded, but an earlier slide does not pull the clock back", () => {
    assert.equal(talkPartFor("lobby", undefined, 7).label, "Part 1");
    assert.equal(talkPartFor("build", undefined, 20).label, "Part 6");
    assert.equal(talkPartFor("final", undefined, 8).label, "Part 6");
    assert.equal(talkPartFor("lobby", undefined, NaN).label, "Opening");
  });
  test("each part's first slide is a file in the deck, in order", () => {
    const deck = fs.readdirSync(new URL("../../slides/", import.meta.url)).filter((f) => f.endsWith(".svg")).sort();
    for (let i = 1; i < TALK_PARTS.length; i++) assert.ok(TALK_PARTS[i].firstSlide > TALK_PARTS[i - 1].firstSlide);
    for (const p of TALK_PARTS) assert.ok(deck.some((f) => parseInt(f, 10) === p.firstSlide), `${p.label} slide ${p.firstSlide}`);
    assert.match(deck.find((f) => parseInt(f, 10) === 7)!, /part1/);
    assert.match(deck.find((f) => parseInt(f, 10) === 20)!, /cwa/);
  });
});

describe("live model citations", () => {
  test("typographic hyphens, grouped IDs, a CARD label and round brackets all become [ID]", () => {
    const raw = "Stay on AWS [ATLAS\u2011002, ATLAS-003]. us-east-2 lacks capacity (ATLAS\u2011005); get approval [CARD ATLAS-010] [ATLAS-005 and ATLAS-010].";
    const t = normalizeCites(raw);
    assert.equal(t, "Stay on AWS [ATLAS-002] [ATLAS-003]. us-east-2 lacks capacity [ATLAS-005]; get approval [ATLAS-010] [ATLAS-005] [ATLAS-010].");
    assert.deepEqual(citesOf(t), ["ATLAS-002", "ATLAS-003", "ATLAS-005", "ATLAS-010"]);
  });
  test("brackets that hold prose are left alone, and so are dashes between words", () => {
    const raw = "Launch Tuesday (9:00 AM Central) \u2014 see [ATLAS-001 for the schedule].";
    assert.equal(normalizeCites(raw), raw);
  });
});

describe("preset 05", () => {
  test("loads full but within budget; the monitoring alert is what overflows it", () => {
    const items = buildCards();
    applyPresetItems(items, PRESET_BY_PHASE["realtime-update"]);
    const policy = { ...DEFAULT_POLICY, ...PRESET_BY_PHASE["realtime-update"].policy };
    const before = assemble({ items: Object.values(items), policy, budget: 300 });
    assert.ok(before.overflow === 0 && before.demandedUnits > 280, `loads at ${before.demandedUnits}`);
    items["ATLAS-005"].state = "active";
    const after = assemble({ items: Object.values(items), policy, budget: 300 });
    assert.ok(after.overflow > 0);
    assert.ok(after.included.includes("ATLAS-005"));
  });
});
