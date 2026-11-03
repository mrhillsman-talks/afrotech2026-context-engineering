import type { ReactNode } from "react";
import type { ControlView, TalkPhase } from "@ctx/shared";
import { PHASES, PRESETS } from "@ctx/shared";
import { useSession } from "../ws";

type Tone = "" | "ok" | "warn" | "bad";
const phaseLabel = (phase: TalkPhase) => { const p = PRESETS.find((x) => x.phase === phase); return p ? `${p.code} ${p.name}` : phase; };

export function Facilitator() {
  const { view, status } = useSession<ControlView>("facilitator");
  if (status === "unauthorized") return <div className="console"><p>Unauthorized. Open this page with <code>?key=YOUR_SPEAKER_KEY</code>.</p></div>;
  if (!view) return <div className="console"><p className="m">Connecting…</p></div>;
  const s = view.state;
  const present = view.participantList.filter((p) => !p.left);
  const real = present.filter((p) => !p.simulated);
  const sims = present.length - real.length;
  const connected = real.filter((p) => p.connected).length;
  // Only a drop among real people is a problem; simulated participants never hold a socket.
  const share = real.length ? connected / real.length : 1;
  const byPhase: Partial<Record<TalkPhase, { real: number; sim: number }>> = {};
  for (const p of present) { const b = (byPhase[p.phaseSeen] ??= { real: 0, sim: 0 }); if (p.simulated) b.sim++; else b.real++; }
  const max = Math.max(1, ...Object.values(byPhase).map((b) => b.real + b.sim));
  const live = status === "open";
  const tile = (value: ReactNode, label: string, tone: Tone = "", sub?: string) => <div key={label} className={"tile " + tone}><span className={"n " + tone}>{value}</span><span className="l">{label}{sub ? <span className="sub"> · {sub}</span> : null}</span></div>;

  return <div className="console facil">
    <header className="con-head">
      <div className="con-title">
        <span className="d">Facilitator view</span>
        <span className="m"><i className={"dot" + (live ? " ok" : "")} /> session {s.id} · v{s.version} · {status} · refreshes every 3 s</span>
      </div>
      <div className="con-status">
        <span className="stat">phase <strong>{phaseLabel(s.phase)}</strong></span>
      </div>
    </header>
    {!live && <div className="alert bad">Reconnecting… the numbers below are from the last update and may be out of date.</div>}

    <div className={"facil-grid" + (live ? "" : " stale")}>
      <div className="facil-main">
        <div className="tiles">
          {tile(<>{connected}<span className="of"> / {real.length}</span></>, "connected", real.length === 0 ? "" : share < 0.5 ? "bad" : share < 0.8 ? "warn" : "ok", sims ? `${sims} simulated` : undefined)}
          {tile(view.duplicates, "duplicate sessions", view.duplicates ? "warn" : "")}
          {tile(<>{view.eventRate}<span className="of">/s</span></>, "event rate")}
          {tile(view.stuck, "stuck clients", view.stuck ? "warn" : "")}
          {tile(view.llmStatus === "ok" ? "OK" : view.llmStatus === "error" ? "ERR" : "Off", "model API", view.llmStatus === "ok" ? "ok" : view.llmStatus === "error" ? "bad" : "")}
          {tile(live ? "Healthy" : status, "websocket", live ? "ok" : "bad")}
          {tile(s.version, "state version")}
          {tile(view.fallbackActive ? "On" : "Off", "fallback", view.fallbackActive ? "warn" : "")}
        </div>
        <div className="pane">
          <div className="pane-h"><span className="eb">Participants by phase seen</span><span className="m"><i className="key real" /> real <i className="key sim" /> simulated</span></div>
          {PHASES.filter((p) => byPhase[p]).map((p) => { const b = byPhase[p]!; return <div key={p} className={"prow" + (p === s.phase ? " cur" : "")}>
            <span className="pl">{phaseLabel(p)}</span>
            <span className="meter" role="img" aria-label={`${b.real} real, ${b.sim} simulated`}><i style={{ width: `${(b.real / max) * 100}%` }} /><i className="sim" style={{ width: `${(b.sim / max) * 100}%` }} /></span>
            <span className="pc">{b.real}{b.sim ? <span className="m"> +{b.sim}</span> : null}</span>
          </div>; })}
          {present.length === 0 && <span className="empty">No participants yet.</span>}
          <span className="m">Clients whose last snapshot is a phase behind get the full state on reconnect. Nothing is reconstructed from missed messages.</span>
        </div>
      </div>
      <div className="pane events">
        <div className="pane-h"><span className="eb">Recent events</span><span className="m">newest first · hover for full text</span></div>
        <div className="log">{[...s.events].reverse().slice(0, 80).map((e, i) => <div key={i} title={`${e.type} ${e.detail}`}>{e.at.slice(11, 19)} <strong>{e.type}</strong> {e.detail}</div>)}</div>
      </div>
    </div>
  </div>;
}
