import { useEffect, useMemo, useState } from "react";
import type { ControlView, ItemState, Policy, Renderer, SessionState, SpeakerCommand } from "@ctx/shared";
import { PRESETS, PHASES, ACTIVITY_PHASES, QUESTIONS, RUN_SHEET, unitsFor, talkPartFor, talkPartAt, TALK_MINUTES } from "@ctx/shared";
import { useSession, speakerKey } from "../ws";
import { Meter, mmss, useReplayPosition } from "../components/ui";

/** The part clock turns yellow this long before the part's slot runs out, and red once it has. */
const WARN_MS = 30_000;
const TALK_MS = TALK_MINUTES * 60_000;

/** Replay playhead and jumps. The playhead runs on the server's clock, so these move every display at once. */
function ReplayControls({ clock, serverNow, send }: { clock: NonNullable<SessionState["replayClock"]>; serverNow: number; send: (cmd: SpeakerCommand) => unknown }) {
  const pos = useReplayPosition(clock, serverNow);
  const ended = pos >= clock.durationMs;
  const playing = clock.startedAt !== undefined && !ended;
  const at = clock.chapters.filter((c) => c.atMs <= pos).pop();
  const seek = (ms: number) => send({ type: "replay.seek", ms });
  return <div className="replay-ctl">
    <span className="stage-row"><span>Replay {mmss(pos)} / {mmss(clock.durationMs)}{at ? ` · ${at.code} ${at.name}` : ""}</span>
      <span className="clock-btns">
        <button className={"mini" + (playing ? "" : " on")} onClick={() => send({ type: playing ? "replay.pause" : "replay.play" })}>{playing ? "Pause" : ended ? "Play again" : "Play"}</button>
        <button className="mini" onClick={() => seek(0)}>Restart</button>
        <button className="mini" onClick={() => seek(pos - 5000)}>−5 s</button>
        <button className="mini" onClick={() => seek(pos + 5000)}>+5 s</button>
        <button className="mini" onClick={() => seek(clock.durationMs)}>End</button>
      </span>
    </span>
    {clock.chapters.length > 0 && <span className="clock-btns" aria-label="Jump to phase">{clock.chapters.map((c, k) => <button key={k} className={"mini" + (c === at ? " on" : "")} title={c.name} onClick={() => seek(c.atMs)}>{c.code}</button>)}</span>}
  </div>;
}

/**
 * Talk clock. The large figure counts down the current part's slot from the moment the speaker entered the part (the
 * server marks it, from the preset or the slide on the display); the small one counts the whole talk up to 40:00.
 */
function TalkClock({ state, slideName, serverNow, send }: { state: SessionState; slideName?: string; serverNow: number; send: (cmd: SpeakerCommand) => unknown }) {
  const { timer } = state;
  const running = timer.startedAt !== undefined;
  // Elapsed as of the latest snapshot, by the server's clock; counted on from there with this tab's monotonic clock,
  // so neither a skewed nor a jumping laptop clock moves it.
  const base = useMemo(() => ({ ms: timer.elapsedMs + (running ? serverNow - timer.startedAt! : 0), at: performance.now() }), [serverNow, running, timer.elapsedMs, timer.startedAt]);
  const [, tick] = useState(0);
  useEffect(() => { if (!running) return; const t = window.setInterval(() => tick((n) => n + 1), 250); return () => window.clearInterval(t); }, [running]);
  const elapsed = base.ms + (running ? performance.now() - base.at : 0);
  const part = timer.partIndex !== undefined ? talkPartAt(timer.partIndex) : talkPartFor(state.phase, state.activityReturn, slideName ? parseInt(slideName, 10) : undefined);
  const slotMs = (part.end - part.start) * 60_000;
  const left = slotMs - (elapsed - (timer.partMarks?.[part.index] ?? 0));
  const tone = left <= 0 ? "red" : left <= WARN_MS ? "yellow" : "green";
  const reset = () => { if (elapsed === 0 || window.confirm("Reset the talk clock to 0:00?")) send({ type: "timer.reset" }); };
  const partTime = left > 0 ? mmss(left) : `+${mmss(-left)}`;
  return <div className={"clock " + tone} role="timer" aria-label={`${part.label}: ${left > 0 ? `${partTime} left` : `${mmss(-left)} over`}. Talk ${mmss(elapsed)} of ${mmss(TALK_MS)}`}>
    <span className="clock-t">{partTime}</span>
    <span className="clock-side">
      <span className="clock-part">{part.label} · {mmss(slotMs)} slot{left <= 0 ? " · over" : ""}</span>
      <span className={"clock-total" + (elapsed >= TALK_MS ? " over" : "")}>Talk {mmss(elapsed)} / {mmss(TALK_MS)} · mark {mmss(part.start * 60_000)}{!running && elapsed === 0 ? " · not started" : !running ? " · paused" : ""}</span>
      <span className="clock-btns">
        <button className={"mini" + (running ? "" : " on")} onClick={() => send({ type: running ? "timer.pause" : "timer.start" })}>{running ? "Pause" : elapsed > 0 ? "Resume" : "Start"}</button>
        <button className="mini" onClick={reset}>Reset</button>
      </span>
    </span>
  </div>;
}

const KEYS: [string, string][] = [["← / →", "run sheet back / next step"], ["[ / ]", "prev / next phase"], ["V", "x-ray"], ["R", "reset phase"], ["F", "freeze"], ["L", "load expected"], ["T", "clock start / pause"], ["S", "slides on/off"], ["Z / X", "prev / next slide"], ["P", "live view"]];

export function Console() {
  const { view, status, send, error } = useSession<ControlView>("control");
  const [busy, setBusy] = useState(false);
  const [simCount, setSimCount] = useState(100);
  useEffect(() => { document.querySelector(".thumb.on")?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [view?.state.slide]);
  useEffect(() => { document.querySelector(".preset.on")?.scrollIntoView({ block: "nearest" }); }, [view?.state.phase]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Typing in a field, or arrowing through the renderer radios, is not a hotkey. A switch (checkbox) is fine: it only answers Space.
      const t = e.target as HTMLInputElement | null;
      if (t?.tagName === "INPUT" && t.type !== "checkbox") return;
      // Leave the browser's own shortcuts alone (Cmd+[ is Back, Cmd+Z undo). No Escape either: it leaves full screen.
      if (!view || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const live = view.state.slide === undefined;
      // From the live view, S, Z and X pick up at the last slide that was up, which the server keeps across a reload.
      const lastSlide = view.state.lastSlide ?? 0;
      const step = (delta: number) => send(live ? { type: "slide.set", index: Math.max(0, lastSlide + delta) } : { type: "slide.step", delta });
      if (k === "arrowright") { e.preventDefault(); send({ type: "run.next" }); }
      if (k === "arrowleft") { e.preventDefault(); send({ type: "run.back" }); }
      if (k === "]") send({ type: "advance" });
      if (k === "[") send({ type: "back" });
      if (k === "v") send({ type: "xray.set", on: !view.state.xray });
      if (k === "r") send({ type: "reset" });
      if (k === "f") send({ type: "freeze.set", frozen: !view.state.frozen });
      if (k === "l") send({ type: "loadExpected" });
      if (k === "t") send({ type: view.state.timer.startedAt === undefined ? "timer.start" : "timer.pause" });
      if (k === "s") send(live ? { type: "slide.set", index: lastSlide } : { type: "slide.set", index: null });
      if (k === "x") step(1);
      if (k === "z") step(-1);
      if (k === "p" && !live) send({ type: "slide.set", index: null });
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [view, send]);

  if (status === "unauthorized") return <div className="console"><p>Unauthorized. Open this page with <code>?key=YOUR_SPEAKER_KEY</code> (see .env).</p></div>;
  if (!view) return <div className="console"><p className="m">Connecting…</p></div>;
  const s = view.state;
  const pol = (patch: Partial<Policy>) => send({ type: "policy.set", patch });
  const run = async (force?: "good" | "bad") => { setBusy(true); try { await send({ type: "assistant.run", force }); } finally { setBusy(false); } };
  const items = Object.values(s.items);
  const inWindow = items.filter((i) => i.state === "active" || i.state === "compressed").sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.contextUnits - a.contextUnits);
  const outside = items.filter((i) => !(i.state === "active" || i.state === "compressed"));
  // Same figure as the display and phones: cards that passed every filter, summarized ones at summary size.
  const used = view.assembly.demandedUnits;
  const last = s.runs[s.runs.length - 1];
  const phaseIdx = PHASES.indexOf(s.phase);
  const left = view.participantList.filter((p) => p.left).length;
  // Plain render helpers, not components: a component declared inside render remounts on every update and drops input focus.
  const toggle = (label: string, checked: boolean, onChange: (on: boolean) => void) => <label key={label} className="stage-row"><span>{label}</span><input type="checkbox" className="sw" checked={checked} onChange={(e) => onChange(e.target.checked)} /></label>;
  const number = (label: string, value: number, onChange: (n: number) => void, step = 1) => <label key={label} className="stage-row"><span>{label}</span><input type="number" className="num" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} /></label>;
  const sw = (k: keyof Policy, label: string) => toggle(label, !!s.policy[k], (on) => pol({ [k]: on } as Partial<Policy>));
  const num = (k: keyof Policy, label: string, step = 1) => number(label, Number(s.policy[k]), (n) => pol({ [k]: n } as Partial<Policy>), step);
  const stateBtn = (id: string, st: ItemState, label: string, cur: ItemState) => <button key={st} className={"mini" + (cur === st ? " on" : "")} onClick={() => send({ type: "item.set", itemId: id, state: st })}>{label}</button>;
  // Run sheet: the step just done, and the one the right arrow does next.
  const stepIdx = s.runStep;
  const curStep = stepIdx !== undefined ? RUN_SHEET[stepIdx] : undefined;
  const nextStep = RUN_SHEET[(stepIdx ?? -1) + 1];
  const prevStep = stepIdx !== undefined && stepIdx > 0 ? RUN_SHEET[stepIdx - 1] : undefined;
  const preset = (p: (typeof PRESETS)[number], i: number, done: boolean) => <button key={p.phase} className={"preset" + (p.phase === s.phase ? " on" : done && i < phaseIdx ? " done" : "")} aria-current={p.phase === s.phase} onClick={() => send({ type: "preset", phase: p.phase })}><span className="n">{p.code}</span>{p.name}</button>;

  return <div className="console speaker">
    <header className="con-head">
      <div className="con-title">
        <span className="d">Speaker console</span>
        <span className="m"><i className={"dot" + (status === "open" ? " ok" : "")} /> session {s.id} · v{s.version} · {status}</span>
      </div>
      <TalkClock state={s} slideName={s.slide !== undefined ? view.slides[s.slide] : undefined} serverNow={view.serverNow} send={send} />
      <div className="con-status">
        <span className="stat"><strong>{view.participants}</strong> participants{left ? <span className="m"> · {left} left</span> : null}</span>
        <span className="stat"><strong>{view.rolesAssigned}</strong> roles</span>
        {view.parked > 0 && <button className="mini on" onClick={() => send({ type: "parked.release" })}>{view.parked} waiting in lobby · admit now</button>}
        {s.slide !== undefined && <span className="chip lime">slide {s.slide + 1}/{view.slides.length} on display</span>}
        {s.endedAt && <span className="chip lime">session ended · names deleted</span>}
        {s.exportFile && <a className="mini on link" href={`api/export/${s.exportFile}?key=${encodeURIComponent(speakerKey())}`}>Download export</a>}
        <i className="sep" />
        <label className="tog">Registration <input type="checkbox" className="sw" checked={s.registrationOpen} onChange={(e) => send({ type: "registration.set", open: e.target.checked })} /></label>
        <label className="tog">X-ray <input type="checkbox" className="sw" checked={s.xray} onChange={(e) => send({ type: "xray.set", on: e.target.checked })} /></label>
      </div>
    </header>

    <div className="grid2">
      <div className="col">
        <div className="pane">
          <div className="pane-h"><span className="eb">Slides</span><span className="m">{view.slides.length === 0 ? "none" : s.slide !== undefined ? `${s.slide + 1} / ${view.slides.length} on display` : `${view.slides.length} ready · display is live`}</span></div>
          {view.slides.length === 0 ? <span className="m">Drop PNG files into the slides/ folder (ordered by file name). They show up here without a restart.</span> : <>
            <div className="strip">{view.slides.map((n, i) => <button key={n} className={"thumb" + (i === s.slide ? " on" : "")} title={n} onClick={() => send({ type: "slide.set", index: i })}><img src={`slides/${encodeURIComponent(n)}`} alt="" loading="lazy" /><span>{i + 1}</span></button>)}</div>
            <div className="btn-row">
              <button className="btn sec sm" disabled={!s.slide} onClick={() => send({ type: "slide.step", delta: -1 })}>◀ Prev</button>
              <button className="btn sec sm grow" disabled={s.slide !== undefined && s.slide >= view.slides.length - 1} onClick={() => send(s.slide === undefined ? { type: "slide.set", index: s.lastSlide ?? 0 } : { type: "slide.step", delta: 1 })}>{s.slide === undefined ? "Show slides ▶" : "Next ▶"}</button>
              <button className={"btn sm" + (s.slide === undefined ? " sec" : "")} disabled={s.slide === undefined} onClick={() => send({ type: "slide.set", index: null })}>Live view</button>
            </div>
          </>}
        </div>
        <div className="pane">
          <div className="pane-h"><span className="eb">Active context</span><span className={"m" + (used > s.budget ? " bad" : "")}>{used} / {s.budget} units{used > s.budget ? ` · ${used - s.budget} over` : ""}</span></div>
          <Meter used={used} budget={s.budget} />
          <div className="acts">
            {["ATLAS-005", "ATLAS-010", "ATLAS-009", "PRIVATE-001", "APOLLO-001"].map((id) => s.items[id] && s.items[id].state !== "active" && <button key={id} className="mini" onClick={() => send({ type: "item.inject", itemId: id })}>Inject {id}</button>)}
            {s.items["ATLAS-002"]?.state !== "evicted" && <button className="mini" onClick={() => send({ type: "item.set", itemId: "ATLAS-002", state: "evicted" })}>Evict contract</button>}
            {s.phase === "retrieval" && <><button className="mini on" onClick={() => send({ type: "retrieve.topk" })}>Retrieve top-k</button><button className="mini on" onClick={() => send({ type: "retrieve.voted" })}>Admit audience pick</button></>}
            {s.phase === "blend" && <button className="mini on" onClick={() => send({ type: "retrieve.blend" })}>Retrieve for current question</button>}
            {s.phase === "routing" && (["deploy", "color"] as const).map((k) => <button key={k} className={"mini" + (s.questionKey === k ? " on" : "")} title={QUESTIONS[k]} onClick={() => send({ type: "question.set", key: k })}>Question: {k}</button>)}
            {s.activePollId && <button className="mini" onClick={() => send(s.polls[s.activePollId!].open ? { type: "poll.close" } : { type: "poll.open", pollId: s.activePollId! })}>{s.polls[s.activePollId].open ? "Close poll" : "Reopen poll"}</button>}
          </div>
          <div className="items">
            {inWindow.length === 0 && <span className="empty">Nothing in the window.</span>}
            {inWindow.map((i) => <div key={i.id} className={"irow" + (i.trust === "untrusted" || i.sensitivity === "private" ? " bad" : i.tags.includes("wrong-scope") || i.tags.includes("stale") ? " warn" : "")}>
              <span className="id">{i.id}</span><span>{i.title}{i.submittedBy ? <span className="m"> · {i.submittedBy}</span> : null}</span><span className="u">{unitsFor(i, i.state === "compressed")}</span>
              <span className="btns">
                <button className={"mini" + (i.pinned ? " on" : "")} onClick={() => send({ type: "item.pin", itemId: i.id, pinned: !i.pinned })}>Pin</button>
                {stateBtn(i.id, "compressed", "Sum", i.state)}{i.driftSummary && <button className={"mini" + (i.corrupted ? " red" : "")} title={`Drifted summary: ${i.driftSummary}`} onClick={() => send({ type: "item.corrupt", itemId: i.id, corrupted: !i.corrupted })}>{i.corrupted ? "Drifted" : "Drift"}</button>}{stateBtn(i.id, "active", "Full", i.state)}{stateBtn(i.id, "quarantined", "Quar", i.state)}{stateBtn(i.id, "evicted", "Evict", i.state)}
              </span>
            </div>)}
          </div>
          <details><summary>Outside the window · {outside.length} cards</summary>
            {outside.map((i) => <div key={i.id} className="irow"><span className="id">{i.id}</span><span>{i.title} <span className="m">· {i.state}</span></span><span className="u">{i.contextUnits}</span><span className="btns">{stateBtn(i.id, "active", "Add", i.state)}{stateBtn(i.id, "available", "Avail", i.state)}{stateBtn(i.id, "quarantined", "Quar", i.state)}</span></div>)}
          </details>
        </div>

        <div className="pane">
          <div className="pane-h"><span className="eb">Context policy</span><span className="m">every stage toggles independently</span></div>
          <div className="policy">
            <span className="grp">Pipeline stages</span>
            {sw("permissionFilter", "Permission / privacy filter")}{sw("projectScope", "Strict project scope")}{sw("trustFilter", "Trust · untrusted is data")}{sw("retrievalEnabled", "Retrieval")}
            {sw("summarization", "Auto summarization")}{sw("useAudienceVotes", "Audience votes as signal")}{sw("buildControls", "Build-mode controls")}
            <span className="grp">Budgets and retrieval</span>
            {number("Context budget", s.budget, (n) => send({ type: "budget.set", budget: n }))}
            {number("Solo budget", s.soloBudget, (n) => send({ type: "soloBudget.set", budget: n }))}
            {num("topK", "Retrieval top-k")}{num("minRelevance", "Min relevance", 0.01)}{num("summaryThreshold", "Summary threshold", 0.05)}
            <span className="grp">Ranking weights</span>
            {num("recencyWeight", "Recency weight", 0.05)}{num("authorityWeight", "Authority weight", 0.05)}{num("audienceWeight", "Audience weight", 0.05)}{num("relevanceWeight", "Relevance weight", 0.05)}
            <span className="grp">Room and display</span>
            {toggle("Voting open", s.votingOpen, (open) => send({ type: "voting.set", open }))}
            {toggle("Participant submission", s.submissionOpen, (open) => send({ type: "submission.set", open }))}
            {toggle("Replay event log on display", s.replay, (on) => send({ type: "replay.set", on }))}
            {s.replay && s.replayClock && <ReplayControls clock={s.replayClock} serverNow={view.serverNow} send={send} />}
            {toggle("Show response on display", s.showResponse, (on) => send({ type: "showResponse.set", on }))}
          </div>
        </div>

        <div className="pane fill">
          <div className="pane-h"><span className="eb">Staging · free text · {s.staging.length} waiting</span><span className="m">nothing here reaches the model until promoted</span></div>
          {s.staging.length === 0 && <span className="empty">No submissions waiting.</span>}
          {s.staging.slice(-6).reverse().map((t) => <div key={t.id} className="irow stg"><span className="id">{t.participant}</span><span>“{t.text}”</span><span className="btns"><button className="mini on" onClick={() => send({ type: "staging.promote", id: t.id })}>Promote</button><button className="mini" onClick={() => send({ type: "staging.discard", id: t.id })}>Discard</button></span></div>)}
        </div>
      </div>

      <div className="col">
        <div className="pane rail">
          <div className="presets">
            <span className="eb">Phase presets</span>
            {PRESETS.filter((p) => !ACTIVITY_PHASES.includes(p.phase)).map((p, i) => preset(p, i, true))}
            <span className="eb">Activities · Advance returns</span>
            {PRESETS.filter((p) => ACTIVITY_PHASES.includes(p.phase)).map((p, i) => preset(p, i, false))}
          </div>
          <div className="rail-foot">
            {PRESETS[phaseIdx]?.lesson && <span className="m">{PRESETS[phaseIdx].lesson}</span>}
            <button className="btn sec sm" onClick={() => send({ type: "roles.assign" })}>Assign secret roles</button>
            <div className="sim">
              <input type="number" className="num" value={simCount} onChange={(e) => setSimCount(Number(e.target.value))} aria-label="Simulated participants" />
              <button className="btn sec sm" onClick={() => send({ type: "simulate", count: simCount })}>Simulate</button>
              <button className="btn sec sm" onClick={() => send({ type: "simulate.clear" })} title="Remove simulated participants">Clear</button>
            </div>
            <button className="btn sm danger" onClick={() => { if (window.confirm("Reset the session? This removes every participant (real and simulated), deletes names, resets phase, policy and cards, and reopens registration. Export files on disk are kept.")) send({ type: "session.reset" }); }}>Reset session · fresh room</button>
          </div>
        </div>
        <div className="pane">
          <div className="pane-h"><span className="eb">Assistant renderer</span><span className="m"><i className={"dot" + (view.llmStatus === "ok" ? " ok" : "")} /> model API {view.llmStatus}{last ? ` · ${last.latencyMs} ms` : ""}{view.fallbackActive ? " · fallback active" : ""}</span></div>
          {(["deterministic", "live", "live-fallback"] as Renderer[]).map((r) => <label key={r} className="radio"><input type="radio" name="r" checked={s.renderer === r} onChange={() => send({ type: "renderer.set", renderer: r })} /> {r === "deterministic" ? "Deterministic" : r === "live" ? "Live model" : "Live model, deterministic fallback"}</label>)}
          <button className="btn" disabled={busy} onClick={() => run()}>{busy ? "Running…" : "Invoke assistant"}</button>
          <div className="btn-row"><button className="btn sec sm grow" onClick={() => run("good")}>Force good</button><button className="btn sec sm grow" onClick={() => run("bad")}>Force bad</button></div>
        </div>
        <div className="pane">
          <div className="pane-h"><span className="eb">Last run{last ? ` · #${last.id}` : ""}</span>{last && <span className={"res " + (last.eval.pass ? "ok" : "bad")}>eval {last.eval.pass ? "PASS" : "FAIL"}</span>}</div>
          {last ? <>
            <span className="run-text">{last.text}</span>
            <span className="m">{last.outcome.toUpperCase()} · {last.renderer}{last.fallbackUsed ? " (fallback)" : ""}{last.forced ? ` · forced ${last.forced}` : ""} · {last.assembly.usedUnits}/{last.assembly.budget}u</span>
            <details><summary>Why did the assistant see this?</summary>
              {last.assembly.traces.map((t) => <div key={t.id} className="trace"><strong>{t.id}</strong> <span className={t.result === "INCLUDED" || t.result === "COMPRESSED" ? "ok" : "bad"}>{t.result}</span> · {t.checks.map((c) => (c.ok ? "✓ " : "✕ ") + c.label).join(" · ")}</div>)}
            </details>
          </> : <span className="empty">No run yet.</span>}
        </div>
        <div className="pane fill">
          <span className="eb">Recent events</span>
          <div className="log">{[...s.events].reverse().slice(0, 40).map((e, i) => <div key={i}>{e.at.slice(11, 19)} <strong>{e.type}</strong> {e.detail}</div>)}</div>
        </div>
      </div>
    </div>

    <div className="runsheet" aria-label="Run sheet">
      <button className="rs" disabled={!prevStep} title="← back one step: reloads the preset and redoes the steps since" onClick={() => send({ type: "run.back" })}>◀ {prevStep ? `${stepIdx} ${prevStep.label}` : "start"}</button>
      <span className="rs cur">{curStep ? <><span className="m">{curStep.part} · step {stepIdx! + 1} / {RUN_SHEET.length} · </span>{curStep.label}</> : <span className="m">Run sheet · {RUN_SHEET.length} steps · → does the first</span>}</span>
      <button className="rs next" disabled={!nextStep} title="→ next step" onClick={() => send({ type: "run.next" })}>{nextStep ? `${(stepIdx ?? -1) + 2} ${nextStep.label}` : "end of the run sheet · End session is below"} ▶</button>
    </div>
    <div className="embar">
      <button className={"em" + (s.frozen ? " lime" : "")} onClick={() => send({ type: "freeze.set", frozen: !s.frozen })}>{s.frozen ? "Unfreeze audience" : "Freeze audience"}</button>
      <button className="em lime" onClick={() => send({ type: "loadExpected" })}>Load expected state</button>
      <button className="em" onClick={() => run("good")}>Force good answer</button>
      <button className="em" onClick={() => run("bad")}>Force bad answer</button>
      <button className="em red" onClick={() => send({ type: "renderer.set", renderer: "deterministic" })}>Disable live model</button>
      <button className="em" onClick={() => send({ type: "reset" })}>Reset phase</button>
      {s.endedAt && <button className="em red" onClick={() => { if (window.confirm("Start a fresh room? Removes every participant, resets phase, policy and cards, and reopens registration.")) send({ type: "session.reset" }); }}>Reset session</button>}
      {!s.endedAt && <button className="em red" onClick={() => { if (window.confirm("End the session? This writes the export file, closes registration and deletes every participant name. Aggregates and the export are kept.")) send({ type: "session.end" }); }}>End session</button>}
      <button className="em adv" onClick={() => send({ type: "advance" })}>Advance →</button>
    </div>
    <footer className="keys">{KEYS.map(([k, l]) => <span key={k}><kbd>{k}</kbd>{l}</span>)}</footer>
    {error && <div className="toast">{error}</div>}
  </div>;
}
