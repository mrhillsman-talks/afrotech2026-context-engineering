import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import type { ContextItem, DisplayView, EventLogEntry, Trace } from "@ctx/shared";
import { unitsFor, contentFor, PRESET_BY_PHASE, BUY_SOURCES, BLEND_SOURCES, BLEND_TOOL_COUNT, blendToolUnits, PROVENANCE_FACT, PROVENANCE_SOURCES, QUESTIONS, MULTIAGENT, STRUCTURED, replayEvents, replayTimeline, replayRevealed, replayLine, replayTally } from "@ctx/shared";
import { useSession } from "../ws";
import { Meter, Cites, mmss, useReplayPosition } from "../components/ui";

/** Seconds until the active poll's percentages may show; counts down locally from the snapshot's relative value. */
function usePollReveal(view: DisplayView) { return useCountdown(view, view.pollRevealInMs); }

/** Whole seconds left of `ms` (relative to when `view` arrived), ticking locally; 0 when `ms` is 0 or negative. */
function useCountdown(view: DisplayView, ms: number) {
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil(ms / 1000)));
  useEffect(() => {
    const until = Date.now() + ms;
    const tick = () => setLeft(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
    tick();
    if (ms <= 0) return;
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [view, ms]);
  return left;
}

/** One poll option row: percent and bar, or a placeholder while results are held back. */
function VoteRow({ label, pct, wait, style }: { label: string; pct: number; wait: number; style?: React.CSSProperties }) {
  return <div className="vote" style={style}><span>{label}</span><span className="n">{wait > 0 ? "–" : `${pct}%`}</span><span className="trk"><i style={{ width: wait > 0 ? 0 : `${pct}%` }} /></span></div>;
}

export function Display() {
  const { view, status } = useSession<DisplayView>("display");
  const [localXray, setLocalXray] = useState(false);
  const [inspector, setInspector] = useState(false);
  const [lens, setLens] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "v") setLocalXray((v) => !v);
      if (k === "i") setInspector((v) => !v);
      if (k === "m") setLens((v) => !v);
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (!view) return <div className="stage"><span className="m">{status === "connecting" ? "Connecting…" : "Reconnecting…"}</span></div>;
  const stage = <Stage view={view} status={status} xray={localXray || view.state.xray} inspector={inspector} />;
  return <>{stage}{lens && <Lens>{stage}</Lens>}</>;
}

/** Hold-free magnifier: M toggles a circular lens that follows the pointer, wheel changes zoom.
 *  It is a second render of the same stage, scaled and clipped, so text stays crisp at any zoom. */
function Lens({ children }: { children: React.ReactNode }) {
  const ring = useRef<HTMLDivElement>(null), inner = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let x = innerWidth / 2, y = innerHeight / 2, z = 2.2, raf = 0;
    const place = () => {
      raf = 0;
      if (!ring.current || !inner.current) return;
      const r = Math.min(innerWidth, innerHeight) * 0.22;
      Object.assign(ring.current.style, { left: `${x - r}px`, top: `${y - r}px`, width: `${2 * r}px`, height: `${2 * r}px` });
      // Map the pointer's stage point to the lens centre: x*z + tx = r.
      inner.current.style.transform = `translate(${r - x * z}px, ${r - y * z}px) scale(${z})`;
    };
    const queue = () => { if (!raf) raf = requestAnimationFrame(place); };
    const onMove = (e: PointerEvent) => { x = e.clientX; y = e.clientY; queue(); };
    const onWheel = (e: WheelEvent) => { e.preventDefault(); z = Math.min(5, Math.max(1.25, z * (e.deltaY < 0 ? 1.1 : 1 / 1.1))); queue(); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("resize", queue);
    document.body.style.cursor = "none";
    place();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", queue);
      document.body.style.cursor = "";
    };
  }, []);
  return <div ref={ring} aria-hidden style={{ position: "fixed", zIndex: 1000, borderRadius: "50%", overflow: "hidden", pointerEvents: "none", border: "4px solid #9aff36", boxShadow: "0 0 0 2px #1c403e, 0 1.5vw 4vw rgba(0,0,0,.55)", background: "#1c403e" }}>
    <div ref={inner} style={{ position: "absolute", left: 0, top: 0, width: "100vw", height: "100vh", transformOrigin: "0 0" }}>{children}</div>
  </div>;
}

function Stage({ view, status, xray, inspector }: { view: DisplayView; status: string; xray: boolean; inspector: boolean }) {
  const s = view.state;
  const ph = s.phase;
  const preset = PRESET_BY_PHASE[ph];
  const showResp = s.showResponse && s.runs.length > 0;
  const slideName = s.slide !== undefined ? view.slides[s.slide] : undefined;
  if (slideName) return <Slide view={view} name={slideName} />;
  if (s.replay) return <div className="stage"><Header view={view} status={status} xray={xray} /><Replay view={view} /></div>;
  return <div className="stage">
    <Header view={view} status={status} xray={xray} />
    {ph === "lobby" && <Lobby view={view} />}
    {(ph === "solo-select" || ph === "solo-compress") && <SoloResults view={view} />}
    {(["shared-collect", "shared-auction", "realtime-update", "scope", "privacy", "injection", "retrieval", "build", "routing", "repetition"].includes(ph)) && !showResp && <ContextStage view={view} xray={xray} />}
    {(["shared-collect", "shared-auction", "realtime-update", "scope", "privacy", "injection", "build", "routing", "repetition"].includes(ph)) && showResp && <Response view={view} inspector={inspector || xray} />}
    {/* Retrieval keeps the search results beside the answer: the room votes on them after the first run. */}
    {ph === "retrieval" && showResp && <div style={{ display: "flex", gap: "1.2vw", flexGrow: 1, minHeight: 0 }}>
      <div className="stack" style={{ flex: "1 1 0", minWidth: 0, minHeight: 0, gap: 0 }}><Response view={view} inspector={inspector || xray} /></div>
      <SidePanel view={view} />
    </div>}
    {ph === "multiagent" && <MultiAgent view={view} />}
    {ph === "structured" && <Structured view={view} />}
    {ph === "provenance" && <Provenance view={view} xray={xray} />}
    {ph === "reveal" && <Pipeline view={view} />}
    {(ph === "buy" || ph === "blend") && !showResp && <Sources view={view} blend={ph === "blend"} />}
    {(ph === "buy" || ph === "blend") && showResp && <Response view={view} inspector={inspector || xray} />}
    {ph === "final" && <Final view={view} inspector={inspector || xray} />}
    {ph === "close" && <Close view={view} />}
    <div className="row" style={{ fontSize: "1vw", color: "#b7cac7" }}><span>{preset.lesson}</span><span>{s.frozen ? "PAUSED · " : ""}{view.participants} in the room</span></div>
  </div>;
}

/** One of the speaker's own slides, full-bleed. The neighbours are fetched ahead so a clicker press swaps instantly. */
function Slide({ view, name }: { view: DisplayView; name: string }) {
  const i = view.state.slide ?? 0;
  const src = (n: string) => `slides/${encodeURIComponent(n)}`;
  useEffect(() => {
    for (const n of [view.slides[i + 1], view.slides[i - 1]]) if (n) { const img = new Image(); img.src = src(n); }
  }, [view.slides, i]);
  return <div className="stage slides"><img className="slide" src={src(name)} alt={`Slide ${i + 1} of ${view.slides.length}`} /></div>;
}

function Header({ view, status, xray }: { view: DisplayView; status: string; xray: boolean }) {
  const s = view.state; const p = PRESET_BY_PHASE[s.phase];
  return <div className="row" style={{ height: "5vh" }}>
    <div style={{ display: "flex", alignItems: "center", gap: "1.2vw" }}><span className="d" style={{ fontSize: "1.6vw" }}>Context Window Live</span><span className="eb">{p.code} · {p.name}</span></div>
    {s.phase !== "lobby" && s.phase !== "close" && <div className="d" style={{ fontSize: "1.5vw", color: "#eaf4ff" }}>{s.question}</div>}
    <div style={{ display: "flex", alignItems: "center", gap: ".8vw", fontSize: ".9vw", color: "#c7dad7" }}>{xray && <span className="chip lime">X-RAY</span>}{status !== "open" && <span className="chip bad">reconnecting</span>}<span>v{s.version}</span></div>
  </div>;
}

function Lobby({ view }: { view: DisplayView }) {
  const [qr, setQr] = useState<string>("");
  useEffect(() => { QRCode.toDataURL(view.joinUrl, { margin: 1, width: 640, color: { dark: "#1c403e", light: "#ffffff" } }).then(setQr).catch(() => setQr("")); }, [view.joinUrl]);
  return <>
    <div style={{ display: "flex", gap: "5vw", alignItems: "center", flexGrow: 1 }}>
      <div className="stack" style={{ gap: "2vh", flexGrow: 1 }}>
        <div className="eb">Context engineering · live</div>
        <h1 className="d" style={{ fontSize: "6.8vw", maxWidth: "58vw" }}>You are about to run a context window</h1>
        <div style={{ fontSize: "2vw", color: "#eaf4ff" }}>Join the room. No installation required.</div>
        <div style={{ fontSize: "1.2vw", color: "#c7dad7" }}>{view.recentJoins.length ? "Just joined: " + view.recentJoins.join(" · ") : ""}</div>
      </div>
      <div className="stack" style={{ alignItems: "center", gap: "1.5vh" }}>
        <div style={{ width: "24vw", height: "24vw", background: "#fff", borderRadius: "1.5vw", padding: "1.2vw", display: "flex", alignItems: "center", justifyContent: "center" }}>{qr ? <img src={qr} alt="QR code to join" style={{ width: "100%", height: "100%" }} /> : <span style={{ color: "#1c403e" }}>QR</span>}</div>
        {/* Large enough to read from the back row; a long URL wraps instead of pushing the layout.
            The printed URL is SHORT_URL when set, else the site root, which redirects to /session/main; the QR code keeps the full URL. */}
        <div style={{ fontSize: "1.6vw", color: "#eaf4ff" }}>or open</div>
        <strong className="d" style={{ fontSize: "3.4vw", lineHeight: 1.1, color: "#9aff36", maxWidth: "42vw", textAlign: "center", overflowWrap: "anywhere" }}>{view.shortUrl || view.joinUrl.replace(/\/session\/main\/?$/, "")}</strong>
      </div>
    </div>
    <BudgetRow used={0} budget={view.state.budget} />
  </>;
}

function BudgetRow({ used, budget, overflow = 0 }: { used: number; budget: number; overflow?: number }) {
  return <div style={{ display: "flex", alignItems: "center", gap: "1.5vw" }}>
    <span className="eb" style={{ whiteSpace: "nowrap" }}>Active context</span>
    <Meter used={used} budget={budget} className={overflow ? "over" : ""} />
    <span className="d" style={{ fontSize: "2.4vw", whiteSpace: "nowrap", color: overflow ? "#ff7a70" : undefined }}>{used} <span style={{ fontSize: "1.2vw", color: "#c7dad7" }}>/ {budget} units</span></span>
    {overflow > 0 && <span style={{ background: "#5c1a14", color: "#ffb3ab", borderRadius: ".5vw", padding: ".4vw .8vw", fontSize: ".95vw", fontWeight: 700, letterSpacing: ".04em", whiteSpace: "nowrap" }}>CONTEXT OVERFLOW · {overflow} units cannot enter</span>}
  </div>;
}

function SoloResults({ view }: { view: DisplayView }) {
  const o = view.soloOutcomes; const t = Math.max(1, o.total);
  const pct = (n: number) => Math.round((n / t) * 100);
  const compress = view.state.phase === "solo-compress";
  const rows: [string, number, string][] = [["AWS", o.aws, ""], ["Azure", o.azure, "dim"], ["Other", o.other + o.gcp, "dimmer"]];
  return <>
    <h1 className="d" style={{ fontSize: "4.6vw" }}>{o.total === 0 ? (compress ? "Context limit reduced: 80 → " + view.state.soloBudget + " units" : "Everyone gets their own assistant.") : "What did our identical assistants recommend?"}</h1>
    {o.total === 0 && <div style={{ fontSize: "1.6vw", color: "#c7dad7" }}>{compress ? "Keep, summarize or remove. Then run again." : `Budget: ${view.state.soloBudget} units. Six cards. Choose what your assistant sees, then run it.`}</div>}
    <div className="stack" style={{ gap: "1.5vh" }}>
      {rows.map(([l, n, cls]) => <div key={l} className="bar"><span className="lbl">{l}</span><span className="trk"><i style={{ width: `${pct(n)}%`, background: cls === "dim" ? "#64dc7b" : cls === "dimmer" ? "#95a6a2" : undefined }} /></span><span className="pct">{pct(n)}%</span></div>)}
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "1.2vw", flexGrow: 1, alignContent: "start" }}>
      <div className="panel"><span className="eb" style={{ fontSize: "1vw" }}>Kept the contract</span><span style={{ fontSize: "1.3vw", color: "#eaf4ff" }}>“Atlas should deploy to AWS in the United States.”</span><span className="m" style={{ fontSize: ".9vw" }}>ATLAS-002 in context</span></div>
      <div className="panel"><span className="eb" style={{ fontSize: "1vw" }}>Kept the CEO memo, lost the contract</span><span style={{ fontSize: "1.3vw", color: "#eaf4ff" }}>“Azure appears consistent with organizational direction.”</span><span className="m" style={{ fontSize: ".9vw" }}>ATLAS-007 in, ATLAS-002 out</span></div>
      <div className="panel"><span className="eb" style={{ fontSize: "1vw" }}>Kept Apollo</span><span style={{ fontSize: "1.3vw", color: "#eaf4ff" }}>“Azure appears to be the established production platform.”</span><span className="m" style={{ fontSize: ".9vw" }}>APOLLO-001 in, wrong project</span></div>
    </div>
    <div className="row" style={{ alignItems: "flex-end" }}><div className="d" style={{ fontSize: "2.4vw", color: "#eaf4ff" }}>Same application. Same model. Same question.</div><div className="eb" style={{ fontSize: "1.6vw" }}>{o.total} assistants ran</div></div>
  </>;
}

function Card({ it, xray, cls, compressed, style }: { it: ContextItem; xray: boolean; cls?: string; compressed?: boolean; style?: React.CSSProperties }) {
  const units = unitsFor(it, !!compressed);
  const priv = it.sensitivity === "private";
  const drifted = !!compressed && it.corrupted && !!it.driftSummary;
  const body = priv ? "Private to another user. Content withheld from the room." : contentFor(it, !!compressed);
  return <div className={"card " + (cls ?? "")} style={style}>
    <span className="t"><span>{it.title}</span><span>{compressed ? <><s style={{ opacity: .6 }}>{it.contextUnits}</s> → {units} u</> : `${units} u`}</span></span>
    <span className="b">{body}</span>
    {drifted && xray && <span className="x" style={{ borderTop: 0, paddingTop: 0 }}><span className="chip warn">summary drifted</span><span>was: {it.summaryContent}</span></span>}
    {xray && <span className="x">
      <span>{it.sourceType} · {it.sourceName}</span>
      <span>{it.scope.user ? `scope: user ${it.scope.user}` : it.scope.project ? `scope: ${it.scope.project}` : it.scope.organization ? "scope: org" : "scope: session"}</span>
      <span className={it.ageDays > 30 ? "chip warn" : ""}>{it.ageLabel}{it.ageDays > 30 ? " · stale" : ""}</span>
      <span>auth {it.authority}/5</span>
      <span className={it.trust === "untrusted" ? "chip bad" : ""}>{it.trust}</span>
      {priv && <span className="chip bad">private</span>}
      {it.submittedBy && <span>from {it.submittedBy}</span>}
      {it.pinned && <span>pinned</span>}
    </span>}
  </div>;
}

function ContextStage({ view, xray }: { view: DisplayView; xray: boolean }) {
  const s = view.state; const a = view.assembly;
  const items = Object.values(s.items);
  const inWindow = items.filter((i) => i.state === "active" || i.state === "compressed");
  // The meter counts only cards that passed every filter, so a filtered or quarantined card leaves it.
  const used = a.demandedUnits;
  const overflow = a.overflow;
  const traceById = Object.fromEntries(a.traces.map((t) => [t.id, t]));
  const cls = (i: ContextItem, t?: Trace) => {
    if (t?.result === "QUARANTINED") return "bad";
    if (t?.result === "EXCLUDED") return t.reason === "evicted by budget packing" ? "dim" : "bad";
    if (i.trust === "untrusted" || i.sensitivity === "private") return "bad";
    if (i.tags.includes("stale") || i.tags.includes("wrong-scope")) return "warn";
    return "";
  };
  const packed = inWindow.filter((i) => a.included.includes(i.id)).sort((x, y) => Number(y.pinned) - Number(x.pinned) || (traceById[y.id]?.score ?? 0) - (traceById[x.id]?.score ?? 0));
  // A card the trust filter quarantines goes in the Quarantine slot with the ones the operator quarantined.
  const trustQuarantined = (i: ContextItem) => traceById[i.id]?.result === "QUARANTINED";
  const filtered = inWindow.filter((i) => !a.included.includes(i.id) && !trustQuarantined(i));
  const evicted = items.filter((i) => i.state === "evicted");
  const quarantined = items.filter((i) => i.state === "quarantined" || (inWindow.includes(i) && trustQuarantined(i)));
  const width = (i: ContextItem) => `${Math.min(30, Math.max(11, unitsFor(i, i.state === "compressed") * 0.28))}vw`;
  const ph = s.phase;
  // Spotlit cards: lime when they just entered the window, coral when they were just pushed out of it.
  const spot = new Set(s.spotlight ?? []);
  const sp = (i: ContextItem, inside: boolean) => spot.has(i.id) ? (inside ? " spot in" : " spot out") : "";
  return <>
    <BudgetRow used={used} budget={s.budget} overflow={overflow} />
    <div style={{ display: "flex", gap: "1.2vw", flexGrow: 1, minHeight: 0 }}>
      <div className="env">
        <div className="row"><span className="eb" style={{ color: "#b7cac7" }}>Information environment</span><div style={{ display: "flex", gap: ".4vw" }}>{["Slack", "CRM", "Files", "Memory", "GitHub", "Tools", "Web"].map((x) => <span key={x} className="src">{x}</span>)}</div></div>
        <div style={{ display: "flex", gap: ".9vw", flexGrow: 1, minHeight: 0 }}>
          <div className={"active" + (overflow ? " over" : "")}>
            <div className="row"><span className="eb">Active context</span><span className="m" style={{ fontSize: ".85vw" }}>card size ∝ cost · {packed.length} cards{a.compressed.length ? ` · ${a.compressed.length} compressed` : ""}</span></div>
            <FitBox style={{ flex: "1 1 0" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: ".6vw", alignContent: "flex-start" }}>
                {packed.map((i) => <Card key={i.id} it={i} xray={xray} cls={cls(i, traceById[i.id]) + sp(i, true)} compressed={a.compressed.includes(i.id)} style={{ width: width(i) }} />)}
                {packed.length === 0 && <span className="m" style={{ fontSize: "1.2vw" }}>Empty. Nothing is available to the assistant yet.</span>}
              </div>
            </FitBox>
          </div>
          {(filtered.length > 0 || evicted.length > 0 || quarantined.length > 0) && <FitBox style={{ width: "17vw", flexShrink: 0 }}><div className="stack" style={{ gap: ".8vw" }}>
            {filtered.length > 0 && <div className="slot stack"><span className="h">{overflow ? "Cannot enter · over budget or filtered" : "Filtered out by policy"}</span>{filtered.map((i) => <Card key={i.id} it={i} xray={xray} cls={cls(i, traceById[i.id]) + sp(i, false)} compressed={i.state === "compressed" || !!traceById[i.id]?.compressed} style={{ outline: traceById[i.id]?.result === "EXCLUDED" && traceById[i.id].reason === "evicted by budget packing" ? "2px dashed #ff7a70" : undefined }} />)}</div>}
            {quarantined.length > 0 && <div className="slot stack"><span className="h">Quarantine · inspect only</span>{quarantined.map((i) => <Card key={i.id} it={i} xray={xray} cls={"bad dim" + sp(i, false)} />)}</div>}
            {evicted.length > 0 && <div className="slot stack"><span className="h">Evicted · still available</span>{evicted.slice(0, 4).map((i) => <div key={i.id} className="card dim"><span className="t"><span>{i.title}</span><span>{i.contextUnits} u</span></span></div>)}{evicted.length > 4 && <span className="m" style={{ fontSize: ".8vw" }}>+{evicted.length - 4} more</span>}</div>}
          </div></FitBox>}
        </div>
      </div>
      <SidePanel view={view} />
    </div>
    {ph === "shared-collect" && s.staging.length > 0 && <div className="m" style={{ fontSize: ".9vw" }}>Staging: {s.staging.length} audience sentences waiting for the speaker.</div>}
  </>;
}

/**
 * Fits however much content it is given into the box it is given. The stage has no scrollbars: the display is a
 * projector and the speaker cannot scroll it, so when more cards are in the window than fit at full size, the
 * content is laid out wider and scaled down until every card is visible. The scale is found by bisection: a wider
 * layout wraps into fewer, shorter rows, so "scaled height fits" is monotone in the scale. Card widths stay
 * proportional to cost because everything shrinks together. A small inset keeps the 2px card outlines inside the clip.
 */
function FitBox({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const fit = useCallback(() => {
    const o = outer.current, n = inner.current;
    if (!o || !n) return;
    const W = o.clientWidth, H = o.clientHeight;
    if (!W || !H) return;
    const fits = (s: number) => { n.style.width = `${W / s}px`; return n.scrollHeight * s <= H + 0.5; };
    let s = 1;
    if (!fits(1)) {
      let lo = 0.2, hi = 1;
      for (let k = 0; k < 8; k++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
      s = lo;
    }
    s = Math.round(s * 1000) / 1000;
    n.style.width = `${W / s}px`;
    setScale(s);
  }, []);
  useLayoutEffect(fit);
  useLayoutEffect(() => {
    const o = outer.current; if (!o) return;
    const ro = new ResizeObserver(fit); ro.observe(o);
    document.fonts?.ready.then(fit);
    return () => ro.disconnect();
  }, [fit]);
  return <div ref={outer} style={{ ...style, position: "relative", overflow: "hidden", minWidth: 0, minHeight: 0 }}>
    <div ref={inner} style={{ transform: `scale(${scale})`, transformOrigin: "top left", padding: "3px" }}>{children}</div>
  </div>;
}

function SidePanel({ view }: { view: DisplayView }) {
  const s = view.state; const ph = s.phase;
  const poll = s.activePollId ? s.polls[s.activePollId] : undefined;
  const wait = usePollReveal(view);
  const rr = view.retrievalReveal;
  // 09: counts held back until 15 s after the first pick (counted down here) or half the room has picked (server decides).
  const rWait = useCountdown(view, rr.inMs);
  const rHidden = rr.hidden && (rr.inMs < 0 || rWait > 0);
  const wrap = (title: string, sub: string, body: React.ReactNode, foot?: React.ReactNode) => <div className="panel" style={{ width: "21vw", flexShrink: 0 }}>
    <div className="row"><span className="eb">{title}</span><span className="m" style={{ fontSize: ".85vw" }}>{sub}</span></div>{body}<div style={{ flexGrow: 1 }} />{foot}
  </div>;
  // Credits are cleared when the room leaves 04, so Build shows them only if someone has voted since.
  if (ph === "shared-auction" || (ph === "build" && s.policy.useAudienceVotes && Object.values(view.creditTotals).some((n) => n > 0))) {
    const totals = Object.entries(view.creditTotals).filter(([id]) => s.items[id]).sort((a, b) => b[1] - a[1]).slice(0, 9);
    const max = Math.max(1, ...totals.map((t) => t[1]));
    const voted = Object.values(view.creditTotals).reduce((a, b) => a + b, 0);
    return wrap("Relevance credits", `live · ${Math.round(voted / 100)} voted${s.votingOpen ? "" : " · frozen"}`,
      <div className="stack" style={{ gap: ".6vw" }}>{totals.map(([id, n]) => <div key={id} className="vote"><span>{s.items[id].title}</span><span className="n">{n.toLocaleString()}</span><span className="trk"><i style={{ width: `${(n / max) * 100}%` }} /></span></div>)}{totals.length === 0 && <span className="m">Waiting for votes…</span>}</div>,
      <><div className="d" style={{ fontSize: "1.4vw", color: "#eaf4ff" }}>Our context-management algorithm is democracy.</div><div className="m" style={{ fontSize: ".9vw" }}>Popularity is a signal. It is not authority.</div></>);
  }
  if (ph === "routing") {
    const total = poll ? Object.values(poll.counts).reduce((a, b) => a + b, 0) : 0;
    return wrap("Two questions, one environment", "speaker switches", <div className="stack" style={{ gap: ".6vw" }}>
      {(["deploy", "color"] as const).map((k) => <div key={k} style={{ borderRadius: ".6vw", padding: ".7vw .9vw", background: s.questionKey === k ? "#9aff36" : "rgba(235,245,255,.083)", color: s.questionKey === k ? "#1c403e" : "#eaf4ff", fontSize: "1.15vw", lineHeight: 1.25 }}>{QUESTIONS[k]}</div>)}
      <div className="m" style={{ fontSize: ".9vw" }}>Relevance floor {s.policy.minRelevance.toFixed(2)} · cards below it for the current question leave the window.</div>
      {poll && <div className="stack" style={{ gap: ".4vw", marginTop: ".6vw" }}><div style={{ fontSize: "1vw", color: "#eaf4ff" }}>{poll.question}{wait > 0 && <span className="m"> · results in {wait} s</span>}</div>{poll.options.map((o) => <VoteRow key={o.id} label={o.label} pct={total ? Math.round(((poll.counts[o.id] ?? 0) / total) * 100) : 0} wait={wait} />)}</div>}
    </div>, <div className="d" style={{ fontSize: "1.4vw", color: "#eaf4ff" }}>Context should be assembled for the task, not merely for the user.</div>);
  }
  if (poll) {
    const total = Object.values(poll.counts).reduce((a, b) => a + b, 0);
    return wrap("Quick poll", `${total} answers${poll.open ? "" : " · closed"}${wait > 0 ? ` · results in ${wait} s` : ""}`,
      <><div style={{ fontSize: "1.2vw", color: "#eaf4ff", lineHeight: 1.3 }}>{poll.question}</div><div className="stack" style={{ gap: ".6vw" }}>{poll.options.map((o) => <VoteRow key={o.id} label={o.label} pct={total ? Math.round(((poll.counts[o.id] ?? 0) / total) * 100) : 0} wait={wait} />)}</div></>,
      <PolicyChips view={view} />);
  }
  if (ph === "retrieval") {
    const cands = s.retrievalCandidates.map((id) => s.items[id]).sort((a, b) => b.relevance - a.relevance);
    const max = Math.max(1, ...Object.values(view.retrievalVotes));
    // "In" means the assistant gets it: a result already active but filtered (Apollo, wrong project) is not in.
    const inWin = (id: string) => view.assembly.included.includes(id);
    const held = rHidden ? (rr.picks === 0 ? " · waiting for picks" : ` · ${rr.picks} picked · votes in ${rWait} s`) : "";
    return wrap("Search external knowledge", `results: ${cands.length} · in the window: ${cands.filter((c) => inWin(c.id)).length}${held}`,
      <div className="stack" style={{ gap: ".6vw" }}>{cands.map((c) => <div key={c.id} className="vote"><span><span style={{ color: "#9aff36", fontFamily: "var(--display)" }}>{c.relevance.toFixed(2)}</span> {c.title}{inWin(c.id) ? <span className="chip lime" style={{ marginLeft: ".4vw" }}>in</span> : null}</span><span className="n">{rHidden ? "–" : view.retrievalVotes[c.id] ?? 0}</span><span className="trk"><i style={{ width: rHidden ? 0 : `${((view.retrievalVotes[c.id] ?? 0) / max) * 100}%` }} /></span></div>)}</div>,
      <div className="m" style={{ fontSize: ".95vw" }}>Retrieval produces candidates. Context assembly decides what enters.</div>);
  }
  if (ph === "build") {
    const p = s.policy;
    const rows: [string, string][] = [["Context budget", String(s.budget)], ["Retrieval top-k", String(p.topK)], ["Min relevance", p.minRelevance.toFixed(2)], ["Recency weight", p.recencyWeight.toFixed(2)], ["Authority weight", p.authorityWeight.toFixed(2)], ["Audience weight", p.audienceWeight.toFixed(2)], ["Summary threshold", Math.round(p.summaryThreshold * 100) + "%"], ["Strict project scope", p.projectScope ? "ON" : "OFF"], ["Strict user scope", p.permissionFilter ? "ON" : "OFF"], ["Untrusted instructions", p.trustFilter ? "DATA" : "OBEY"]];
    return wrap("Context policy", "build mode", <div className="stack" style={{ gap: ".3vw" }}>{rows.map(([l, v]) => <div key={l} className="row" style={{ fontSize: "1vw" }}><span>{l}</span><span className="d" style={{ fontSize: "1.2vw", color: "#9aff36" }}>{v}</span></div>)}</div>);
  }
  return wrap("Metadata", s.xray ? "revealed" : "press V", <PolicyChips view={view} />, <div className="m" style={{ fontSize: ".95vw" }}>Everything entering the window is information. Not everything has the same meaning.</div>);
}

function PolicyChips({ view }: { view: DisplayView }) {
  const p = view.state.policy;
  const rows: [string, boolean][] = [["Permission filter", p.permissionFilter], ["Strict project scope", p.projectScope], ["Untrusted is data", p.trustFilter], ["Retrieval", p.retrievalEnabled], ["Audience votes", p.useAudienceVotes], ["Auto summarize", p.summarization]];
  return <div className="stack" style={{ gap: ".3vw" }}>{rows.map(([l, on]) => <div key={l} className="row" style={{ fontSize: "1vw" }}><span>{l}</span><span className={"chip " + (on ? "lime" : "bad")}>{on ? "ON" : "OFF"}</span></div>)}</div>;
}

function Response({ view, inspector }: { view: DisplayView; inspector: boolean }) {
  const s = view.state; const run = s.runs[s.runs.length - 1];
  const a = run.assembly;
  // Exclusions and quarantines are the teaching moments, so they come first; then the cards the answer cites,
  // since those decided it (09's Azure answer rests on the lowest-scored card); other included cards fill what is left.
  const excludedT = a.traces.filter((t) => t.result !== "INCLUDED" && t.result !== "COMPRESSED");
  const includedT = a.traces.filter((t) => t.result === "INCLUDED" || t.result === "COMPRESSED");
  const cited = new Set(run.cites);
  const interesting = excludedT.concat(includedT.filter((t) => cited.has(t.id)), includedT.filter((t) => !cited.has(t.id))).slice(0, 7);
  const hidden = a.traces.length - interesting.length;
  return <div style={{ display: "grid", gridTemplateColumns: inspector ? "1.1fr 1fr" : "1fr", gap: "2vw", flexGrow: 1, minHeight: 0 }}>
    <div className="stack" style={{ gap: "1.5vh", minWidth: 0 }}>
      <div className="row"><span className="eb">Assistant · run #{run.id}</span><span className="m" style={{ fontSize: ".9vw" }}>{run.renderer}{run.fallbackUsed ? "" : ""} · {run.latencyMs} ms · {a.usedUnits} / {a.budget} units</span></div>
      <div className="panel" style={{ padding: "1.6vw 2vw" }}>
        <p style={{ margin: 0, fontSize: inspector ? "1.7vw" : "2.3vw", lineHeight: 1.35, color: "#eaf4ff" }}><Cites text={run.text} /></p>
      </div>
      <div className="row"><span className={"chip " + (run.outcome === "aws" ? "lime" : run.outcome === "gcp" ? "bad" : "warn")} style={{ fontSize: "1vw", padding: ".3vw .9vw" }}>{run.outcome.toUpperCase()}</span><span className="m" style={{ fontSize: "1vw" }}>{inspector ? "" : "press I for the Context Inspector"}</span></div>
      {inspector && <div className="stack" style={{ gap: ".4vw" }}><span className="eb" style={{ color: "#b7cac7" }}>Eval</span><div style={{ display: "flex", flexWrap: "wrap", gap: ".4vw 1.2vw", fontSize: ".95vw" }}>{[...run.eval.required, ...run.eval.forbidden].map((c) => <span key={c.label} className="r"><span className={c.ok ? "ok" : "no"}>{c.ok ? "✓" : "✕"}</span> {c.label}</span>)}<span className={"res " + (run.eval.pass ? "in" : "out")}>{run.eval.pass ? "PASS" : "FAIL"}</span></div></div>}
    </div>
    {inspector && <div className="stack inspector" style={{ gap: ".45vw", minWidth: 0, minHeight: 0, overflow: "auto" }}>
      <div className="row"><span className="eb">Context Inspector</span><span className="m" style={{ fontSize: ".9vw" }}>Why did the assistant see this?{hidden > 0 ? ` · ${hidden} more included` : ""}</span></div>
      {interesting.map((t) => <div key={t.id} className="trace">
        <div className="h"><span>{t.id} · {t.title}</span><span className={"res " + (t.result === "INCLUDED" || t.result === "COMPRESSED" ? "in" : t.result === "QUARANTINED" ? "q" : "out")}>{t.result}</span></div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: ".15vw .9vw" }}>{t.checks.map((c, i) => <span key={i} className="r"><span className={c.ok ? "ok" : "no"}>{c.ok ? "✓" : "✕"}</span> {c.label}</span>)}</div>
      </div>)}
    </div>}
  </div>;
}

function Provenance({ view, xray }: { view: DisplayView; xray: boolean }) {
  const s = view.state; const poll = s.activePollId ? s.polls[s.activePollId] : undefined;
  const wait = usePollReveal(view);
  const total = poll ? Object.values(poll.counts).reduce((a, b) => a + b, 0) : 0;
  return <>
    <h1 className="d" style={{ fontSize: "3.6vw" }}>Three facts. Same words. Which would you trust operationally?</h1>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "1.5vw", flexGrow: 1, alignContent: "center" }}>
      {PROVENANCE_SOURCES.map((src) => { const n = poll?.counts[`fact-${src.id}`] ?? 0; const pct = total ? Math.round((n / total) * 100) : 0; return <div key={src.id} className="panel" style={{ padding: "2vw", gap: "1vw", minHeight: "36vh", justifyContent: "space-between" }}>
        <span className="eb">{src.label}</span>
        <span className="d" style={{ fontSize: "2.6vw", color: "#eaf4ff" }}>“{PROVENANCE_FACT}”</span>
        {xray ? <div className="stack" style={{ gap: ".3vw" }}><span style={{ fontSize: "1.3vw", color: "#9aff36" }}>{src.source}</span><span className="m" style={{ fontSize: "1vw" }}>authority {src.authority}/5 · {src.trust} · {src.age}</span></div> : <span className="m" style={{ fontSize: "1.1vw" }}>source hidden · press V to reveal</span>}
        <VoteRow label="picked by the room" pct={pct} wait={wait} />
      </div>; })}
    </div>
    <div className="row"><span className="d" style={{ fontSize: "2vw", color: "#eaf4ff" }}>The text is identical. Only provenance differs.</span><span className="m" style={{ fontSize: "1vw" }}>{total} answers{wait > 0 ? ` · results in ${wait} s` : ""}</span></div>
  </>;
}

function PollBars({ view }: { view: DisplayView }) {
  const s = view.state; const poll = s.activePollId ? s.polls[s.activePollId] : undefined;
  const wait = usePollReveal(view);
  if (!poll) return null;
  const total = Object.values(poll.counts).reduce((a, b) => a + b, 0);
  return <div className="panel" style={{ gap: ".5vw" }}>
    <div className="row"><span style={{ fontSize: "1.2vw", color: "#eaf4ff" }}>{poll.question}</span><span className="m" style={{ fontSize: ".9vw" }}>{total} answers{wait > 0 ? ` · results in ${wait} s` : ""}</span></div>
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${poll.options.length}, minmax(0,1fr))`, gap: "1vw" }}>
      {poll.options.map((o) => <VoteRow key={o.id} label={o.label} pct={total ? Math.round(((poll.counts[o.id] ?? 0) / total) * 100) : 0} wait={wait} style={{ gridTemplateColumns: "minmax(0,1fr) 4vw" }} />)}
    </div>
  </div>;
}

function MultiAgent({ view }: { view: DisplayView }) {
  const totals = MULTIAGENT.agents.reduce((a, g) => ({ t: a.t + g.transcriptUnits, s: a.s + g.summaryUnits, f: a.f + g.structuredUnits }), { t: 0, s: 0, f: 0 });
  const opt = (label: string, units: number) => <div className="panel" style={{ alignItems: "center", padding: ".9vw", gap: ".2vw", background: units <= MULTIAGENT.coordinatorBudget ? "rgba(154,255,54,.14)" : "rgba(92,26,20,.6)" }}>
    <span className="eb" style={{ fontSize: ".9vw" }}>{label}</span><span className="d" style={{ fontSize: "2.4vw" }}>{units} u</span><span className="m" style={{ fontSize: ".85vw" }}>{units <= MULTIAGENT.coordinatorBudget ? "fits" : `${units - MULTIAGENT.coordinatorBudget} over`}</span>
  </div>;
  return <>
    <h1 className="d" style={{ fontSize: "3.4vw" }}>Three agents report. The coordinator can hold {MULTIAGENT.coordinatorBudget} units.</h1>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "1.2vw" }}>
      {MULTIAGENT.agents.map((g) => <div key={g.name} className="panel" style={{ gap: ".5vw" }}>
        <span className="eb">{g.name}</span>
        <span style={{ fontSize: "1.15vw", color: "#eaf4ff", lineHeight: 1.3 }}>{g.finding}</span>
        <span className="m" style={{ fontSize: ".9vw" }}>transcript {g.transcriptUnits} u · summary {g.summaryUnits} u · structured {g.structuredUnits} u</span>
      </div>)}
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "1.2vw" }}>
      {opt("Full transcripts", totals.t)}{opt("Summaries", totals.s)}{opt("Structured findings", totals.f)}
    </div>
    <PollBars view={view} />
    <div style={{ flexGrow: 1 }} />
    <div className="d" style={{ fontSize: "1.8vw", color: "#eaf4ff" }}>Agents hand each other context too. Same budget problem, one level up.</div>
  </>;
}

function Structured({ view }: { view: DisplayView }) {
  return <>
    <h1 className="d" style={{ fontSize: "3.4vw" }}>Same fact. Two representations.</h1>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5vw", flexGrow: 1, minHeight: 0 }}>
      <div className="panel" style={{ gap: ".8vw" }}>
        <div className="row"><span className="eb">Narrative</span><span className="d" style={{ fontSize: "1.6vw" }}>{STRUCTURED.narrativeUnits} u</span></div>
        <p style={{ margin: 0, fontSize: "1.5vw", lineHeight: 1.4, color: "#eaf4ff" }}>{STRUCTURED.narrative}</p>
      </div>
      <div className="panel" style={{ gap: ".8vw" }}>
        <div className="row"><span className="eb">Structured</span><span className="d" style={{ fontSize: "1.6vw" }}>{STRUCTURED.structuredUnits} u</span></div>
        <pre style={{ margin: 0, fontSize: "1.7vw", lineHeight: 1.45, color: "#9aff36", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", whiteSpace: "pre-wrap" }}>{JSON.stringify(STRUCTURED.structured, null, 2)}</pre>
        <span className="m" style={{ fontSize: "1vw" }}>The constraint survives compression because it is a field, not a phrase.</span>
      </div>
    </div>
    <PollBars view={view} />
  </>;
}

function Pipeline({ view }: { view: DisplayView }) {
  const p = view.state.policy;
  const stages: [string, boolean][] = [["PERMISSION", p.permissionFilter], ["SCOPE", p.projectScope], ["TRUST", p.trustFilter], ["RETRIEVAL", p.retrievalEnabled], ["RELEVANCE / AGE / AUTHORITY", true], ["COMPRESSION", p.summarization], ["CONTEXT BUDGET", true]];
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3vw", flexGrow: 1, alignItems: "center" }}>
    <div className="stack" style={{ gap: "2vh" }}>
      <div className="eb">The pipeline</div>
      <h1 className="d" style={{ fontSize: "4.2vw" }}>Almost everything we did happened before the model generated a word.</h1>
      <div style={{ fontSize: "1.6vw", color: "#eaf4ff", lineHeight: 1.3 }}>Context engineering is how we choose and maintain the information available to an assistant as it works.</div>
    </div>
    <div className="pipe">
      <div style={{ display: "flex", gap: ".6vw", marginBottom: ".4vw" }}>{["Conversation", "Files", "Memory", "Connectors", "Tools", "Databases"].map((x) => <span key={x} className="src">{x}</span>)}</div>
      <span className="arrow">▼</span>
      {stages.map(([l, on]) => <div key={l} style={{ display: "contents" }}><span className={"box " + (on ? "on" : "off")}>{l}</span><span className="arrow">▼</span></div>)}
      <span className="box" style={{ background: "#fff", color: "#1c403e" }}>MODEL</span>
    </div>
  </div>;
}

function Sources({ view, blend }: { view: DisplayView; blend: boolean }) {
  const list = blend ? BLEND_SOURCES : BUY_SOURCES; const n = Math.max(1, view.participants);
  const s = view.state;
  const retrieved = Object.values(s.items).filter((i) => i.state === "active" && i.id !== "SYS-001");
  // Same majority rule as RETRIEVE FOR CURRENT QUESTION, so the counter agrees with what retrieval will use.
  const tools = blend ? blendToolUnits(list.filter((x) => (view.sourceTallies[x] ?? 0) * 2 >= n)) : undefined;
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2.5vw", flexGrow: 1, alignItems: "start" }}>
    <div className="stack" style={{ gap: "1.5vh" }}>
      <h1 className="d" style={{ fontSize: "3.6vw" }}>{blend ? "Which sources should the assistant reach into?" : "Which sources should this assistant be allowed to use for Atlas?"}</h1>
      <div className="stack" style={{ gap: ".7vw" }}>{list.map((x) => { const pct = Math.round(((view.sourceTallies[x] ?? 0) / n) * 100); return <div key={x} className="vote"><span>{x}</span><span className="n">{pct}%</span><span className="trk"><i style={{ width: `${pct}%` }} /></span></div>; })}</div>
      {tools && <div className="panel" style={{ gap: ".4vw", padding: "1vw 1.4vw" }}>
        <div className="row"><span className="eb">Tool descriptions in the window</span><span className="d" style={{ fontSize: "2.4vw", color: "#9aff36" }}>{tools.units} u</span></div>
        <span style={{ fontSize: "1vw", color: "#c7dad7" }}>{tools.tools} of {BLEND_TOOL_COUNT} tools on by majority. Each tool's description enters the window before a single record is retrieved.</span>
      </div>}
    </div>
    {blend ? <div className="panel" style={{ minHeight: "50vh" }}>
      <div className="row"><span className="eb">Retrieved for current question</span><span className="m" style={{ fontSize: ".9vw" }}>{retrieved.length} records · top-k {s.policy.topK} · min relevance {s.policy.minRelevance}</span></div>
      {retrieved.length === 0 && <span style={{ fontSize: "1.3vw", color: "#c7dad7" }}>Enabling a source does not copy it into the window. Press RETRIEVE FOR CURRENT QUESTION.</span>}
      {retrieved.map((i) => <Card key={i.id} it={i} xray={true} />)}
      <div style={{ flexGrow: 1 }} /><div className="d" style={{ fontSize: "1.5vw", color: "#eaf4ff" }}>A connector expands the information environment. It does not expand the model's attention infinitely.</div>
    </div> : <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.2vw" }}>
      <div className="panel" style={{ fontSize: "1.4vw", gap: ".5vw" }}><span className="d" style={{ fontSize: "2vw", color: "#9aff36" }}>You</span><span>conversation</span><span>files</span><span>instructions</span><span>memory preferences</span></div>
      <div className="panel" style={{ fontSize: "1.4vw", gap: ".5vw", background: "#fff", color: "#1c403e" }}><span className="d" style={{ fontSize: "2vw" }}>Vendor</span><span>context assembly</span><span>truncation</span><span>retrieval implementation</span><span>model routing</span><span>internal summarization</span></div>
      <div className="d" style={{ gridColumn: "1 / -1", fontSize: "1.6vw", color: "#eaf4ff" }}>Buying does not eliminate context engineering. It changes who operates which controls.</div>
    </div>}
  </div>;
}

function Final({ view, inspector }: { view: DisplayView; inspector: boolean }) {
  const s = view.state; const run = s.showResponse ? s.runs[s.runs.length - 1] : undefined;
  if (run) return <>
    <Response view={view} inspector={inspector} />
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5vw" }}>
      <div className="panel" style={{ alignItems: "center", padding: "1.2vw" }}><span className="eb">Model</span><span className="d" style={{ fontSize: "4vw" }}>Unchanged</span></div>
      <div className="panel" style={{ alignItems: "center", padding: "1.2vw", background: "#9aff36", color: "#1c403e" }}><span className="eb" style={{ color: "#1c403e" }}>Context</span><span className="d" style={{ fontSize: "4vw" }}>Engineered</span></div>
    </div>
  </>;
  return <ContextStage view={view} xray={inspector} />;
}

type CardState = ContextItem["state"];
const STATE_STYLE: Record<CardState, { label: string; bg: string; fg: string }> = {
  available: { label: "available", bg: "rgba(235,245,255,.06)", fg: "#95a6a2" },
  active: { label: "active", bg: "#9aff36", fg: "#1c403e" },
  compressed: { label: "compressed", bg: "#64dc7b", fg: "#1c403e" },
  evicted: { label: "evicted", bg: "#5c1a14", fg: "#ffb3ab" },
  quarantined: { label: "quarantined", bg: "#5a3d00", fg: "#ffd58a" },
};

/**
 * Plays the session's event log back on the server's replay clock (shared/src/replay.ts), so play, pause and jump on the
 * console move every display together: phases, card lifecycle, runs and counters, with crowd runs as one line each.
 */
function Replay({ view }: { view: DisplayView }) {
  const s = view.state;
  const clock = s.replayClock;
  const [events, setEvents] = useState<EventLogEntry[] | null>(null);
  // Turning replay on again cuts the log afresh, so the display fetches it again.
  useEffect(() => {
    if (!clock) return;
    setEvents(null);
    fetch("api/events").then((r) => r.json()).then((e: EventLogEntry[]) => setEvents(replayEvents(e, clock))).catch(() => setEvents([]));
  }, [clock?.until, clock?.count]);
  const timeline = useMemo(() => events ? replayTimeline(events) : undefined, [events]);
  const pos = useReplayPosition(clock, view.serverNow);
  if (!events || !timeline || !clock) return <div className="m" style={{ fontSize: "1.4vw" }}>Loading the event log…</div>;
  const revealed = replayRevealed(timeline, pos, events.length);
  const seen = events.slice(0, revealed);
  const lines = timeline.frames.filter((f) => f.start < revealed).slice(-9).map((f) => replayLine(events, f, revealed));
  const { cards: tallyCards, moves, phase, phases: phaseSet, joins, runs, lastRun, evictions, summaries, retrievals } = replayTally(events, revealed);
  const cardState: Record<string, CardState> = Object.fromEntries(Object.entries(tallyCards).filter(([id]) => s.items[id]));
  const done = pos >= timeline.durationMs;
  const cards = Object.values(s.items).filter((c) => !c.id.startsWith("TEXT-"));
  return <>
    <div className="row"><h1 className="d" style={{ fontSize: "3vw" }}>{done ? "What this room did" : "Replaying the room"}</h1><span className="eb">{mmss(pos)} / {mmss(timeline.durationMs)} · {phase}{clock.startedAt === undefined && !done ? " · paused" : ""}</span></div>
    <div style={{ display: "flex", gap: ".3vw", flexWrap: "wrap" }}>{PRESET_ORDER.map((p) => <span key={p.phase} className="src" style={phaseSet.has(p.name) || p.name === phase ? { background: "#9aff36", color: "#1c403e", borderColor: "#9aff36" } : undefined}>{p.code} {p.name}</span>)}</div>
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", gap: "1.5vw", flexGrow: 1, minHeight: 0 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: ".6vw", alignContent: "start" }}>
        {cards.map((c) => { const st = cardState[c.id] ?? "available"; const sty = STATE_STYLE[st]; return <div key={c.id} style={{ background: sty.bg, color: sty.fg, borderRadius: ".6vw", padding: ".6vw .8vw", display: "flex", flexDirection: "column", gap: ".2vw", transition: "background .3s" }}>
          <span style={{ fontFamily: "var(--display)", fontSize: "1vw" }}>{c.title}</span>
          <span style={{ fontSize: ".75vw", opacity: .85 }}>{sty.label}{moves[c.id] ? ` · ${moves[c.id]} moves` : ""}</span>
        </div>; })}
      </div>
      <div className="stack" style={{ gap: ".8vw", minHeight: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: ".6vw" }}>
          {([["joined", joins], ["assistant runs", runs], ["evictions", evictions], ["summaries", summaries], ["retrievals", retrievals], ["events", seen.length]] as [string, number][]).map(([l, n]) => <div key={l} className="panel" style={{ padding: ".6vw .8vw", gap: ".1vw" }}><span className="d" style={{ fontSize: "2.2vw" }}>{n}</span><span className="m" style={{ fontSize: ".75vw", textTransform: "uppercase", letterSpacing: ".06em" }}>{l}</span></div>)}
        </div>
        {lastRun && <div className="panel" style={{ padding: ".6vw .9vw" }}><span className="eb" style={{ fontSize: ".8vw" }}>Latest assistant run</span><span style={{ fontSize: "1vw" }}>{lastRun}</span></div>}
        <div className="panel" style={{ flexGrow: 1, minHeight: 0, overflow: "hidden", gap: ".2vw" }}>
          <span className="eb" style={{ fontSize: ".8vw" }}>Event log</span>
          {lines.map((e, k) => <div key={k} style={{ fontSize: ".85vw", color: "#eaf4ff", display: "grid", gridTemplateColumns: "5vw 9vw minmax(0,1fr)", gap: ".6vw" }}><span style={{ color: "#b7cac7" }}>{e.at.slice(11, 19)}</span><span style={{ color: "#9aff36" }}>{e.type}</span><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.detail}</span></div>)}
        </div>
      </div>
    </div>
    <div className="meter" style={{ height: ".6vw" }}><i style={{ width: `${timeline.durationMs ? (pos / timeline.durationMs) * 100 : 100}%` }} /></div>
  </>;
}

const PRESET_ORDER = Object.values(PRESET_BY_PHASE).sort((a, b) => a.code.localeCompare(b.code));

function Close({ view }: { view: DisplayView }) {
  const st = view.state.stats;
  const rows: [string, number][] = [["participants", view.participants], ["context decisions", st.decisions], ["evictions", st.evictions], ["summaries", st.summaries], ["retrievals", st.retrievals], ["information sources", 8], ["model", 1]];
  return <>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2vw" }}>
      <div className="panel" style={{ padding: "2.4vw 2.8vw" }}><span className="eb">Model</span><span className="d" style={{ fontSize: "7vw" }}>Unchanged</span></div>
      <div className="panel" style={{ padding: "2.4vw 2.8vw", background: "#9aff36", color: "#1c403e" }}><span className="eb" style={{ color: "#1c403e" }}>Context</span><span className="d" style={{ fontSize: "7vw" }}>Engineered</span></div>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0,1fr))", gap: "1.2vw", paddingTop: "1vh" }}>{rows.map(([l, n]) => <div key={l} className="stat"><span className="n" style={l === "model" ? { color: "#9aff36" } : undefined}>{n}</span><span className="l">{l}</span></div>)}</div>
    <div style={{ flexGrow: 1 }} />
    <div className="d" style={{ fontSize: "3vw", maxWidth: "75vw", color: "#eaf4ff" }}>Context engineering is how we choose and maintain the information available to an assistant as it works.</div>
  </>;
}
