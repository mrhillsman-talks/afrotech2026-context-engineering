import { useCallback, useEffect, useRef, useState } from "react";
import type { ContextItem, ParticipantView, Experience, TalkPhase } from "@ctx/shared";
import { unitsFor, ROLE_BY_ID, BUY_SOURCES, BLEND_SOURCES, BLEND_TOOL_COUNT, blendToolUnits, PRESET_BY_PHASE, PROVENANCE_FACT, PROVENANCE_SOURCES, QUESTIONS } from "@ctx/shared";
import { useSession, TOKEN_KEY } from "../ws";
import { Meter, Cites, unitsLabel } from "../components/ui";

// Same code and name the display header and the setup slides show, so the room sees one label for each step.
const PHASE_LABEL = Object.fromEntries(Object.values(PRESET_BY_PHASE).map((p) =>
  [p.phase, p.phase === "lobby" ? "Lobby" : p.phase === "close" ? "Thank you" : `${p.code} · ${p.name}`])) as Record<TalkPhase, string>;

type Send = ReturnType<typeof useSession>["send"];

/** Wraps send so every acknowledged command flashes a "Saved" chip. Choices save instantly; there is no submit step. */
function useSavedFeedback(send: Send) {
  const [saved, setSaved] = useState(false);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const sendS = useCallback<Send>(async (cmd) => {
    const r = await send(cmd);
    setSaved(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setSaved(false), 1200);
    return r;
  }, [send]);
  return { sendS, saved };
}

export function ParticipantApp() {
  const { view, status, send, error } = useSession<ParticipantView>("participant");
  const { sendS, saved } = useSavedFeedback(send);
  const hasToken = !!localStorage.getItem(TOKEN_KEY);
  if (status === "connecting" && !view) return <div className="phone"><p className="m">Connecting…</p></div>;
  if (!view || !hasToken) return <Register send={send} error={error} />;
  return <div className="phone">
    <div className="top">
      <span className="pid">{view.me.number}</span>
      <span className="eb">{PHASE_LABEL[view.shared.phase]}</span>
    </div>
    {status !== "open" && <div className="alert warn">Reconnecting…</div>}
    {view.frozen && <div className="alert warn">The room is paused for a moment.</div>}
    <Screen view={view} send={sendS} />
    <div style={{ flexGrow: 1 }} />
    <p className="m" style={{ textAlign: "center", margin: "8px 0 0" }}>
      Your choices save instantly. There is nothing to submit. The speaker moves the room to the next step.
    </p>
    <p className="m" style={{ textAlign: "center", margin: "4px 0 0", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <button type="button" style={{ background: "none", border: 0, padding: 4, color: "#4f6a67", textDecoration: "underline", fontSize: 12 }} onClick={async () => {
        if (!window.confirm("Leave the room? Your name is removed now. What you already voted stays in the room's totals, anonymously.")) return;
        try { await send({ type: "leave" }); } catch { /* already gone */ }
        localStorage.removeItem(TOKEN_KEY); location.reload();
      }}>Leave the room</button>
    </p>
    <div className="saved" role="status" aria-live="polite" style={{ opacity: saved ? 1 : 0 }}>Saved</div>
    {error && <div className="toast">{error}</div>}
  </div>;
}

function Register({ send, error }: { send: ReturnType<typeof useSession>["send"]; error: string | null }) {
  const [fn, setFn] = useState(""); const [ln, setLn] = useState(""); const [xp, setXp] = useState<Experience>("build");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { await send({ type: "register", firstName: fn, lastName: ln, experience: xp }); } finally { setBusy(false); }
  };
  const opts: [Experience, string][] = [["use", "I mostly use AI products"], ["build", "I build applications using AI APIs"], ["infra", "I build or operate AI infrastructure"]];
  return <div className="phone" style={{ background: "linear-gradient(180deg,#edf3f3,#c0e8d2)" }}>
    <div style={{ paddingTop: 20 }} className="stack">
      <div className="eb">Context engineering · live session</div>
      <h1 className="d" style={{ fontSize: 40 }}>You are about to run a context window</h1>
      <p className="m" style={{ fontSize: 15, margin: 0 }}>Join the room. No installation required. Your first name and number are all the room ever sees.</p>
    </div>
    <form onSubmit={submit} className="stack" style={{ gap: 14, flexGrow: 1 }}>
      <div className="stack" style={{ gap: 6 }}><label htmlFor="fn">First name</label><input id="fn" type="text" value={fn} onChange={(e) => setFn(e.target.value)} autoComplete="given-name" required /></div>
      <div className="stack" style={{ gap: 6 }}><label htmlFor="ln">Last name</label><input id="ln" type="text" value={ln} onChange={(e) => setLn(e.target.value)} autoComplete="family-name" required /></div>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }} className="stack">
        <legend style={{ fontSize: 13, fontWeight: 600, padding: 0, marginBottom: 6 }}>Which best describes you?</legend>
        {opts.map(([v, l]) => <label key={v} className={"opt" + (xp === v ? " on" : "")}><input type="radio" name="xp" checked={xp === v} onChange={() => setXp(v)} /> {l}</label>)}
      </fieldset>
      <div style={{ flexGrow: 1 }} />
      <button className="btn" type="submit" disabled={busy}>Join the room</button>
      <p className="m" style={{ textAlign: "center", margin: 0 }}>Names are deleted after the session. Anonymous aggregate stats are kept.</p>
    </form>
    {error && <div className="toast">{error}</div>}
  </div>;
}

function Screen({ view, send }: { view: ParticipantView; send: Send }) {
  const ph = view.shared.phase;
  if (view.me.parked) return <Parked view={view} />;
  if (ph === "lobby") return <Lobby view={view} />;
  if (ph === "solo-select" || ph === "solo-compress") return <Solo view={view} send={send} compress={ph === "solo-compress"} />;
  if (ph === "shared-collect") return <Shared view={view} send={send} />;
  if (ph === "shared-auction") return <Auction view={view} send={send} />;
  if (ph === "realtime-update" || ph === "scope" || ph === "privacy" || ph === "injection" || ph === "repetition" || ph === "multiagent" || ph === "structured") return <PollScreen view={view} send={send} />;
  if (ph === "retrieval") return <Retrieval view={view} send={send} />;
  if (ph === "reveal") return <Reveal view={view} />;
  if (ph === "buy" || ph === "blend") return <Sources view={view} send={send} blend={ph === "blend"} />;
  if (ph === "build") return <Build view={view} />;
  if (ph === "provenance") return <Provenance view={view} send={send} />;
  if (ph === "routing") return <Routing view={view} send={send} />;
  return <Final view={view} />;
}

function SharedMeter({ view }: { view: ParticipantView }) {
  const s = view.shared;
  return <div className="card" style={{ gap: 6 }}>
    <div className="row"><span className="eb">Shared context</span><span className="d" style={{ fontSize: 20, color: s.overflow ? "#a3261d" : undefined }}>{s.usedUnits} <span className="m">/ {s.budget} units</span></span></div>
    <Meter used={s.usedUnits} budget={s.budget} />
    <div className="m">{s.activeCount} cards in · {s.participants} participants{s.rolesAssigned ? ` · ${s.rolesAssigned} with roles` : ""}{s.overflow ? ` · ${s.overflow} units over` : ""}</div>
  </div>;
}

function LastAnswer({ view }: { view: ParticipantView }) {
  const r = view.lastSharedRun; if (!r) return null;
  return <div className="card on" style={{ gap: 8 }}>
    <span className="eb" style={{ color: "#9aff36" }}>Shared assistant</span>
    <div style={{ fontSize: 14, lineHeight: 1.4 }}><Cites text={r.text} /></div>
  </div>;
}

function Parked({ view }: { view: ParticipantView }) {
  return <div className="stack" style={{ gap: 14 }}>
    <h1 className="d" style={{ fontSize: 30 }}>You're in, {view.me.firstName}.</h1>
    <p className="m" style={{ fontSize: 15, margin: 0 }}>The room is in the middle of a step. You are <strong>{view.me.number}</strong>, and your screen will come alive at the next one. Keep this page open.</p>
    <div className="card"><span className="eb">Right now</span><span style={{ fontSize: 16, fontWeight: 600 }}>{PHASE_LABEL[view.shared.phase]}</span><Meter used={view.shared.usedUnits} budget={view.shared.budget} /><span className="m">{view.shared.usedUnits} / {view.shared.budget} units in the shared window · {view.shared.participants} people in the room</span></div>
  </div>;
}

function Lobby({ view }: { view: ParticipantView }) {
  return <div className="stack" style={{ gap: 14 }}>
    <h1 className="d" style={{ fontSize: 30 }}>You're in, {view.me.firstName}.</h1>
    <p className="m" style={{ fontSize: 15, margin: 0 }}>Keep this page open. Your screen changes when the speaker moves the room forward. You are <strong>{view.me.number}</strong>.</p>
    <div className="card"><span className="eb">Active context</span><span className="d" style={{ fontSize: 24 }}>0 <span className="m">/ {view.shared.budget} units</span></span><Meter used={0} budget={view.shared.budget} /></div>
    <p className="m">{view.shared.participants} people in the room.</p>
  </div>;
}

function Solo({ view, send, compress }: { view: ParticipantView; send: Send; compress: boolean }) {
  const solo = view.me.solo;
  const cards = view.soloCards;
  const used = cards.reduce((s, c) => { const st = solo.items[c.id]; return st === "available" ? s : s + unitsFor(c, st === "compressed"); }, 0);
  const over = used - solo.budget;
  const run = solo.lastRun;
  // Presets 01 and 02: after the phase's first run the picks are final (the server enforces the same rule).
  const locked = solo.ranIn === view.shared.phase;
  return <div className="stack" style={{ gap: 12 }}>
    {compress && <div className="alert warn">Context limit reduced: 80 → {solo.budget} units</div>}
    {!compress && <div><div className="m">Your task</div><h1 className="d" style={{ fontSize: 26 }}>Prepare Project Atlas for Tuesday's launch.</h1></div>}
    <div className="card" style={{ gap: 6 }}>
      <div className="row"><span className="eb">Active context</span><span className="d" style={{ fontSize: 22, color: over > 0 ? "#a3261d" : undefined }}>{used} <span className="m">/ {solo.budget} units</span></span></div>
      <Meter used={used} budget={solo.budget} />
      <div className="m" style={over > 0 ? { color: "#a3261d", fontWeight: 600 } : undefined}>
        {locked ? "Your picks are locked in." : over > 0 ? `${over} units over. ${compress ? "Summarize or remove" : "Remove"} something.` : compress ? "Don't think only in terms of deleting. What else could you do?" : "Your assistant can't have everything. Tap a card to move it in or out."}
      </div>
    </div>
    <div className="stack">
      {cards.map((c) => {
        const st = solo.items[c.id];
        const on = st !== "available";
        if (!compress) return <button key={c.id} type="button" className={"card" + (on ? " on" : "")} style={{ textAlign: "left", border: 0, flexDirection: "row", alignItems: "flex-start", gap: 12 }} disabled={locked} onClick={() => send({ type: "solo.toggle", itemId: c.id })} aria-pressed={on}>
          <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 6, border: "1.5px solid #95a6a2", background: on ? "#9aff36" : "#fff", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#1c403e", fontWeight: 800 }}>{on ? "✓" : ""}</span>
          <span className="stack" style={{ gap: 3, flexGrow: 1 }}><span className="t">{c.title}</span><span className="m">{c.fullContent}</span></span>
          <span className="cost">{c.contextUnits} u</span>
        </button>;
        return <div key={c.id} className="card" style={{ opacity: st === "available" ? .6 : 1 }}>
          <div className="row" style={{ justifyContent: "flex-start", gap: 10 }}>
            <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 6, border: "1.5px solid #95a6a2", background: on ? "#9aff36" : "#fff", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#1c403e", fontWeight: 800 }}>{on ? "✓" : ""}</span>
            <span className="t" style={{ flexGrow: 1 }}>{c.title}</span><span className="cost">{st === "available" ? "0 u" : unitsLabel(c, st === "compressed")}</span>
          </div>
          <div className="m" style={{ fontWeight: 600, color: on ? "#1c403e" : undefined }}>{st === "active" ? "In context, full text" : st === "compressed" ? "In context, as the summary below" : "Left out. The assistant can't see it."}</div>
          <div className="m" style={st === "compressed" ? { textDecoration: "line-through", opacity: .7 } : undefined}>{c.fullContent}</div>
          {st === "compressed" && <div style={{ background: "#c0e8d2", borderRadius: 8, padding: "8px 10px", fontSize: 13, fontWeight: 500 }}>{c.summaryContent}</div>}
          <div className="seg" role="group" aria-label={c.title}>
            {(["active", "compressed", "available"] as const).map((s) => <button key={s} type="button" className={st === s ? "on" : ""} disabled={locked} onClick={() => send({ type: "solo.set", itemId: c.id, state: s })}>{s === "active" ? "Keep" : s === "compressed" ? "Summarize" : "Remove"}</button>)}
          </div>
        </div>;
      })}
    </div>
    {compress && !locked && <div className="m">Keep and Summarize both put the card in front of the assistant. Summarize sends a shorter version. Remove leaves it out.</div>}
    <div className="m">Cards you leave out stay in <strong>available information</strong>. The assistant hasn't forgotten them. It just can't see them right now.</div>
    <button className="btn" type="button" disabled={locked || over > 0 || used === 0} onClick={() => send({ type: "solo.run" })}>{locked ? "Assistant ran · picks locked" : compress && run ? "Run assistant again" : over > 0 ? "Run assistant · fit the budget first" : "Run assistant"}</button>
    {run && <div className="card on"><span className="eb" style={{ color: "#9aff36" }}>Your assistant says</span><div style={{ fontSize: 14, lineHeight: 1.4 }}><Cites text={run.text} /></div><span className="m">Recommendation: {run.outcome.toUpperCase()} · {run.assembly.usedUnits} units</span></div>}
  </div>;
}

/** Whole seconds left until `msFromNow` (measured when `view` arrived) runs out; ticks locally. */
function useCountdown(view: ParticipantView, msFromNow: number) {
  const [left, setLeft] = useState(() => Math.ceil(msFromNow / 1000));
  useEffect(() => {
    const until = Date.now() + msFromNow;
    const tick = () => setLeft(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
    tick();
    if (msFromNow <= 0) return;
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [view, msFromNow]);
  return left;
}

function Shared({ view, send }: { view: ParticipantView; send: Send }) {
  const role = view.me.role ? ROLE_BY_ID[view.me.role] : undefined;
  const [text, setText] = useState("");
  const wait = useCountdown(view, view.me.roleSendOpensInMs);
  const rc = view.roleCard;
  return <div className="stack" style={{ gap: 14 }}>
    <div className="mode" role="status" aria-label="Session mode"><span className={view.me.mode === "solo" ? "on" : ""}>Solo</span><span className={view.me.mode === "shared" ? "on" : ""}>Shared</span><span className={view.me.mode === "observer" ? "on" : ""}>Observer</span></div>
    <div><h1 className="d" style={{ fontSize: 26 }}>You joined the shared assistant.</h1><div className="m">One context window for the whole room. Everything you send becomes information the assistant can see.</div></div>
    {role && <div className="card on" style={{ gap: 12, padding: 16 }}>
      <div className="row"><span className="eb" style={{ color: "#9aff36" }}>Your secret role</span><span className="chip" style={{ background: "rgba(235,245,255,.14)", color: "#eaf4ff" }}>Only you can see this</span></div>
      <div className="d" style={{ fontSize: 30, color: "#fff" }}>{role.title}</div>
      <div style={{ fontSize: 13, color: "#c7dad7", lineHeight: 1.35 }}>{role.brief}</div>
      {rc && <div style={{ background: "rgba(235,245,255,.083)", borderRadius: 10, padding: 12 }} className="stack">
        <div style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.35 }}>{rc.fullContent}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><span className="chip" style={{ background: "rgba(235,245,255,.14)", color: "#eaf4ff" }}>Source: {rc.sourceName}</span><span className="chip" style={{ background: "rgba(235,245,255,.14)", color: "#eaf4ff" }}>{rc.contextUnits} units</span></div>
      </div>}
      {rc && role.waitForSpeaker && <div className="m" style={{ color: "#c7dad7" }}>No need to tap anything. The speaker brings your card in later.</div>}
      {rc && !role.waitForSpeaker && <button className="btn lime" type="button" disabled={view.me.roleSent || wait > 0} onClick={() => send({ type: "role.send" })}>{view.me.roleSent ? "Sent to shared context" : wait > 0 ? `Send opens in ${wait}` : "Send to shared context"}</button>}
      {role.ability === "restore" && <div className="stack"><span className="m" style={{ color: "#c7dad7" }}>Evicted items you can bring back:</span>
        {view.evictedCards.length === 0 && <span className="m" style={{ color: "#c7dad7" }}>Nothing evicted yet.</span>}
        {view.evictedCards.map((c) => <button key={c.id} className="btn sec sm" type="button" style={{ borderColor: "#9aff36", color: "#9aff36", background: "transparent" }} onClick={() => send({ type: "role.restore", itemId: c.id })}>Restore {c.title}</button>)}
      </div>}
      {role.ability === "summarize" && <div className="stack"><span className="m" style={{ color: "#c7dad7" }}>Compress one active card. Pick the summary that will replace it:</span>
        {view.activeCards.filter((c) => c.state === "active" && c.summaryUnits).map((c) => <div key={c.id} className="stack" style={{ gap: 6, background: "rgba(235,245,255,.083)", borderRadius: 10, padding: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{c.title} · {c.contextUnits} u</span>
          <button className="btn sec sm" type="button" style={{ borderColor: "#9aff36", color: "#9aff36", background: "transparent", width: "100%", height: "auto", padding: "8px 12px", textAlign: "left", justifyContent: "space-between" }} onClick={() => send({ type: "role.summarize", itemId: c.id, variant: "faithful" })}><span>“{c.summaryContent}”</span><span>{c.summaryUnits} u</span></button>
          {c.driftSummary && <button className="btn sec sm" type="button" style={{ borderColor: "#9aff36", color: "#9aff36", background: "transparent", width: "100%", height: "auto", padding: "8px 12px", textAlign: "left", justifyContent: "space-between" }} onClick={() => send({ type: "role.summarize", itemId: c.id, variant: "drift" })}><span>“{c.driftSummary}”</span><span>{c.driftUnits} u</span></button>}
        </div>)}
      </div>}
    </div>}
    {!role && <div className="card"><span className="eb">Observer this round</span><div className="m">You watch the context fill and vote on what happens to it. Contributions come from the people who received roles.</div></div>}
    <SharedMeter view={view} />
    <LastAnswer view={view} />
    {view.submissionOpen && <form className="stack" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { send({ type: "text.submit", text }); setText(""); } }}>
      <label htmlFor="ft">One sentence for the staging area</label>
      <input id="ft" type="text" maxLength={140} value={text} onChange={(e) => setText(e.target.value)} placeholder="Free text goes to staging. The speaker decides what enters." />
      <button className="btn sec" type="submit">Submit to staging</button>
    </form>}
  </div>;
}

function Auction({ view, send }: { view: ParticipantView; send: Send }) {
  const s = view.shared;
  const cards = view.activeCards.filter((c) => c.id !== "SYS-001");
  const set = (id: string, v: number) => send({ type: "credits.set", itemId: id, value: v });
  return <div className="stack" style={{ gap: 10 }}>
    {s.overflow > 0 && <div className="alert bad" style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
      <div className="row"><span style={{ letterSpacing: ".06em", fontSize: 12 }}>CONTEXT OVERFLOW</span><span className="d" style={{ fontSize: 20 }}>{s.usedUnits} / {s.budget}</span></div>
      <Meter used={s.usedUnits} budget={s.budget} />
      <div>{s.overflow} units do not fit. When the assistant runs, the lowest-ranked cards are left out.</div>
    </div>}
    {view.projection && <div className="card" style={{ gap: 4, background: "#1c403e", color: "#eaf4ff" }}>
      <span className="eb" style={{ color: "#9aff36" }}>If we packed now with the room's votes</span>
      <span style={{ fontSize: 14, fontWeight: 600 }}>{view.projection.keep} cards stay ({view.projection.keepUnits} of {view.projection.budget} u){view.projection.evicted.length ? `, ${view.projection.evicted.length} would be evicted` : ", nothing is evicted"}</span>
      {view.projection.evicted.length > 0 && <span className="m" style={{ color: "#c7dad7" }}>Out: {view.projection.evicted.map((e) => e.title).join(", ")}</span>}
      {view.projection.filtered.length > 0 && <span className="m" style={{ color: "#c7dad7" }}>Blocked by policy: {view.projection.filtered.map((e) => e.title).join(", ")}</span>}
      <span className="m" style={{ color: "#c7dad7" }}>Nothing leaves until the assistant runs. Your votes decide what it keeps.</span>
    </div>}
    <div className="row" style={{ alignItems: "flex-end" }}>
      <div><h1 className="d" style={{ fontSize: 24 }}>You operate the window.</h1><div className="m">Spend your relevance credits on what the assistant needs.</div></div>
      <div style={{ textAlign: "right", whiteSpace: "nowrap" }}><div className="d" style={{ fontSize: 30 }}>{view.me.creditsLeft}</div><div className="m">of 100 credits left</div></div>
    </div>
    {!view.votingOpen && <div className="alert warn">Voting is frozen. Your allocation is locked in.</div>}
    {view.votingOpen && view.me.creditsLeft === 0 && <div className="alert" style={{ background: "#1c403e", color: "#9aff36" }}>Locked in · 100 of 100 credits allocated. You can still move them until voting freezes.</div>}
    {view.votingOpen && view.me.creditsLeft > 0 && view.me.creditsLeft < 100 && <div className="m">{100 - view.me.creditsLeft} of 100 allocated so far. Every tap counts on the big screen.</div>}
    <div className="stack" style={{ gap: 6 }}>
      {cards.map((c) => { const v = view.me.credits[c.id] ?? 0; return <div key={c.id} className="row card" style={{ flexDirection: "row", padding: "8px 8px 8px 12px", background: v ? "#fff" : "#f5f5f5" }}>
        <span className="stack" style={{ gap: 2, flexGrow: 1 }}><span className="t">{c.title}</span><span className="m">{c.sourceName} · {c.ageLabel} · {c.contextUnits} u</span></span>
        <span className="step"><button type="button" aria-label={`Less for ${c.title}`} disabled={!view.votingOpen || v === 0} onClick={() => set(c.id, v - 5)}>−</button><output>{v}</output><button type="button" aria-label={`More for ${c.title}`} disabled={!view.votingOpen || view.me.creditsLeft === 0} onClick={() => set(c.id, v + 5)}>+</button></span>
      </div>; })}
    </div>
    <div className="m" style={{ textAlign: "center" }}>Votes aggregate live on the big screen. The room's algorithm is democracy.</div>
    <LastAnswer view={view} />
  </div>;
}

function PollScreen({ view, send }: { view: ParticipantView; send: Send }) {
  const ph = view.shared.phase;
  const featuredId = ph === "realtime-update" ? "ATLAS-005" : ph === "scope" ? "APOLLO-001" : ph === "injection" ? "ATLAS-009" : undefined;
  const featured = featuredId ? view.activeCards.find((c) => c.id === featuredId) : undefined;
  const poll = view.poll;
  const total = poll?.answers ?? 0; const hide = !!poll?.countsHidden;
  const mine = poll ? view.me.votes[poll.id] : undefined;
  const heading = ph === "realtime-update" ? "The world changed." : ph === "scope" ? "True. But is it Atlas's business?" : ph === "privacy" ? "Relevant. But is it permitted?" : ph === "injection" ? "Retrieved. But is it trusted?"
    : ph === "repetition" ? "Five sources say Azure. One says AWS." : ph === "multiagent" ? "Three agents. One coordinator. 80 units." : "Same fact. Two representations.";
  const intro = ph === "repetition" ? "Slack, meeting notes, a wiki page, a retrospective and another Slack thread all say \"Azure preferred\". They copied each other. The contract says AWS once."
    : ph === "multiagent" ? "Research, Security and Infrastructure each produced a result. Full transcripts are 560 units. Summaries are 70. Structured findings are 36. The coordinator can hold 80."
    : ph === "structured" ? "The contract as a paragraph (58 units) or as {cloud: AWS, dataResidency: US, binding: true} (12 units)." : undefined;
  return <div className="stack" style={{ gap: 12 }}>
    <div className="mode" role="status" aria-label="Session mode"><span>Solo</span><span>Shared</span><span className="on">Observer</span></div>
    <h1 className="d" style={{ fontSize: 26 }}>{heading}</h1>
    {featured && <FeaturedCard key={featured.id} c={featured} alert={ph === "realtime-update"} />}
    {intro && <div className="card on"><div style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.35 }}>{intro}</div></div>}
    {ph === "privacy" && <div className="card on"><span className="eb" style={{ color: "#9aff36" }}>Incoming · user memory</span><div style={{ fontSize: 16, fontWeight: 500 }}>A private memory belonging to another user (Alice) just entered the shared window. It mentions her team's budget ceiling.</div><div className="m" style={{ color: "#c7dad7" }}>PRIVATE-001 · 23 units · private to Alice · you cannot see the content, and neither should the shared assistant</div></div>}
    {ph !== "multiagent" && ph !== "structured" && <SharedMeter view={view} />}
    {poll && <div className="card" style={{ gap: 8 }}>
      <div style={{ fontSize: 16, fontWeight: 600 }}>{poll.question}</div>
      <div className="stack" style={{ gap: 6 }}>
        {poll.options.map((o) => { const n = poll.counts[o.id] ?? 0; const pct = total ? Math.round((n / total) * 100) : 0; const on = mine === o.id; return <button key={o.id} type="button" className={"opt" + (on ? " on" : "")} style={{ border: 0, width: "100%", textAlign: "left", flexDirection: "column", alignItems: "stretch", gap: 4 }} disabled={!poll.open || !!mine} onClick={() => send({ type: "poll.vote", pollId: poll.id, optionId: o.id })} aria-pressed={on}>
          <span className="row"><span>{o.label}</span>{!hide && <span className="m" style={on ? { color: "#c7dad7" } : undefined}>{pct}%</span>}</span>
          {!hide && <span className="tally"><i style={{ width: `${pct}%` }} /></span>}
        </button>; })}
      </div>
      <div className="m">{total} answers{mine ? " · yours is locked in" : poll.open ? " · results show after you answer" : " · closed"}</div>
    </div>}
    <LastAnswer view={view} />
  </div>;
}

function FeaturedCard({ c, alert }: { c: ContextItem; alert?: boolean }) {
  const bad = c.trust === "untrusted"; const wrong = c.scope.project && c.scope.project !== "atlas";
  // Preset 05: the card animates once when it lands (CSS plays on mount); phones that can vibrate buzz too.
  useEffect(() => { if (alert) navigator.vibrate?.([120, 80, 120]); }, [alert]);
  return <div className={"card on" + (alert ? " alerting" : "")} style={{ gap: 10 }} role={alert ? "alert" : undefined}>
    {alert && <span className="eb" style={{ color: "#ff7a70" }}>New alert · just now</span>}
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      <span className="chip" style={{ background: "rgba(235,245,255,.14)", color: "#eaf4ff" }}>{c.sourceName}</span>
      {wrong ? <span className="chip warn">Scope: {c.scope.project}</span> : <span className="chip" style={{ background: "rgba(235,245,255,.14)", color: "#eaf4ff" }}>{c.ageLabel}</span>}
      {bad ? <span className="chip bad">untrusted · authority 0/5</span> : <span className="chip" style={{ background: "rgba(235,245,255,.14)", color: "#eaf4ff" }}>authority {c.authority}/5</span>}
    </div>
    <div className="d" style={{ fontSize: 20, color: "#fff", lineHeight: 1.15 }}>{c.fullContent}</div>
    <div className="m" style={{ color: "#c7dad7" }}>{c.id} · {c.contextUnits} units · {c.state === "active" ? "in the shared window" : c.state}</div>
  </div>;
}

function Retrieval({ view, send }: { view: ParticipantView; send: Send }) {
  const mine = view.me.votes["retrieval"];
  const sorted = [...view.retrievalCandidates].sort((a, b) => b.relevance - a.relevance);
  const inWindow = view.activeCards.some((c) => c.id === "ATLAS-002");
  return <div className="stack" style={{ gap: 12 }}>
    <div className="card" style={{ gap: 6 }}><div className="row"><span className="eb">Active context</span><span className={"chip " + (inWindow ? "" : "warn")}>{inWindow ? "Contract present" : "Contract not present"}</span></div><div className="m">The customer contract was evicted under pressure. It still exists in available information.</div></div>
    <h1 className="d" style={{ fontSize: 24 }}>Does forgetting it from the window mean we lost it?</h1>
    <div className="row"><span className="eb">Search results: {sorted.length}</span><span className="eb">Your pick: {mine ? `${mine} · locked in` : "none"}</span></div>
    <div className="stack" style={{ gap: 6 }}>
      {sorted.map((c) => { const on = mine === c.id; const votes = view.retrievalVotes[c.id] ?? 0; return <button key={c.id} type="button" className={"card" + (on ? " on" : "")} style={{ textAlign: "left", border: 0, flexDirection: "row", alignItems: "flex-start", gap: 10 }} disabled={!view.votingOpen || !!mine} onClick={() => send({ type: "retrieval.vote", itemId: c.id })} aria-pressed={on}>
        <span className="d" style={{ fontSize: 18, width: 44, textAlign: "right", flexShrink: 0 }}>{c.relevance.toFixed(2)}</span>
        <span className="stack" style={{ gap: 3, flexGrow: 1 }}><span className="t">{c.title}</span><span className="m">{c.sourceName} · {c.scope.project ? c.scope.project : "org"} · authority {c.authority}/5 · {c.contextUnits} u</span></span>
        {!view.retrievalVotesHidden && <span className="chip" style={on ? { background: "#9aff36" } : undefined}>{votes}</span>}
      </button>; })}
    </div>
    {!view.votingOpen && <div className="alert warn">Voting is frozen. The room's picks are in.</div>}
    <div className="m">Similarity score on the left. {view.retrievalVotesHidden ? "The room's votes show after you pick." : "Room votes on the right."} Similar is not the same as relevant.</div>
    <LastAnswer view={view} />
  </div>;
}

function Reveal({ view }: { view: ParticipantView }) {
  const p = view.policy;
  const stages: [string, boolean][] = [["Permission / privacy", p.permissionFilter], ["Scope", p.projectScope], ["Trust", p.trustFilter], ["Retrieval", p.retrievalEnabled], ["Relevance · age · authority", true], ["Compression", p.summarization], ["Budget packing", true]];
  return <div className="stack" style={{ gap: 12 }}>
    <h1 className="d" style={{ fontSize: 26 }}>Almost everything happened before the model generated a word.</h1>
    <div className="card" style={{ gap: 6 }}>
      <span className="eb">Information environment → context engineering → model</span>
      {stages.map(([l, on]) => <div key={l} className="row" style={{ fontSize: 14, fontWeight: 600 }}><span>{l}</span><span className={"chip " + (on ? "" : "warn")}>{on ? "on" : "off"}</span></div>)}
    </div>
    <div className="m">Context engineering is how we choose and maintain the information available to an assistant as it works.</div>
    <SharedMeter view={view} />
  </div>;
}

function Sources({ view, send, blend }: { view: ParticipantView; send: Send; blend: boolean }) {
  const list = blend ? BLEND_SOURCES : BUY_SOURCES;
  const n = Math.max(1, view.stats.participants);
  const mine = blend ? blendToolUnits(list.filter((s) => !!view.me.sources[s])) : undefined;
  return <div className="stack" style={{ gap: 12 }}>
    <div><h1 className="d" style={{ fontSize: 26 }}>{blend ? "Available sources" : "Assistant context"}</h1><div className="m">{blend ? "Enabling a source expands the information environment. It does not copy the source into the window." : "Suppose we're buying the assistant. Which sources may it use for Atlas?"}</div></div>
    <div style={{ display: "grid", gridTemplateColumns: blend ? "1fr 1fr" : "1fr", gap: 8 }}>
      {list.map((s) => { const on = !!view.me.sources[s]; const pct = Math.round(((view.sourceTallies[s] ?? 0) / n) * 100); return <label key={s} className="row card" style={{ flexDirection: "row", minHeight: 56, fontWeight: 600, fontSize: blend ? 14 : 16 }}>
        <span className="stack" style={{ gap: 2 }}><span>{s}</span><span className="m">room: {pct}% on</span></span>
        <input type="checkbox" className="sw" checked={on} onChange={(e) => send({ type: "sources.set", source: s, enabled: e.target.checked })} />
      </label>; })}
    </div>
    {!blend && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      <div className="card on" style={{ fontSize: 13, gap: 4 }}><div className="d" style={{ fontSize: 18, color: "#9aff36" }}>You decide</div><div>Conversation</div><div>Files</div><div>Instructions</div><div>Memory preferences</div></div>
      <div className="card" style={{ fontSize: 13, gap: 4 }}><div className="d" style={{ fontSize: 18 }}>Vendor decides</div><div>Context assembly</div><div>Truncation</div><div>Retrieval implementation</div><div>Model routing</div><div>Internal summarization</div></div>
    </div>}
    {mine && <div className="row card" style={{ flexDirection: "row", padding: "8px 12px", fontSize: 14, fontWeight: 600 }}>
      <span className="stack" style={{ gap: 2 }}><span>Tool descriptions in the window</span><span className="m">{mine.tools} of {BLEND_TOOL_COUNT} tools on. Each one's description costs units before anything is retrieved.</span></span>
      <span className="d" style={{ fontSize: 18, whiteSpace: "nowrap", flexShrink: 0 }}>{mine.units} u</span>
    </div>}
    {blend && <SharedMeter view={view} />}
    <div className="m">{blend ? "A connector expands the information environment. It does not expand the model's attention infinitely." : "Buying does not eliminate context engineering. It changes who operates which controls."}</div>
    <LastAnswer view={view} />
  </div>;
}

function Build({ view }: { view: ParticipantView }) {
  const p = view.policy;
  const rows: [string, string][] = [["Context budget", String(view.shared.budget)], ["Retrieval top-k", String(p.topK)], ["Minimum relevance", p.minRelevance.toFixed(2)], ["Recency weight", p.recencyWeight.toFixed(2)], ["Authority weight", p.authorityWeight.toFixed(2)], ["Audience weight", p.audienceWeight.toFixed(2)], ["Summary threshold", Math.round(p.summaryThreshold * 100) + "%"], ["Strict project scope", p.projectScope ? "ON" : "OFF"], ["Strict user scope", p.permissionFilter ? "ON" : "OFF"], ["Untrusted instructions", p.trustFilter ? "DATA" : "OBEY"]];
  return <div className="stack" style={{ gap: 10 }}>
    <div><h1 className="d" style={{ fontSize: 26 }}>Context policy</h1><div className="m">When we build more of the system, the decisions don't disappear. We inherit them. The speaker is moving these live.</div></div>
    <div className="stack" style={{ gap: 4 }}>{rows.map(([l, v]) => <div key={l} className="row card" style={{ flexDirection: "row", padding: "8px 12px", fontSize: 14, fontWeight: 600 }}><span>{l}</span><span className="d" style={{ fontSize: 18 }}>{v}</span></div>)}</div>
    <SharedMeter view={view} />
    <LastAnswer view={view} />
  </div>;
}

function Provenance({ view, send }: { view: ParticipantView; send: Send }) {
  const poll = view.poll; const mine = poll ? view.me.votes[poll.id] : undefined;
  const total = poll?.answers ?? 0; const hide = !!poll?.countsHidden;
  return <div className="stack" style={{ gap: 12 }}>
    <h1 className="d" style={{ fontSize: 24 }}>Three facts. Same words. Which would you trust operationally?</h1>
    <div className="stack" style={{ gap: 8 }}>
      {PROVENANCE_SOURCES.map((src) => { const on = mine === `fact-${src.id}`; const n = poll?.counts[`fact-${src.id}`] ?? 0; const pct = total ? Math.round((n / total) * 100) : 0; return <button key={src.id} type="button" className={"card" + (on ? " on" : "")} style={{ textAlign: "left", border: 0, width: "100%" }} disabled={!poll?.open || !!mine} onClick={() => poll && send({ type: "poll.vote", pollId: poll.id, optionId: `fact-${src.id}` })} aria-pressed={on}>
        <span className="eb" style={on ? { color: "#9aff36" } : undefined}>{src.label}</span>
        <span className="d" style={{ fontSize: 20, lineHeight: 1.15 }}>“{PROVENANCE_FACT}”</span>
        <span className="m">Source hidden until the speaker reveals it{hide ? "" : ` · ${pct}% picked this`}</span>
        {!hide && <span className="tally"><i style={{ width: `${pct}%` }} /></span>}
      </button>; })}
    </div>
    {mine && <div className="m">Your answer is locked in.</div>}
    <div className="m">The sources are revealed on the big screen. Context is not just content.</div>
    <LastAnswer view={view} />
  </div>;
}

function Routing({ view, send }: { view: ParticipantView; send: Send }) {
  const poll = view.poll; const mine = poll ? view.me.votes[poll.id] : undefined;
  const total = poll?.answers ?? 0; const hide = !!poll?.countsHidden;
  const p = view.projection;
  return <div className="stack" style={{ gap: 12 }}>
    <div className="card on" style={{ gap: 6 }}><span className="eb" style={{ color: "#9aff36" }}>Current question</span><span className="d" style={{ fontSize: 22, color: "#fff" }}>{view.shared.question}</span><span className="m" style={{ color: "#c7dad7" }}>The other one: {view.shared.question === QUESTIONS.deploy ? QUESTIONS.color : QUESTIONS.deploy}</span></div>
    {p && <div className="card" style={{ gap: 4 }}>
      <span className="eb">Assembled for this question</span>
      <span style={{ fontSize: 14, fontWeight: 600 }}>{p.keep} cards in ({p.keepUnits} of {p.budget} u)</span>
      {p.filtered.length > 0 && <span className="m">Below the relevance floor or blocked: {p.filtered.map((e) => e.title).join(", ")}</span>}
      {p.evicted.length > 0 && <span className="m">Out of budget: {p.evicted.map((e) => e.title).join(", ")}</span>}
    </div>}
    {poll && <div className="card" style={{ gap: 8 }}>
      <div style={{ fontSize: 16, fontWeight: 600 }}>{poll.question}</div>
      <div className="stack" style={{ gap: 6 }}>{poll.options.map((o) => { const n = poll.counts[o.id] ?? 0; const pct = total ? Math.round((n / total) * 100) : 0; const on = mine === o.id; return <button key={o.id} type="button" className={"opt" + (on ? " on" : "")} style={{ border: 0, width: "100%", textAlign: "left", flexDirection: "column", alignItems: "stretch", gap: 4 }} disabled={!poll.open || !!mine} onClick={() => send({ type: "poll.vote", pollId: poll.id, optionId: o.id })} aria-pressed={on}><span className="row"><span>{o.label}</span>{!hide && <span className="m" style={on ? { color: "#c7dad7" } : undefined}>{pct}%</span>}</span>{!hide && <span className="tally"><i style={{ width: `${pct}%` }} /></span>}</button>; })}</div>
      <div className="m">{total} answers{mine ? " · yours is locked in" : poll.open ? " · results show after you answer" : " · closed"}</div>
    </div>}
    <div className="m">Same environment. Different question. Different window. Context is assembled for the task, not merely for the user.</div>
    <LastAnswer view={view} />
  </div>;
}

function Final({ view }: { view: ParticipantView }) {
  const st = view.stats;
  const close = view.shared.phase === "close";
  return <div className="stack" style={{ gap: 12 }}>
    {!close && <div className="card on" style={{ gap: 10 }}><span className="eb" style={{ color: "#9aff36" }}>The same question</span><div className="d" style={{ fontSize: 20, color: "#fff" }}>{view.shared.question}</div>
      {view.lastSharedRun ? <div style={{ fontSize: 14, lineHeight: 1.4, borderTop: ".75px solid rgba(255,255,255,.35)", paddingTop: 10 }}><Cites text={view.lastSharedRun.text} /></div> : <div className="m" style={{ color: "#c7dad7" }}>Waiting for the final run…</div>}
    </div>}
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      <div className="card on" style={{ alignItems: "center", textAlign: "center" }}><span className="eb" style={{ color: "#c7dad7" }}>Model</span><span className="d" style={{ fontSize: 24, color: "#fff" }}>Unchanged</span></div>
      <div className="card" style={{ alignItems: "center", textAlign: "center", background: "#9aff36" }}><span className="eb" style={{ color: "#1c403e" }}>Context</span><span className="d" style={{ fontSize: 24 }}>Engineered</span></div>
    </div>
    <span className="eb">What this room did</span>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      {([["participants", st.participants], ["context decisions", st.decisions], ["evictions", st.evictions], ["summaries", st.summaries], ["retrievals", st.retrievals], ["model", 1]] as [string, number][]).map(([l, n]) => <div key={l} className="card" style={{ gap: 2 }}><span className="d" style={{ fontSize: 26 }}>{n}</span><span className="m" style={{ textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 600 }}>{l}</span></div>)}
    </div>
    <div className="card row" style={{ flexDirection: "row" }}><span className="m" style={{ textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 600 }}>Your decisions</span><span className="d" style={{ fontSize: 22 }}>{view.me.decisions}</span></div>
    <div className="d" style={{ fontSize: 18 }}>{PRESET_BY_PHASE.close.lesson}</div>
  </div>;
}
