import type { EventLogEntry, ItemState, Stats } from "./types.js";
import { PRESET_BY_PHASE } from "./presets.js";

/** The replay plays the log back in about this long, whatever the room size. */
export const REPLAY_TARGET_MS = 45_000;
/** A story frame never shows for less or more than this, so a short log does not crawl and a long one stays readable. */
const UNIT_MIN_MS = 300;
const UNIT_MAX_MS = 1200;

/** Logged once per participant: a run of them in a row plays as one frame with a summary line. */
const CROWD = new Set(["participant.joined", "participant.left", "assistant.solo"]);
/** Bookkeeping: applied with the frame around it, takes no time and has no log line. Every other type is a story event. */
const QUIET = new Set(["display", "runsheet", "renderer", "state.loaded", "simulation", "voting", "audience", "participants", "session.reset", "stats"]);

export interface ReplayFrame {
  /** Events [start, end) of the replay list belong to this frame. */
  start: number;
  end: number;
  /** Offset into the replay, and how long the frame shows. */
  atMs: number;
  ms: number;
  /** Set on crowd frames: the event type the run is made of. Crowd frames reveal their events across the frame, story frames all at once. */
  crowd?: string;
}

export interface ReplayChapter { code: string; name: string; atMs: number }

export interface ReplayTimeline { frames: ReplayFrame[]; durationMs: number; chapters: ReplayChapter[] }

/**
 * The events a replay covers: the first `count` non-display events logged up to `until`. The count keeps out an event
 * logged in the same millisecond the replay started. The display and the server cut the log the same way, so both
 * build the same timeline.
 */
export function replayEvents(events: EventLogEntry[], cut: { until: string; count: number }): EventLogEntry[] {
  return events.filter((e) => e.type !== "display" && e.at <= cut.until).slice(0, cut.count);
}

/** Crowd frames weigh more as they grow, up to two story frames, so 100 joins take about 1.4 s instead of 15 s. */
const weight = (f: ReplayFrame) => f.crowd ? Math.min(2, 0.5 + 0.05 * (f.end - f.start)) : 1;

export function replayTimeline(events: EventLogEntry[]): ReplayTimeline {
  const frames: ReplayFrame[] = [];
  let cur: ReplayFrame | undefined;
  events.forEach((e, i) => {
    // Quiet events before the first frame join it, since it starts at 0.
    if (QUIET.has(e.type)) { if (cur) cur.end = i + 1; return; }
    if (CROWD.has(e.type) && cur?.crowd === e.type) { cur.end = i + 1; return; }
    cur = { start: cur ? cur.end : 0, end: i + 1, atMs: 0, ms: 0, crowd: CROWD.has(e.type) ? e.type : undefined };
    frames.push(cur);
  });
  const total = frames.reduce((a, f) => a + weight(f), 0);
  const unit = Math.min(UNIT_MAX_MS, Math.max(UNIT_MIN_MS, total ? REPLAY_TARGET_MS / total : 0));
  let at = 0;
  const chapters: ReplayChapter[] = [];
  for (const f of frames) {
    f.atMs = at; f.ms = Math.round(weight(f) * unit); at += f.ms;
    const e = events[f.end - 1];
    // A frame's own event is its last non-quiet one; quiet events after it only extend the frame.
    const own = events.slice(f.start, f.end).filter((x) => !QUIET.has(x.type)).pop() ?? e;
    if (own.type === "phase.changed") { const [code, ...name] = own.detail.split(" "); chapters.push({ code, name: name.join(" "), atMs: f.atMs }); }
  }
  return { frames, durationMs: at, chapters };
}

/** How many events of the replay list are shown at `pos` ms: story frames show at once, crowd frames fill in across their time. */
export function replayRevealed(t: ReplayTimeline, pos: number, eventCount: number): number {
  if (pos >= t.durationMs) return eventCount;
  let lo = 0, hi = t.frames.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (t.frames[mid].atMs <= pos) lo = mid; else hi = mid - 1; }
  const f = t.frames[lo];
  if (!f) return 0;
  if (!f.crowd) return f.end;
  return f.start + Math.max(1, Math.ceil(((pos - f.atMs) / f.ms) * (f.end - f.start)));
}

/** The log line for a frame: a story frame's own event, or a summary of the crowd events shown so far. */
export function replayLine(events: EventLogEntry[], f: ReplayFrame, revealed: number): EventLogEntry {
  const shown = events.slice(f.start, Math.min(f.end, revealed)).filter((e) => !QUIET.has(e.type));
  const last = shown[shown.length - 1] ?? events[f.start];
  if (!f.crowd) return last;
  const runs = shown.filter((e) => e.type === f.crowd);
  const n = runs.length;
  let detail: string;
  if (f.crowd === "assistant.solo") {
    const by: Record<string, number> = {};
    for (const e of runs) { const o = e.detail.split(": ").pop() ?? "other"; by[o] = (by[o] ?? 0) + 1; }
    detail = `${n} solo run${n === 1 ? "" : "s"}: ${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([o, c]) => `${c} ${o.toUpperCase()}`).join(" · ")}`;
  } else detail = `${n} participant${n === 1 ? "" : "s"} ${f.crowd === "participant.joined" ? "joined" : "left the room"}`;
  return { at: last.at, type: f.crowd, detail };
}

/** The server's Stats as a `stats` event detail: "decisions=12 evictions=3 …". Logged at each preset load and after each assistant run. */
export const statsDetail = (s: Stats) => Object.entries(s).map(([k, v]) => `${k}=${v}`).join(" ");

const ITEM_STATES = new Set<string>(["available", "active", "compressed", "evicted", "quarantined"]);
const MOVE = /^(\S+) (\S+) → (\S+) \((.+)\)$/;

export interface ReplayTally {
  /** Card states and how many single moves each card made. */
  cards: Record<string, ItemState>;
  moves: Record<string, number>;
  /** Name of the latest phase, and every phase entered so far. */
  phase: string;
  phases: Set<string>;
  joins: number; runs: number; lastRun: string;
  evictions: number; summaries: number; retrievals: number;
}

/**
 * Replays events [0, upto) into card states and counters.
 * - The Close preset's reset of every card is skipped, so the end of the replay shows the cards as the room left them.
 * - Evictions, summaries and retrievals are the latest `stats` snapshot plus the card moves logged since, counted by the
 *   server's rule (Store.setItem). Solo choices and assistant-run packing reach the counters at the next snapshot, so the
 *   replay ends on the numbers the Close screen shows. A log without snapshots counts card moves only.
 */
export function replayTally(events: EventLogEntry[], upto: number): ReplayTally {
  const close = PRESET_BY_PHASE.close.code;
  const t: ReplayTally = { cards: {}, moves: {}, phase: "lobby", phases: new Set(), joins: 0, runs: 0, lastRun: "", evictions: 0, summaries: 0, retrievals: 0 };
  const base = { evictions: 0, summaries: 0, retrievals: 0 };
  const since = { evictions: 0, summaries: 0, retrievals: 0 };
  for (let i = 0; i < Math.min(upto, events.length); i++) {
    const e = events[i];
    if (e.type === "participant.joined") t.joins++;
    else if (e.type === "phase.changed") { t.phase = e.detail.replace(/^\S+ /, ""); t.phases.add(t.phase); }
    else if (e.type === "assistant.completed") { t.runs++; t.lastRun = e.detail; }
    else if (e.type === "stats") {
      for (const pair of e.detail.split(" ")) { const [k, v] = pair.split("="); if (k in base) base[k as keyof typeof base] = Number(v) || 0; }
      since.evictions = since.summaries = since.retrievals = 0;
    }
    else if (e.type === "context.states") {
      // A preset logs its card states just before its phase event; skip the Close preset's clear.
      let j = i + 1; while (j < events.length && QUIET.has(events[j].type)) j++;
      const next = events[j];
      if (next && (next.type === "phase.changed" || next.type === "phase.reset") && next.detail.split(" ")[0] === close) continue;
      for (const pair of e.detail.split(" ")) { const [id, st] = pair.split("="); if (ITEM_STATES.has(st)) t.cards[id] = st as ItemState; }
    }
    else if (e.type.startsWith("context.") && e.itemId) {
      const st = e.type.slice(8);
      if (!ITEM_STATES.has(st)) continue;
      t.cards[e.itemId] = st as ItemState; t.moves[e.itemId] = (t.moves[e.itemId] ?? 0) + 1;
      if (st === "evicted") since.evictions++;
      if (st === "compressed") since.summaries++;
      const m = MOVE.exec(e.detail);
      if (m) {
        const [, , prev, , who] = m;
        const retrieved = who === "retrieval" || who === "audience" || (prev === "evicted" && who !== "speaker");
        if ((st === "active" || st === "compressed") && (prev === "evicted" || prev === "available") && retrieved) since.retrievals++;
      }
    }
  }
  t.evictions = base.evictions + since.evictions;
  t.summaries = base.summaries + since.summaries;
  t.retrievals = base.retrievals + since.retrievals;
  return t;
}

/** Playhead in ms: playing while startedAt (server epoch ms) is set, counted from offsetMs and stopped at the end. */
export function replayPosition(clock: { offsetMs: number; startedAt?: number; durationMs: number }, now: number): number {
  return Math.min(clock.durationMs, clock.offsetMs + (clock.startedAt !== undefined ? Math.max(0, now - clock.startedAt) : 0));
}
