import { SOLO_CARD_IDS, BUY_SOURCES, BLEND_SOURCES, ROLE_BY_ID } from "@ctx/shared";
import type { Participant, TalkPhase } from "@ctx/shared";
import type { Store } from "./store.js";

const FIRST = ["Ada", "Femi", "Grace", "Jordan", "Kwame", "Lin", "Maya", "Nia", "Omar", "Priya", "Sam", "Tariq", "Uche", "Zoe", "Chris", "Dev"];
const LAST = ["Okafor", "Nguyen", "Garcia", "Mensah", "Patel", "Kim", "Adeyemi", "Brown", "Diallo", "Silva"];
const rnd = (n: number) => Math.floor(Math.random() * n);
const pick = <T,>(xs: T[]) => xs[rnd(xs.length)];

/** Realistic-ish crowd behaviour per phase. Most people make good choices, a visible minority do not. */
export function attachSimulator(store: Store) {
  const timers = new Set<NodeJS.Timeout>();
  const later = (ms: number, fn: () => void) => { const t = setTimeout(() => { timers.delete(t); try { fn(); } catch { /* ignore */ } }, ms); timers.add(t); };
  const sims = () => [...store.participants.values()].filter((p) => p.simulated);
  const act = (p: Participant, cmd: Parameters<Store["handleParticipant"]>[1]) => { try { store.handleParticipant(p, cmd); } catch { /* command not valid in this state */ } };

  const behave = (phase: TalkPhase) => {
    for (const p of sims()) {
      const delay = 500 + rnd(6000);
      switch (phase) {
        case "solo-select": later(delay, () => {
          const good = Math.random() < 0.6;
          const picks = good ? ["ATLAS-001", "ATLAS-002", "ATLAS-004"] : Math.random() < 0.5 ? ["ATLAS-001", "ATLAS-007", "APOLLO-001"] : ["ATLAS-004", "ATLAS-008", "ATLAS-007"];
          for (const id of SOLO_CARD_IDS) act(p, { type: "solo.set", itemId: id, state: picks.includes(id) ? "active" : "available" });
          later(800 + rnd(3000), () => act(p, { type: "solo.run" }));
        }); break;
        case "solo-compress": later(delay, () => {
          for (const [id, st] of Object.entries(p.solo.items)) {
            if (st === "available") continue;
            const r = Math.random();
            act(p, { type: "solo.set", itemId: id, state: r < 0.55 ? "compressed" : r < 0.8 ? "active" : "available" });
          }
          later(1000 + rnd(3000), () => act(p, { type: "solo.run" }));
        }); break;
        case "shared-collect": later(delay, () => {
          const role = p.role ? ROLE_BY_ID[p.role] : undefined;
          // Send waits for the countdown, like a real phone.
          const wait = Math.max(0, (store.state.roleSendOpensAt ?? 0) - Date.now());
          if (role?.cardId && !role.waitForSpeaker) later(wait + 300 + rnd(3000), () => act(p, { type: "role.send" }));
          if (Math.random() < 0.15) act(p, { type: "text.submit", text: pick(["Did anyone check IAM roles in us-west-2?", "Is the status page ready?", "what about the purple theme", "Contract says AWS, right?"]) });
        }); break;
        case "shared-auction": later(delay, () => {
          const smart = Math.random() < 0.7;
          const alloc: Record<string, number> = smart
            ? { "ATLAS-002": 35 + rnd(15), "ATLAS-004": 15 + rnd(10), "ATLAS-001": 10 + rnd(10), "ATLAS-003": 5 + rnd(10), "ATLAS-007": rnd(10) }
            : { "ATLAS-007": 20 + rnd(20), "ATLAS-006": 10 + rnd(20), "APOLLO-001": 10 + rnd(15), "ATLAS-002": rnd(20), "ATLAS-008": rnd(15) };
          for (const [id, v] of Object.entries(alloc)) act(p, { type: "credits.set", itemId: id, value: v });
        }); break;
        case "retrieval": later(delay, () => act(p, { type: "retrieval.vote", itemId: Math.random() < 0.7 ? "ATLAS-002" : pick(["ATLAS-003", "APOLLO-001", "ATLAS-006"]) })); break;
        case "buy": later(delay, () => { for (const s of BUY_SOURCES) act(p, { type: "sources.set", source: s, enabled: s === "Web" ? Math.random() < 0.25 : Math.random() < 0.9 }); }); break;
        case "blend": later(delay, () => { for (const s of BLEND_SOURCES) act(p, { type: "sources.set", source: s, enabled: ["CRM", "Architecture docs", "Monitoring", "Chat history"].includes(s) ? Math.random() < 0.85 : Math.random() < 0.3 }); }); break;
        default: break;
      }
      const poll = store.state.activePollId ? store.state.polls[store.state.activePollId] : undefined;
      if (poll) later(delay, () => {
        const opts = poll.options.map((o) => o.id);
        const preferred = opts.includes("fact-a") ? "fact-a" : opts.includes("aws-the-contract") ? "aws-the-contract" : opts.includes("structured-findings") ? "structured-findings" : opts.includes("structured") ? "structured" : opts.includes("no") ? "no" : opts.includes("data") ? "data" : opts.includes("add-it-and-evict-something") ? "add-it-and-evict-something" : opts[0];
        act(p, { type: "poll.vote", pollId: poll.id, optionId: Math.random() < 0.8 ? preferred : pick(opts) });
      });
    }
  };

  store.simulate = (count: number) => {
    const n = Math.max(1, Math.min(300, count));
    for (let i = 0; i < n; i++) {
      const p = store.register(pick(FIRST), pick(LAST), pick(["use", "build", "infra"] as const), true);
      p.connected = 1;
    }
    store.log("simulation", `${n} simulated participants joined`);
    behave(store.state.phase);
  };

  let lastPhase = store.state.phase;
  let lastPoll = store.state.activePollId;
  store.onChange(() => {
    if (store.state.phase !== lastPhase || store.state.activePollId !== lastPoll) {
      lastPhase = store.state.phase; lastPoll = store.state.activePollId;
      if (sims().length) behave(lastPhase);
    }
  });
}
