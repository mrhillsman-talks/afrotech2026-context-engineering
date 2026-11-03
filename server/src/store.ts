import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assemble, buildCards, evaluate, outcomeOf, renderDeterministic, buildPrompt, unitsFor, normalizeCites, citesOf,
  GOOD_ANSWER, BAD_ANSWER, DEFAULT_POLICY, PRESETS, PRESET_BY_PHASE, PHASES, QUESTION, QUESTIONS, MAIN_PHASES, ACTIVITY_PHASES, applyPresetItems, relevanceFor,
  SOLO_CARD_IDS, ROLE_BY_ID, ROLE_SEND_DELAY_MS, ROLE_DEAL_ORDER, BUY_SOURCES, BLEND_SOURCES, BLEND_SOURCE_CARDS, talkPartFor,
  RUN_SHEET, isSpeakerCmd, runSheetCheckpoint, runSheetIndexOfPreset, runSheetIndexOfSlide,
  replayEvents, replayTimeline, replayPosition, statsDetail,
} from "@ctx/shared";
import type {
  AssistantRun, Command, ContextItem, ItemState, Participant, ParticipantCommand, Policy, Preset,
  SessionState, SpeakerCommand, TalkPhase, Rendered as _R,
} from "@ctx/shared";
import { llmConfigured, renderLive } from "./llm.js";
export { isSpeakerCommand } from "@ctx/shared";

export class CommandError extends Error {}

const DEFAULT_DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data");

function freshState(): SessionState {
  const items = buildCards();
  return {
    id: "main", version: 1, phase: "lobby", question: QUESTION, questionKey: "deploy",
    policy: { ...DEFAULT_POLICY }, renderer: llmConfigured() ? "live-fallback" : "deterministic",
    budget: 400, soloBudget: 80,
    registrationOpen: true, submissionOpen: false, votingOpen: false, frozen: false, xray: false, showResponse: false, replay: false,
    items, runs: [], polls: {}, retrievalCandidates: [], staging: [], events: [],
    stats: { decisions: 0, evictions: 0, summaries: 0, retrievals: 0, submissions: 0 },
    llmStatus: llmConfigured() ? "ok" : "unset", startedAt: new Date().toISOString(),
    timer: { elapsedMs: 0 },
  };
}

export class Store {
  state: SessionState;
  participants = new Map<string, Participant>();
  byToken = new Map<string, string>();
  private listeners = new Set<() => void>();
  private saveTimer?: NodeJS.Timeout;
  private eventTimes: number[] = [];
  nextNumber = 1;
  readonly dataDir: string;
  private readonly snapshotFile: string;
  private readonly eventsFile: string;

  constructor(opts: { fresh: boolean; dataDir?: string }) {
    this.dataDir = opts.dataDir ?? DEFAULT_DATA_DIR;
    this.snapshotFile = path.join(this.dataDir, "snapshot.json");
    this.eventsFile = path.join(this.dataDir, "events.ndjson");
    this.state = freshState();
    if (!opts.fresh) this.load();
  }

  /* ---------- persistence ---------- */
  private load() {
    try {
      if (!fs.existsSync(this.snapshotFile)) return;
      const raw = JSON.parse(fs.readFileSync(this.snapshotFile, "utf8"));
      // Cards always come from code so edits to the dataset win; only their state survives a restart.
      const items = buildCards();
      for (const id of Object.keys(items)) {
        const saved = raw.state.items?.[id];
        if (saved) { items[id].state = saved.state; items[id].pinned = saved.pinned; items[id].submittedBy = saved.submittedBy; items[id].corrupted = !!saved.corrupted; }
      }
      this.state = { ...freshState(), ...raw.state, items, llmStatus: llmConfigured() ? "ok" : "unset" };
      for (const p of raw.participants as Participant[]) {
        p.connected = 0;
        this.participants.set(p.id, p);
        this.byToken.set(p.token, p.id);
      }
      this.nextNumber = raw.nextNumber ?? this.participants.size + 1;
      if (this.state.replay && !this.state.replayClock) this.startReplay();
      console.log(`restored snapshot: phase=${this.state.phase} v${this.state.version} participants=${this.participants.size}`);
    } catch (e) {
      console.warn("snapshot load failed, starting fresh", e);
    }
  }
  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      try {
        fs.mkdirSync(this.dataDir, { recursive: true });
        const tmp = this.snapshotFile + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify({ state: this.state, participants: [...this.participants.values()], nextNumber: this.nextNumber }));
        fs.renameSync(tmp, this.snapshotFile);
      } catch (e) { console.warn("snapshot save failed", e); }
    }, 2000);
  }

  /* ---------- change notification ---------- */
  onChange(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private touch() { this.syncTalkPart(); this.state.version++; this.scheduleSave(); for (const l of this.listeners) l(); }
  /**
   * Note the talk-clock time at which the speaker entered the current part, so the console can count that part's slot
   * down from there. Moving forward starts the part's slot afresh; going back to an earlier part resumes the slot it had.
   */
  private syncTalkPart() {
    const s = this.state;
    const slideName = s.slide !== undefined ? this.slides?.()[s.slide] : undefined;
    const part = talkPartFor(s.phase, s.activityReturn, slideName ? parseInt(slideName, 10) : undefined);
    const i = part.index;
    const t = s.timer;
    if (t.partIndex === i) return;
    const now = t.elapsedMs + (t.startedAt !== undefined ? Date.now() - t.startedAt : 0);
    const marks = { ...t.partMarks };
    // With no part noted yet (a new session, or a snapshot from before parts were tracked), the part's own mark is the best guess.
    if (t.partIndex === undefined) marks[i] = Math.min(now, part.start * 60_000);
    else if (i > t.partIndex || marks[i] === undefined) marks[i] = now;
    s.timer = { ...t, partIndex: i, partMarks: marks };
  }
  log(type: string, detail: string, itemId?: string) {
    const at = new Date().toISOString();
    this.state.events.push({ at, type, detail, itemId });
    if (this.state.events.length > 2000) this.state.events.splice(0, this.state.events.length - 2000);
    this.eventTimes.push(Date.now());
    if (this.eventTimes.length > 500) this.eventTimes.splice(0, 100);
    try { fs.mkdirSync(this.dataDir, { recursive: true }); fs.appendFileSync(this.eventsFile, JSON.stringify({ at, type, detail, itemId }) + "\n"); } catch { /* ignore */ }
  }
  eventRate() { const now = Date.now(); return this.eventTimes.filter((t) => now - t < 10000).length / 10; }

  /* ---------- derived helpers ---------- */
  get preset(): Preset { return PRESET_BY_PHASE[this.state.phase]; }
  get mode() { return this.preset.mode; }
  item(id: string): ContextItem { const it = this.state.items[id]; if (!it) throw new CommandError(`unknown item ${id}`); return it; }
  audienceTotals(): Record<string, number> {
    const t: Record<string, number> = {};
    for (const p of this.participants.values()) for (const [id, v] of Object.entries(p.credits)) t[id] = (t[id] ?? 0) + v;
    return t;
  }
  retrievalVotes(): Record<string, number> {
    const t: Record<string, number> = {};
    for (const p of this.participants.values()) { const v = p.votes["retrieval"]; if (v) t[v] = (t[v] ?? 0) + 1; }
    return t;
  }
  sourceTallies(): Record<string, number> {
    const t: Record<string, number> = {};
    for (const p of this.participants.values()) for (const [s, on] of Object.entries(p.sources)) if (on) t[s] = (t[s] ?? 0) + 1;
    return t;
  }
  soloOutcomes() {
    const o = { aws: 0, azure: 0, gcp: 0, other: 0, total: 0 };
    for (const p of this.participants.values()) { const r = p.solo.lastRun; if (r) { o[r.outcome]++; o.total++; } }
    return o;
  }
  currentAssembly() {
    const totals = this.state.policy.useAudienceVotes ? this.audienceTotals() : undefined;
    return assemble({
      items: Object.values(this.state.items), policy: this.state.policy, budget: this.state.budget,
      // No credits spent (every phase after 04): leave votes out, so the Inspector shows no "audience 0 credits" row.
      audienceTotals: totals && Object.values(totals).some((v) => v > 0) ? totals : undefined,
      questionKey: this.state.questionKey,
    });
  }
  rolesAssigned() { let n = 0; for (const p of this.participants.values()) if (p.role && !p.left) n++; return n; }
  /** Participants still in the room. Leavers keep their aggregate contributions but stop counting as present. */
  present() { return [...this.participants.values()].filter((p) => !p.left); }
  leave(p: Participant) {
    if (p.left) return;
    p.left = true; p.firstName = ""; p.lastName = ""; p.role = undefined; p.parked = false;
    this.byToken.delete(p.token); p.token = "";
    this.log("participant.left", `${p.number} left the room`);
    this.touch();
  }

  /* ---------- registration ---------- */
  register(firstName: string, lastName: string, experience: Participant["experience"], simulated = false): Participant {
    if (!this.state.registrationOpen && !simulated) throw new CommandError("Registration is closed");
    firstName = firstName.trim().slice(0, 40); lastName = lastName.trim().slice(0, 40);
    if (!firstName || !lastName) throw new CommandError("First and last name are required");
    const p: Participant = {
      id: randomUUID(), token: randomUUID(), number: "P" + String(this.nextNumber++).padStart(3, "0"),
      firstName, lastName, experience, roleSent: false,
      solo: this.freshSolo(), credits: {}, votes: {}, sources: this.defaultSources(),
      decisions: 0, connected: 0, joinedAt: new Date().toISOString(), lastSeen: new Date().toISOString(),
      phaseSeen: this.state.phase, simulated,
      // Real people who arrive mid-phase wait in the lobby so they cannot skew a vote already in progress.
      parked: !simulated && this.state.phase !== "lobby" && this.state.phase !== "close",
      left: false,
    };
    this.participants.set(p.id, p);
    this.byToken.set(p.token, p.id);
    this.log("participant.joined", `${p.number} joined`);
    this.touch();
    return p;
  }
  private freshSolo(): Participant["solo"] {
    return { budget: this.state.soloBudget, items: Object.fromEntries(SOLO_CARD_IDS.map((id) => [id, "available" as const])) };
  }
  private defaultSources(): Record<string, boolean> {
    const ph = this.state.phase;
    if (ph === "blend") return Object.fromEntries(BLEND_SOURCES.map((s, i) => [s, i < 2]));
    return Object.fromEntries(BUY_SOURCES.map((s, i) => [s, i < 3]));
  }

  /* ---------- presets & phases ---------- */
  applyPreset(phase: TalkPhase) {
    const preset = PRESET_BY_PHASE[phase];
    const s = this.state;
    // Re-applying the current phase (Reset) restores cards and policy but keeps what people already chose.
    const samePhase = s.phase === phase;
    // Credits only rank cards in 04. Clear them on the way out, so the room's votes do not reorder later windows;
    // the totals stay in the event log, and so in the export.
    if (!samePhase && s.phase === "shared-auction") {
      const totals = Object.entries(this.audienceTotals()).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
      if (totals.length) this.log("credits.cleared", totals.map(([id, v]) => `${id}=${v}`).join(" "));
    }
    // Entering an optional activity remembers where to come back to; leaving one clears it.
    if (ACTIVITY_PHASES.includes(phase)) { if (!ACTIVITY_PHASES.includes(s.phase)) s.activityReturn = s.phase; }
    else s.activityReturn = undefined;
    s.phase = phase;
    s.questionKey = "deploy"; s.question = QUESTIONS.deploy;
    s.policy = { ...DEFAULT_POLICY, ...preset.policy };
    s.budget = preset.budget;
    if (preset.soloBudget) s.soloBudget = preset.soloBudget;
    s.votingOpen = preset.votingOpen ?? false;
    s.submissionOpen = preset.submissionOpen ?? false;
    s.showResponse = false;
    s.spotlight = undefined;
    s.replay = preset.replay ?? false;
    s.replayClock = undefined;
    s.frozen = false;
    this.applyExpectedItems(preset);
    if (preset.poll) { s.polls[preset.poll.id] = { ...preset.poll, counts: {} }; s.activePollId = preset.poll.id; if (!samePhase) s.pollOpenedAt = Date.now(); }
    else s.activePollId = undefined;
    s.retrievalCandidates = preset.retrievalCandidates ?? [];
    for (const p of this.participants.values()) {
      p.parked = false;
      if (samePhase) continue;
      if (phase === "solo-select") p.solo = this.freshSolo();
      if (phase === "solo-compress") p.solo.budget = s.soloBudget;
      if (phase === "shared-collect") p.roleSent = false;
      p.credits = {};
      if (phase === "buy" || phase === "blend") p.sources = this.defaultSources();
      if (preset.poll) delete p.votes[preset.poll.id];
      if (phase === "retrieval") delete p.votes["retrieval"];
    }
    // Entering 03 starts the Send countdown; Reset of 03 leaves it alone.
    if (!samePhase && phase === "retrieval") s.retrievalFirstPickAt = undefined;
    if (!samePhase && phase === "shared-collect") s.roleSendOpensAt = Date.now() + ROLE_SEND_DELAY_MS;
    if (samePhase && preset.poll) this.recountPoll(preset.poll.id);
    if (preset.assignRoles && this.rolesAssigned() === 0) this.assignRoles();
    // A preset clicked by hand (or Reset, Advance, Back) puts the run sheet at that preset, so the right arrow does the step after it.
    if (!this.onSheet) { const i = runSheetIndexOfPreset(phase); if (i >= 0) s.runStep = i; }
    this.log(samePhase ? "phase.reset" : "phase.changed", `${preset.code} ${preset.name}`);
    // The replay's counters start from these snapshots, so they end on the Close screen's numbers.
    this.log("stats", statsDetail(s.stats));
    if (s.replay) this.startReplay();
    this.touch();
  }
  /** Replay covers the log up to now and plays from the start. */
  private startReplay() {
    const until = new Date().toISOString();
    const events = this.state.events.filter((e) => e.type !== "display");
    const t = replayTimeline(events);
    this.state.replayClock = { until, count: events.length, offsetMs: 0, startedAt: Date.now(), durationMs: t.durationMs, chapters: t.chapters };
  }
  private get replayClock() {
    if (!this.state.replay || !this.state.replayClock) throw new CommandError("Replay is off");
    return this.state.replayClock;
  }
  private applyExpectedItems(preset: Preset) {
    const changed = applyPresetItems(this.state.items, preset);
    // One event per preset load so the replay can follow the whole card lifecycle: "ATLAS-002=compressed ATLAS-009=quarantined …"
    if (changed.length) this.log("context.states", changed.join(" "));
  }
  loadExpected() {
    const preset = this.preset;
    this.applyExpectedItems(preset);
    if (preset.poll) this.state.polls[preset.poll.id] = { ...preset.poll, counts: {} };
    for (const p of this.participants.values()) if (preset.poll) delete p.votes[preset.poll.id];
    this.state.retrievalCandidates = preset.retrievalCandidates ?? [];
    this.state.showResponse = false;
    this.log("state.loaded", `expected state for ${preset.code} ${preset.name}`);
    this.touch();
  }
  assignRoles() {
    const humans = this.present().sort(() => Math.random() - 0.5);
    const count = Math.max(Math.min(humans.length, ROLE_DEAL_ORDER.length), Math.round(humans.length * 0.2));
    for (const p of humans) { p.role = undefined; p.roleSent = false; }
    for (let i = 0; i < Math.min(count, humans.length); i++) {
      humans[i].role = ROLE_DEAL_ORDER[i % ROLE_DEAL_ORDER.length];
    }
    this.log("roles.assigned", `${Math.min(count, humans.length)} roles dealt`);
    this.touch();
  }

  /* ---------- item lifecycle ---------- */
  setItem(id: string, state: ItemState, who = "speaker") {
    const it = this.item(id);
    if (it.state === state) return;
    const prev = it.state;
    it.state = state;
    if (state === "evicted") this.state.stats.evictions++;
    if (state === "compressed") this.state.stats.summaries++;
    // A retrieval is a card brought in by search or the room's pick, or an evicted card a participant restores.
    // A role sending its own card is a submission, counted where it is sent.
    const retrieved = who === "retrieval" || who === "audience" || (prev === "evicted" && who !== "speaker");
    if ((state === "active" || state === "compressed") && (prev === "evicted" || prev === "available") && retrieved) this.state.stats.retrievals++;
    this.log(`context.${state}`, `${id} ${prev} → ${state} (${who})`, id);
  }

  /* ---------- participant commands ---------- */
  handleParticipant(p: Participant, cmd: ParticipantCommand): unknown {
    if (cmd.type === "leave") { this.leave(p); return { left: true }; }
    if (p.left) throw new CommandError("You have left the room. Register again to rejoin.");
    if (this.state.frozen && cmd.type !== "register") throw new CommandError("The room is frozen for a moment");
    if (p.parked) throw new CommandError("You join at the next step");
    const s = this.state;
    p.lastSeen = new Date().toISOString(); p.phaseSeen = s.phase;
    // Presets 01 and 02: the first run in the phase is final, so picks and Run lock until the next phase.
    if (cmd.type.startsWith("solo.") && p.solo.ranIn === s.phase) throw new CommandError("Your picks are locked in");
    switch (cmd.type) {
      case "register": throw new CommandError("already registered");
      case "solo.toggle": {
        if (this.mode !== "solo") throw new CommandError("Not in solo mode");
        const cur = p.solo.items[cmd.itemId]; if (cur === undefined) throw new CommandError("not a solo card");
        p.solo.items[cmd.itemId] = cur === "available" ? "active" : "available";
        p.decisions++; s.stats.decisions++;
        if (cur !== "available") s.stats.evictions++;
        break;
      }
      case "solo.set": {
        if (this.mode !== "solo") throw new CommandError("Not in solo mode");
        if (p.solo.items[cmd.itemId] === undefined) throw new CommandError("not a solo card");
        const prev = p.solo.items[cmd.itemId];
        p.solo.items[cmd.itemId] = cmd.state;
        if (prev !== cmd.state) { p.decisions++; s.stats.decisions++; if (cmd.state === "compressed") s.stats.summaries++; if (cmd.state === "available") s.stats.evictions++; }
        break;
      }
      case "solo.run": {
        if (this.mode !== "solo") throw new CommandError("Not in solo mode");
        const active = new Set<string>(); let used = 0;
        for (const [id, st] of Object.entries(p.solo.items)) {
          if (st === "available") continue;
          active.add(id); used += unitsFor(s.items[id], st === "compressed");
        }
        if (used > p.solo.budget) throw new CommandError(`Over budget: ${used} / ${p.solo.budget}`);
        const r = renderDeterministic(active, s.items);
        const assembly = assemble({ items: Object.values(s.items).filter((i) => active.has(i.id)).map((i) => ({ ...i, state: p.solo.items[i.id] as ItemState })), policy: DEFAULT_POLICY, budget: p.solo.budget });
        p.solo.lastRun = {
          id: s.runs.length + 1, at: new Date().toISOString(), question: s.question, text: r.text, cites: r.cites, outcome: r.outcome,
          renderer: "deterministic", fallbackUsed: false, latencyMs: 0, assembly, policy: DEFAULT_POLICY, eval: evaluate(r, active), scope: "solo",
        };
        p.solo.ranIn = s.phase;
        p.decisions++; s.stats.decisions++;
        this.log("assistant.solo", `${p.number}: ${r.outcome}`);
        break;
      }
      case "role.send": {
        const role = p.role ? ROLE_BY_ID[p.role] : undefined;
        if (!role?.cardId) throw new CommandError("Your role has nothing to send");
        if (role.waitForSpeaker) throw new CommandError("The speaker brings your card in");
        if (p.roleSent) throw new CommandError("Already sent");
        const wait = s.phase === "shared-collect" ? (s.roleSendOpensAt ?? 0) - Date.now() : 0;
        if (wait > 0) throw new CommandError(`Send opens in ${Math.ceil(wait / 1000)} s`);
        const it = this.item(role.cardId);
        it.submittedBy = p.number;
        this.setItem(it.id, "active", p.number);
        p.roleSent = true; p.decisions++; s.stats.submissions++; s.stats.decisions++;
        break;
      }
      case "role.restore": {
        if (p.role !== "long-term-memory") throw new CommandError("Not your ability");
        const it = this.item(cmd.itemId);
        if (it.state !== "evicted") throw new CommandError("Only evicted items can be restored");
        this.setItem(it.id, "active", p.number); p.decisions++; s.stats.decisions++;
        break;
      }
      case "role.summarize": {
        if (p.role !== "summarizer") throw new CommandError("Not your ability");
        const it = this.item(cmd.itemId);
        if (it.state !== "active") throw new CommandError("Only active items can be summarized");
        it.corrupted = cmd.variant === "drift" && !!it.driftSummary;
        this.setItem(it.id, "compressed", p.number); p.decisions++; s.stats.decisions++;
        if (it.corrupted) this.log("context.drifted", `${it.id} summarized with drifted meaning (${p.number})`, it.id);
        break;
      }
      case "credits.set": {
        if (!s.votingOpen) throw new CommandError("Voting is closed");
        this.item(cmd.itemId);
        const v = Math.max(0, Math.min(100, Math.round(cmd.value)));
        const others = Object.entries(p.credits).filter(([id]) => id !== cmd.itemId).reduce((a, [, x]) => a + x, 0);
        p.credits[cmd.itemId] = Math.min(v, 100 - others);
        p.decisions++; s.stats.decisions++;
        break;
      }
      case "poll.vote": {
        const poll = s.polls[cmd.pollId];
        if (!poll || !poll.open || s.activePollId !== poll.id) throw new CommandError("Poll is closed");
        if (!poll.options.some((o) => o.id === cmd.optionId)) throw new CommandError("bad option");
        // One answer per person: the first tap is final, so the tally on the big screen only grows.
        if (p.votes[poll.id]) throw new CommandError("Your answer is locked in");
        p.votes[poll.id] = cmd.optionId;
        this.recountPoll(poll.id);
        p.decisions++; s.stats.decisions++;
        break;
      }
      case "retrieval.vote": {
        if (!s.retrievalCandidates.includes(cmd.itemId)) throw new CommandError("not a candidate");
        if (!s.votingOpen) throw new CommandError("Voting is closed");
        // A pick is final, like a poll answer: the first tap locks it in until 09 is entered again.
        if (p.votes["retrieval"]) throw new CommandError("Your pick is locked in");
        p.votes["retrieval"] = cmd.itemId;
        s.retrievalFirstPickAt ??= Date.now(); p.decisions++; s.stats.decisions++;
        break;
      }
      case "sources.set": {
        const allowed = s.phase === "blend" ? BLEND_SOURCES : BUY_SOURCES;
        if (!allowed.includes(cmd.source)) throw new CommandError("unknown source");
        p.sources[cmd.source] = cmd.enabled; p.decisions++; s.stats.decisions++;
        break;
      }
      case "text.submit": {
        if (!s.submissionOpen) throw new CommandError("Submissions are closed");
        const text = cmd.text.trim().slice(0, 140);
        if (!text) throw new CommandError("empty");
        s.staging = s.staging.filter((t) => t.participant !== p.number);
        s.staging.push({ id: randomUUID(), participant: p.number, text, at: new Date().toISOString() });
        if (s.staging.length > 200) s.staging.shift();
        s.stats.submissions++;
        break;
      }
    }
    this.touch();
    return undefined;
  }
  recountPoll(pollId: string) {
    const poll = this.state.polls[pollId]; if (!poll) return;
    poll.counts = {};
    for (const p of this.participants.values()) { const v = p.votes[pollId]; if (v) poll.counts[v] = (poll.counts[v] ?? 0) + 1; }
  }

  /* ---------- speaker commands ---------- */
  async handleSpeaker(cmd: SpeakerCommand): Promise<unknown> {
    const s = this.state;
    switch (cmd.type) {
      case "preset": this.applyPreset(cmd.phase); return;
      case "advance": {
        if (ACTIVITY_PHASES.includes(s.phase)) { this.applyPreset(s.activityReturn ?? "final"); return; }
        const i = MAIN_PHASES.indexOf(s.phase); this.applyPreset(MAIN_PHASES[Math.min(MAIN_PHASES.length - 1, i + 1)]); return;
      }
      // Back mirrors Advance: the previous main phase, or the phase you left if you are in an optional activity.
      case "back": {
        if (ACTIVITY_PHASES.includes(s.phase)) { this.applyPreset(s.activityReturn ?? "lobby"); return; }
        const i = MAIN_PHASES.indexOf(s.phase); this.applyPreset(MAIN_PHASES[Math.max(0, i - 1)]); return;
      }
      case "question.set": s.questionKey = cmd.key; s.question = QUESTIONS[cmd.key]; s.showResponse = false; this.log("question", s.question); break;
      case "reset": this.applyPreset(s.phase); return;
      case "loadExpected": this.loadExpected(); return;
      case "policy.set": {
        const before = { ...s.policy };
        s.policy = { ...s.policy, ...cmd.patch };
        const changed = Object.keys(cmd.patch).filter((k) => (before as unknown as Record<string, unknown>)[k] !== (s.policy as unknown as Record<string, unknown>)[k]);
        if (changed.length) this.log("policy.changed", changed.map((k) => `${k}=${String((s.policy as unknown as Record<string, unknown>)[k])}`).join(", "));
        break;
      }
      case "budget.set": s.budget = Math.max(20, Math.min(2000, cmd.budget)); this.log("policy.changed", `budget=${s.budget}`); break;
      case "soloBudget.set": s.soloBudget = Math.max(10, Math.min(400, cmd.budget)); for (const p of this.participants.values()) p.solo.budget = s.soloBudget; this.log("policy.changed", `soloBudget=${s.soloBudget}`); break;
      case "item.set": this.setItem(cmd.itemId, cmd.state); break;
      case "item.corrupt": { const it = this.item(cmd.itemId); if (!it.driftSummary) throw new CommandError("no drifted summary for this card"); it.corrupted = cmd.corrupted; if (it.state === "active") it.state = "compressed"; this.log(cmd.corrupted ? "context.drifted" : "context.restored", `${it.id} summary ${cmd.corrupted ? "drifted" : "faithful again"}`, it.id); break; }
      case "item.pin": this.item(cmd.itemId).pinned = cmd.pinned; this.log("context.pinned", `${cmd.itemId} pinned=${cmd.pinned}`, cmd.itemId); break;
      case "item.inject": {
        // Spotlight the arrival and every card it knocked out of the window, so the room sees what the speaker is talking about.
        const before = new Set(this.currentAssembly().included);
        this.setItem(cmd.itemId, "active");
        const after = new Set(this.currentAssembly().included);
        s.spotlight = [cmd.itemId, ...[...before].filter((id) => !after.has(id))];
        break;
      }
      case "roles.assign": this.assignRoles(); return;
      case "parked.release": { let n = 0; for (const p of this.present()) if (p.parked) { p.parked = false; n++; } this.log("participants", `${n} released from the lobby`); break; }
      case "voting.set": s.votingOpen = cmd.open; this.log("voting", cmd.open ? "opened" : "frozen"); break;
      case "submission.set": s.submissionOpen = cmd.open; break;
      case "registration.set": s.registrationOpen = cmd.open; break;
      case "freeze.set": s.frozen = cmd.frozen; this.log("audience", cmd.frozen ? "frozen" : "unfrozen"); break;
      case "xray.set": s.xray = cmd.on; break;
      case "showResponse.set": s.showResponse = cmd.on; break;
      case "replay.set": s.replay = cmd.on; s.replayClock = undefined; if (cmd.on) this.startReplay(); this.log("display", cmd.on ? "replay started" : "replay stopped"); break;
      // Play at the end starts over, whether it ran out or was paused there; pause banks the position; seek keeps playing or paused.
      case "replay.play": { const c = this.replayClock; const at = replayPosition(c, Date.now()); if (c.startedAt === undefined || at >= c.durationMs) s.replayClock = { ...c, offsetMs: at >= c.durationMs ? 0 : at, startedAt: Date.now() }; break; }
      case "replay.pause": { const c = this.replayClock; if (c.startedAt !== undefined) s.replayClock = { ...c, offsetMs: replayPosition(c, Date.now()), startedAt: undefined }; break; }
      case "replay.seek": { const c = this.replayClock; s.replayClock = { ...c, offsetMs: Math.max(0, Math.min(c.durationMs, Math.round(cmd.ms))), startedAt: c.startedAt === undefined ? undefined : Date.now() }; break; }
      case "slide.set": this.setSlide(cmd.index); break;
      case "slide.step": this.setSlide((s.slide ?? -1) + cmd.delta); break;
      case "slide.show": {
        const i = (this.slides?.() ?? []).findIndex((n) => parseInt(n, 10) === cmd.number);
        if (i < 0) { this.log("display", `no slide ${cmd.number} in slides/, skipped`); break; }
        this.setSlide(i); break;
      }
      case "run.next": await this.gotoSheet((s.runStep ?? -1) + 1); return;
      case "run.back": await this.gotoSheet((s.runStep ?? 0) - 1); return;
      case "run.goto": await this.gotoSheet(cmd.index); return;
      case "renderer.set": s.renderer = cmd.renderer; this.log("renderer", cmd.renderer); break;
      case "assistant.run": await this.runAssistant(cmd.force); return;
      case "retrieve.topk": {
        const picked = s.retrievalCandidates.map((id) => s.items[id]).filter((i) => relevanceFor(i, s.questionKey) >= s.policy.minRelevance)
          .sort((a, b) => relevanceFor(b, s.questionKey) - relevanceFor(a, s.questionKey)).slice(0, s.policy.topK);
        for (const it of picked) { if (it.state !== "active" && it.state !== "compressed") this.setItem(it.id, "active", "retrieval"); }
        this.log("retrieval", `top-${s.policy.topK}: ${picked.map((i) => i.id).join(", ") || "nothing above threshold"}`);
        break;
      }
      case "retrieve.voted": {
        const votes = this.retrievalVotes();
        const picked = [...s.retrievalCandidates].sort((a, b) => (votes[b] ?? 0) - (votes[a] ?? 0)).filter((id) => (votes[id] ?? 0) > 0).slice(0, 2);
        for (const id of picked) { const it = s.items[id]; if (it.state !== "active" && it.state !== "compressed") this.setItem(id, "active", "audience"); }
        // The picks are used now, so freeze the vote: later taps would move a tally that no longer decides anything.
        s.votingOpen = false;
        this.log("retrieval", `audience picked: ${picked.join(", ") || "nothing"}; voting frozen`);
        break;
      }
      case "retrieve.blend": this.retrieveForQuestion(); return;
      case "poll.open": { const poll = s.polls[cmd.pollId] ?? PRESETS.find((p) => p.poll?.id === cmd.pollId)?.poll; if (!poll) throw new CommandError("no such poll"); s.polls[poll.id] = { ...poll, open: true, counts: {} }; s.activePollId = poll.id; s.pollOpenedAt = Date.now(); for (const p of this.participants.values()) delete p.votes[poll.id]; break; }
      case "poll.close": { if (s.activePollId) s.polls[s.activePollId].open = false; break; }
      case "staging.promote": {
        const t = s.staging.find((x) => x.id === cmd.id); if (!t) throw new CommandError("gone");
        const id = "TEXT-" + t.id.slice(0, 4).toUpperCase();
        s.items[id] = {
          id, title: `From ${t.participant}`, fullContent: t.text, summaryContent: t.text.slice(0, 60), sourceType: "user", sourceName: "Audience submission",
          submittedBy: t.participant, scope: { project: "atlas", session: "main" }, ageDays: 0, ageLabel: "now", authority: 1, trust: "user-provided", sensitivity: "internal",
          contextUnits: Math.max(6, Math.round(t.text.length / 5)), summaryUnits: Math.max(4, Math.round(t.text.length / 10)), state: "active", pinned: false, tags: ["audience"], relevance: 0.5, corrupted: false,
        };
        s.staging = s.staging.filter((x) => x.id !== cmd.id);
        this.log("context.promoted", `${id} from ${t.participant}`, id);
        break;
      }
      case "staging.discard": s.staging = s.staging.filter((x) => x.id !== cmd.id); break;
      case "simulate": { this.simulate?.(cmd.count); return; }
      case "simulate.clear": {
        for (const [id, p] of this.participants) if (p.simulated) { this.participants.delete(id); this.byToken.delete(p.token); }
        for (const id of Object.keys(s.polls)) this.recountPoll(id);
        this.log("simulation", "simulated participants removed");
        break;
      }
      case "timer.start": if (s.timer.startedAt === undefined) s.timer.startedAt = Date.now(); break;
      case "timer.pause": { const { startedAt, ...t } = s.timer; if (startedAt !== undefined) s.timer = { ...t, elapsedMs: t.elapsedMs + Date.now() - startedAt }; break; }
      // Reset forgets every part's mark; touch() marks the current part again at 0:00.
      case "timer.reset": s.timer = { elapsedMs: 0 }; break;
      case "session.end": this.endSession(); return;
      case "session.reset": {
        const n = this.participants.size;
        this.state = freshState(); this.participants.clear(); this.byToken.clear(); this.nextNumber = 1;
        this.log("session.reset", `fresh room; ${n} participants removed`);
        break;
      }
    }
    this.touch();
    return undefined;
  }
  /**
   * Spec §27: attendee identity data is deleted after the session while anonymous aggregates are kept.
   * Writes data/export-<time>.json first so nothing of value is lost, then strips names and closes registration.
   */
  endSession() {
    const s = this.state;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = `export-${stamp}.json`;
    const people = [...this.participants.values()];
    const exp = {
      exportedAt: new Date().toISOString(), session: s.id, startedAt: s.startedAt, phase: s.phase,
      stats: { ...s.stats, participants: people.length, simulated: people.filter((p) => p.simulated).length },
      experience: people.reduce<Record<string, number>>((a, p) => { a[p.experience] = (a[p.experience] ?? 0) + 1; return a; }, {}),
      soloOutcomes: this.soloOutcomes(),
      creditTotals: this.audienceTotals(),
      polls: s.polls,
      sourceTallies: this.sourceTallies(),
      runs: s.runs,
      finalPolicy: s.policy,
      items: Object.values(s.items).map((i) => ({ id: i.id, state: i.state, pinned: i.pinned, submittedBy: i.submittedBy })),
      participants: people.map((p) => ({
        number: p.number, experience: p.experience, simulated: p.simulated, joinedAt: p.joinedAt, decisions: p.decisions,
        role: p.role, roleSent: p.roleSent, soloOutcome: p.solo.lastRun?.outcome, credits: p.credits, votes: p.votes, sources: p.sources,
      })),
      events: s.events,
    };
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(path.join(this.dataDir, file), JSON.stringify(exp, null, 2));
    for (const p of people) { p.firstName = ""; p.lastName = ""; }
    s.registrationOpen = false;
    s.submissionOpen = false;
    s.votingOpen = false;
    s.staging = [];
    s.endedAt = new Date().toISOString();
    s.exportFile = file;
    if (s.phase !== "close") this.applyPreset("close");
    this.log("session.ended", `export ${file}; names deleted for ${people.length} participants`);
    this.touch();
  }

  /** Set by simulate.ts so the store stays free of timers. */
  simulate?: (count: number) => void;
  /** Set by app.ts: the slide deck on disk, so the store can clamp the slide index without touching the filesystem. */
  slides?: () => string[];

  /** Put slide `index` on the display (clamped to the deck), or null to return to the live view. */
  setSlide(index: number | null) {
    const s = this.state;
    const count = this.slides?.().length ?? 0;
    if (index === null || count === 0) {
      if (s.slide !== undefined) this.log("display", "slides off, live view");
      delete s.slide;
      return;
    }
    const next = Math.max(0, Math.min(count - 1, Math.floor(index)));
    if (next === s.slide) return;
    s.slide = s.lastSlide = next;
    // A slide put up by hand moves the run sheet to that slide's step.
    if (!this.onSheet) { const i = runSheetIndexOfSlide(parseInt(this.slides!()[next], 10)); if (i >= 0) s.runStep = i; }
    this.log("display", `slide ${next + 1}/${count}`);
  }

  /* ---------- run sheet ---------- */
  /** Set while the sheet itself is sending commands, so the presets and slides it sends do not move the cursor under it. */
  private onSheet = false;
  /**
   * Land on run-sheet step `target` (shared/src/runsheet.ts). The next step forward runs just that step. Anything else,
   * going back included, replays from the last preset at or before the target, like Reset phase followed by the steps
   * since, so the room ends up in the state the script expects after that step. Every preset step starts by taking the
   * slide down, so a replay also leaves the display the way the script has it there. The cursor moves to the target
   * before the commands run, so a step that waits on the model (Invoke) shows as current on the console and the notes
   * view at once rather than when the answer arrives; if a command fails, the cursor goes back to where it was.
   */
  async gotoSheet(target: number) {
    const s = this.state;
    if (target < 0) throw new CommandError("Start of the run sheet");
    if (target >= RUN_SHEET.length) throw new CommandError("End of the run sheet. End session is in the bottom bar.");
    if (this.onSheet) throw new CommandError("A run-sheet step is still running");
    const from = target === (s.runStep ?? -1) + 1 ? target : runSheetCheckpoint(target);
    const was = s.runStep;
    s.runStep = target;
    this.touch();
    this.onSheet = true;
    try {
      for (let i = from; i <= target; i++) {
        const step = RUN_SHEET[i];
        this.log("runsheet", `${i + 1}. ${step.label}`);
        for (const c of step.cmds) {
          if (isSpeakerCmd(c)) { await this.handleSpeaker(c); continue; }
          const item = this.state.items[c.ifOut];
          if (!item || item.state === "active" || item.state === "compressed") continue;
          this.log("runsheet", c.label);
          for (const cc of c.cmds) await this.handleSpeaker(cc);
        }
      }
    } catch (e) {
      s.runStep = was;
      throw e;
    } finally { this.onSheet = false; this.touch(); }
  }

  async runAssistant(force?: "good" | "bad") {
    const s = this.state;
    const started = Date.now();
    const assembly = this.currentAssembly();
    const active = new Set(assembly.included);
    let rendered: _R = force === "good" ? GOOD_ANSWER : force === "bad" ? BAD_ANSWER : renderDeterministic(active, s.items, new Set(assembly.compressed), s.questionKey);
    let fallbackUsed = false;
    let renderer = s.renderer;
    if (!force && s.renderer !== "deterministic") {
      if (!llmConfigured()) { fallbackUsed = true; }
      else {
        try {
          const { system, user } = buildPrompt(assembly, s.items, s.question, s.policy);
          const text = normalizeCites(await renderLive(system, user));
          rendered = { text, cites: citesOf(text), outcome: outcomeOf(text) };
          s.llmStatus = "ok";
        } catch (e) {
          fallbackUsed = true; s.llmStatus = "error";
          console.warn("live model failed, using deterministic answer:", (e as Error).message);
        }
      }
    }
    if (fallbackUsed) renderer = "deterministic";
    const evicted = assembly.traces.filter((t) => t.result === "EXCLUDED" && t.reason.startsWith("evicted")).length;
    s.stats.evictions += evicted;
    s.stats.summaries += assembly.compressed.filter((id) => s.items[id].state !== "compressed").length;
    const run: AssistantRun = {
      id: s.runs.length + 1, at: new Date().toISOString(), question: s.question, text: rendered.text, cites: rendered.cites, outcome: rendered.outcome,
      renderer, fallbackUsed, latencyMs: Date.now() - started, assembly, policy: { ...s.policy }, eval: evaluate(rendered, active, s.questionKey), forced: force, scope: "shared",
    };
    s.runs.push(run);
    if (s.runs.length > 50) s.runs.shift();
    s.showResponse = true;
    this.log("assistant.completed", `run #${run.id} ${run.outcome}${force ? " (forced " + force + ")" : ""}${fallbackUsed ? " fallback" : ""} · ${assembly.usedUnits}/${assembly.budget}u`);
    this.log("stats", statsDetail(s.stats));
    this.touch();
  }

  /** Blend: pull records only from sources the room enabled (majority), respecting the current question. */
  retrieveForQuestion() {
    const tallies = this.sourceTallies();
    // Same majority as the display's tool counter: the people still in the room.
    const n = Math.max(1, this.present().length);
    const enabled = BLEND_SOURCES.filter((src) => (tallies[src] ?? 0) * 2 >= n);
    const picked: string[] = [];
    for (const src of enabled) for (const id of BLEND_SOURCE_CARDS[src] ?? []) {
      const it = this.state.items[id];
      if (it.relevance >= this.state.policy.minRelevance && picked.length < this.state.policy.topK) picked.push(id);
    }
    for (const id of picked) this.setItem(id, "active", "retrieval");
    this.log("retrieval", `blend: sources=${enabled.join("|") || "none"} → ${picked.join(", ") || "nothing"}`);
    this.touch();
  }
}

export type { Policy };
