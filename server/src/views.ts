import type { ControlView, DisplayView, Participant, ParticipantView, Poll } from "@ctx/shared";
import { ROLE_BY_ID, unitsFor, POLL_REVEAL_DELAY_MS, RETRIEVAL_REVEAL_SHARE } from "@ctx/shared";
import type { Store } from "./store.js";

export function sharedSummary(store: Store) {
  const s = store.state;
  const a = store.currentAssembly();
  return {
    phase: s.phase, question: s.question, budget: s.budget, usedUnits: a.demandedUnits, overflow: a.overflow,
    // The cards the meter counts: packed, or turned away only by the budget. Filtered and quarantined cards are out.
    activeCount: a.traces.filter((t) => t.result === "INCLUDED" || t.result === "COMPRESSED" || t.reason === "evicted by budget packing").length,
    participants: store.present().length, rolesAssigned: store.rolesAssigned(),
  };
}

/** A phone sees the tallies only after its own vote is in (votes lock on first tap) or the poll closes, so it can't follow the crowd. */
function pollFor(poll: Poll | undefined, p: Participant) {
  if (!poll) return undefined;
  const answers = Object.values(poll.counts).reduce((a, b) => a + b, 0);
  const countsHidden = poll.open && !p.votes[poll.id];
  return { ...poll, counts: countsHidden ? {} : poll.counts, answers, countsHidden };
}

/** The big screen holds 09's pick counts back until 15 s after the first pick or until half the room has picked, so early picks can't steer the rest. */
function retrievalReveal(store: Store) {
  const s = store.state;
  const picks = Object.values(store.retrievalVotes()).reduce((a, b) => a + b, 0);
  const inMs = s.retrievalFirstPickAt === undefined ? -1 : Math.max(0, s.retrievalFirstPickAt + POLL_REVEAL_DELAY_MS - Date.now());
  const enough = picks >= Math.max(1, Math.ceil(store.present().length * RETRIEVAL_REVEAL_SHARE));
  const hidden = s.phase === "retrieval" && s.votingOpen && inMs !== 0 && !enough;
  return { picks, hidden, inMs: hidden ? inMs : 0 };
}

export function participantView(store: Store, p: Participant): ParticipantView {
  const s = store.state;
  const items = s.items;
  const role = p.role ? ROLE_BY_ID[p.role] : undefined;
  const last = s.showResponse ? s.runs[s.runs.length - 1] : undefined;
  const creditsUsed = Object.values(p.credits).reduce((a, b) => a + b, 0);
  const activeCards = Object.values(items).filter((i) => i.state === "active" || i.state === "compressed")
    .filter((i) => !(i.sensitivity === "private"));
  return {
    kind: "participant", version: s.version,
    me: {
      number: p.number, firstName: p.firstName, mode: store.mode, role: p.role, roleSent: p.roleSent,
      roleSendOpensInMs: s.phase === "shared-collect" ? Math.max(0, (s.roleSendOpensAt ?? 0) - Date.now()) : 0,
      solo: p.solo, credits: p.credits, creditsLeft: 100 - creditsUsed, votes: p.votes, sources: p.sources, decisions: p.decisions, parked: !!p.parked,
    },
    shared: sharedSummary(store), policy: s.policy, frozen: s.frozen, submissionOpen: s.submissionOpen, votingOpen: s.votingOpen,
    soloCards: Object.keys(p.solo.items).map((id) => items[id]),
    roleCard: role?.cardId ? items[role.cardId] : undefined,
    evictedCards: Object.values(items).filter((i) => i.state === "evicted"),
    activeCards,
    poll: pollFor(s.activePollId ? s.polls[s.activePollId] : undefined, p),
    retrievalCandidates: s.retrievalCandidates.map((id) => items[id]),
    // A phone sees the room's picks only after its own pick is in (it locks on the first tap) or voting closes.
    retrievalVotes: s.votingOpen && !p.votes["retrieval"] ? {} : store.retrievalVotes(),
    retrievalVotesHidden: s.votingOpen && !p.votes["retrieval"],
    lastSharedRun: last ? { text: last.text, cites: last.cites, outcome: last.outcome } : undefined,
    sourceTallies: store.sourceTallies(),
    stats: { ...s.stats, participants: store.present().length },
    projection: (s.votingOpen && s.policy.useAudienceVotes) || s.phase === "routing" ? projection(store) : undefined,
  };
}

function projection(store: Store): NonNullable<ParticipantView["projection"]> {
  const a = store.currentAssembly();
  const excluded = a.traces.filter((t) => t.result === "EXCLUDED" || t.result === "QUARANTINED");
  return {
    keep: a.included.length, keepUnits: a.usedUnits, budget: a.budget,
    evicted: excluded.filter((t) => t.reason.startsWith("evicted")).map((t) => ({ id: t.id, title: t.title })),
    filtered: excluded.filter((t) => !t.reason.startsWith("evicted")).map((t) => ({ id: t.id, title: t.title })),
  };
}

export function displayView(store: Store, joinUrl: string, shortUrl?: string): DisplayView {
  const slides = store.slides?.() ?? [];
  const s = store.state;
  const recent = store.present().sort((a, b) => b.joinedAt.localeCompare(a.joinedAt)).slice(0, 8)
    .map((p) => (s.showNames ? `${p.firstName} ${p.number}` : p.number));
  return {
    kind: "display", version: s.version,
    state: { ...s, events: s.events.slice(-40) },
    assembly: store.currentAssembly(),
    participants: store.present().length,
    soloOutcomes: store.soloOutcomes(),
    creditTotals: store.audienceTotals(),
    retrievalReveal: retrievalReveal(store),
    pollRevealInMs: s.activePollId && s.polls[s.activePollId]?.open ? Math.max(0, (s.pollOpenedAt ?? 0) + POLL_REVEAL_DELAY_MS - Date.now()) : 0,
    retrievalVotes: store.retrievalVotes(),
    sourceTallies: store.sourceTallies(),
    joinUrl, shortUrl, recentJoins: recent,
    slides,
    serverNow: Date.now(),
  };
}

export function controlView(store: Store, joinUrl: string, shortUrl?: string): ControlView {
  const d = displayView(store, joinUrl, shortUrl);
  const list = [...store.participants.values()].map((p) => ({
    number: p.number, firstName: p.firstName, role: p.role, roleSent: p.roleSent, connected: p.connected > 0, simulated: p.simulated, phaseSeen: p.phaseSeen, left: !!p.left,
  }));
  const s = store.state;
  return {
    ...d, kind: "control", participantList: list, rolesAssigned: store.rolesAssigned(),
    parked: store.present().filter((p) => p.parked).length,
    duplicates: store.present().filter((p) => p.connected > 1).length,
    eventRate: Math.round(store.eventRate() * 10) / 10,
    stuck: store.present().filter((p) => p.connected > 0 && p.phaseSeen !== s.phase && Date.now() - Date.parse(p.lastSeen) > 60000).length,
    llmStatus: s.llmStatus,
    fallbackActive: s.renderer !== "deterministic" && s.llmStatus !== "ok",
  };
}

export const units = unitsFor;
