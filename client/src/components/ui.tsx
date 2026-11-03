import { useEffect, useMemo, useState } from "react";
import type { ContextItem, SessionState } from "@ctx/shared";
import { unitsFor, buildCards, replayPosition } from "@ctx/shared";

// Card titles for citation chips, so "[ATLAS-006]" reads as "ATLAS-006 · Old Slack conversation".
const CARD_TITLES: Record<string, string> = Object.fromEntries(Object.values(buildCards()).map((c) => [c.id, c.title]));

export function Meter({ used, budget, className }: { used: number; budget: number; className?: string }) {
  const pct = budget > 0 ? Math.min(100, (Math.min(used, budget) / Math.max(used, budget)) * 100) : 0;
  const over = used > budget ? ((used - budget) / used) * 100 : 0;
  return <div className={"meter " + (className ?? "")} role="img" aria-label={`${used} of ${budget} units`}>
    <i style={{ width: `${pct}%` }} /> {over > 0 && <i className="over" style={{ width: `${over}%` }} />}
  </div>;
}

export function Cites({ text }: { text: string }) {
  const parts = text.split(/(\[[A-Z]+-\d{3}\])/g);
  return <>{parts.map((p, i) => /^\[[A-Z]+-\d{3}\]$/.test(p) ? <span key={i} className="cite">{p.slice(1, -1)}{CARD_TITLES[p.slice(1, -1)] ? ` · ${CARD_TITLES[p.slice(1, -1)]}` : ""}</span> : <span key={i}>{p}</span>)}</>;
}

export function ageChip(it: ContextItem) {
  if (it.ageDays > 30) return <span className="chip warn">{it.ageLabel} · stale</span>;
  return <span className="chip">{it.ageLabel}</span>;
}
export function scopeChip(it: ContextItem) {
  if (it.scope.user) return <span className="chip bad">private · {it.scope.user}</span>;
  if (it.scope.project && it.scope.project !== "atlas") return <span className="chip warn">scope: {it.scope.project}</span>;
  if (it.scope.project) return <span className="chip">scope: Atlas</span>;
  if (it.scope.organization) return <span className="chip">scope: org</span>;
  return <span className="chip">scope: session</span>;
}
export function trustChip(it: ContextItem) {
  if (it.trust === "untrusted") return <span className="chip bad">untrusted</span>;
  return <span className="chip">{it.trust}</span>;
}

export function unitsLabel(it: ContextItem, compressed: boolean) {
  const u = unitsFor(it, compressed);
  return compressed ? <><s style={{ opacity: .6 }}>{it.contextUnits}</s> → {u} u</> : <>{u} u</>;
}

export const mmss = (ms: number) => { const s = Math.floor(Math.max(0, ms) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

/**
 * Replay playhead in ms. Taken from the server's clock at the latest snapshot and counted on with this tab's monotonic
 * clock, so the console and every display agree whatever their own clocks say. Ticks every 50 ms while playing.
 */
export function useReplayPosition(clock: SessionState["replayClock"], serverNow: number): number {
  const playing = clock?.startedAt !== undefined;
  const base = useMemo(() => ({ ms: clock ? replayPosition(clock, serverNow) : 0, at: performance.now() }), [serverNow, clock?.offsetMs, clock?.startedAt, clock?.durationMs]);
  const [, tick] = useState(0);
  const pos = clock ? Math.min(clock.durationMs, base.ms + (playing ? performance.now() - base.at : 0)) : 0;
  const done = !clock || pos >= clock.durationMs;
  useEffect(() => { if (!playing || done) return; const t = window.setInterval(() => tick((n) => n + 1), 50); return () => window.clearInterval(t); }, [playing, done]);
  return pos;
}
