import { useCallback, useEffect, useRef, useState } from "react";
import type { ControlView } from "@ctx/shared";
import { RUN_SHEET, isSpeakerCmd } from "@ctx/shared";
import { useSession } from "../ws";

/** A note is saved this long after the last keystroke, and at once on blur, Done, or a change of step. */
const SAVE_AFTER_MS = 800;
type Save = "saved" | "unsaved" | "saving" | { error: string };

const KEYS: [string, string][] = [[", / .", "previous / next step's note"], ["Home", "back to the live step"], ["E", "edit this note"], ["⌘ / Ctrl + Enter", "done editing"], ["D", "note only / note and display"], ["- / + / 0", "smaller / larger / default text"]];

/** Note text size in px: the A− and A+ buttons and the - and + keys move it by `step`; 0 goes back to `initial`. */
const SIZE = { min: 40, max: 180, step: 10, initial: 40 };
/** The note's share of the width beside the display, set by dragging the divider or arrowing it while it has focus. */
const SPLIT = { min: 0.2, max: 0.8, step: 0.05, initial: 0.4 };
const clamp = (n: number, { min, max }: { min: number; max: number }) => Math.min(max, Math.max(min, n));
const inRange = (r: { min: number; max: number }) => (s: string) => { const n = Number(s); return s !== "" && Number.isFinite(n) ? clamp(n, r) : undefined; };
const onOff = { parse: (s: string) => s !== "off", format: (v: boolean) => (v ? "on" : "off") };

/** A view setting this browser keeps for next time. The page works without storage (private window, blocked site data). */
function useStored<T>(key: string, initial: T, parse: (s: string) => T | undefined, format: (v: T) => string = String) {
  const [v, setV] = useState<T>(() => {
    try { const s = localStorage.getItem(key); const p = s === null ? undefined : parse(s); return p === undefined ? initial : p; } catch { return initial; }
  });
  useEffect(() => { try { localStorage.setItem(key, format(v)); } catch { /* kept for this page only */ } }, [key, v, format]);
  return [v, setV] as const;
}

/** One paragraph of a note: **lesson lines** bold, *[delivery notes]* in italics, as the spoken script writes them. */
function Inline({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g).map((p, i) =>
    p.length > 4 && p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong>
      : p.length > 2 && p.startsWith("*") && p.endsWith("*") ? <em key={i}>{p.slice(1, -1)}</em>
        : p)}</>;
}

/** The slide file a step puts up, if it puts one up. */
function slideOf(index: number, slides: string[]) {
  const c = RUN_SHEET[index]?.cmds.find((c) => isSpeakerCmd(c) && c.type === "slide.show");
  return c && isSpeakerCmd(c) && c.type === "slide.show" ? slides.find((n) => parseInt(n, 10) === c.number) : undefined;
}

/**
 * Speaker notes beside the display. The left side follows the run-sheet step the console is on (the arrows, a main
 * preset loaded by hand, a slide put up by hand: whatever moves Store.state.runStep); `,` and `.` look at other
 * steps' notes without touching the display, and Home follows the live step again. The right side is the display
 * itself, in a frame, so it shows exactly what the room sees. This view sends no speaker commands.
 */
export function Notes() {
  const { view, status, send, error, notes } = useSession<ControlView>("notes");
  const [browse, setBrowse] = useState<number | null>(null);
  const [showDisplay, setShowDisplay] = useStored("ctx.notes.display", true, onOff.parse, onOff.format);
  const [size, setSize] = useStored("ctx.notes.size", SIZE.initial, inRange(SIZE));
  const [split, setSplit] = useStored("ctx.notes.split", SPLIT.initial, inRange(SPLIT));
  const grid = useRef<HTMLDivElement>(null);
  const resize = useCallback((by: number) => setSize((n) => clamp(n + by * SIZE.step, SIZE)), [setSize]);
  const [draft, setDraft] = useState<{ index: number; text: string } | null>(null);
  const [save, setSave] = useState<Save>("saved");
  const timer = useRef<number>();
  // Refs, so a save fired from a timer or an event handler sees the latest draft, not the one from its render.
  const draftRef = useRef(draft); draftRef.current = draft;
  const sent = useRef(new Map<number, string>());

  const live = view?.state.runStep;
  const liveIdx = live ?? 0;
  const shown = browse ?? liveIdx;
  const readOnly = notes?.readOnly;

  const flush = useCallback(async (d = draftRef.current) => {
    window.clearTimeout(timer.current);
    if (!d || sent.current.get(d.index) === d.text) return;
    sent.current.set(d.index, d.text);
    setSave("saving");
    try {
      await send({ type: "notes.set", index: d.index, text: d.text });
      // A later keystroke may have landed while this save was out; then the note is still unsaved.
      const now = draftRef.current;
      setSave(!now || now.index !== d.index || now.text === d.text ? "saved" : "unsaved");
    } catch (e) {
      sent.current.delete(d.index);
      setSave({ error: (e as Error).message });
    }
  }, [send]);

  const edit = useCallback(() => {
    if (!notes || readOnly) return;
    sent.current.set(shown, notes.notes[shown]);
    setDraft({ index: shown, text: notes.notes[shown] });
  }, [notes, readOnly, shown]);
  const done = useCallback(() => { void flush(); setDraft(null); }, [flush]);
  const go = useCallback((i: number) => { const n = Math.max(0, Math.min(RUN_SHEET.length - 1, i)); setBrowse(n === liveIdx ? null : n); }, [liveIdx]);

  // The step changed under an open editor (the console moved on, or the speaker browsed): save, then edit the new step.
  useEffect(() => {
    const d = draftRef.current;
    if (!d || d.index === shown || !notes) return;
    void flush(d);
    sent.current.set(shown, notes.notes[shown]);
    setDraft({ index: shown, text: notes.notes[shown] });
  }, [shown, notes, flush]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement) {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); done(); }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ",") go(shown - 1);
      if (e.key === ".") go(shown + 1);
      if (e.key === "Home") { e.preventDefault(); setBrowse(null); }
      if (e.key.toLowerCase() === "d") setShowDisplay((v) => !v);
      if (e.key === "-") resize(-1);
      if (e.key === "=" || e.key === "+") resize(1);
      if (e.key === "0") setSize(SIZE.initial);
      if (e.key.toLowerCase() === "e" && !draftRef.current) { e.preventDefault(); edit(); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [go, shown, edit, done, resize, setShowDisplay, setSize]);

  // Closing the tab sends whatever is unsaved (a socket send needs no wait) and asks first if it could not.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      const d = draftRef.current;
      if (d && sent.current.get(d.index) !== d.text) { void flush(d); e.preventDefault(); }
    };
    window.addEventListener("beforeunload", onLeave); return () => window.removeEventListener("beforeunload", onLeave);
  }, [flush]);

  if (status === "unauthorized") return <div className="console"><p>Unauthorized. Open this page with <code>?key=YOUR_SPEAKER_KEY</code> (see .env).</p></div>;
  if (!view || !notes) return <div className="console"><p className="m">Connecting…</p></div>;

  const step = RUN_SHEET[shown];
  const next = RUN_SHEET[liveIdx + 1];
  const editing = draft?.index === shown;
  const text = notes.notes[shown];
  const slide = browse !== null ? slideOf(shown, view.slides) : undefined;
  const onDisplay = view.state.slide !== undefined ? `slide ${view.state.slide + 1} / ${view.slides.length}` : "live view";
  const saveText = typeof save === "object" ? `not saved: ${save.error}` : save === "saving" ? "saving…" : save === "unsaved" ? "unsaved" : "saved";
  // The display, as a sibling route of this one: /session/main/notes → /session/main/display, under any base path.
  const displayUrl = location.pathname.replace(/\/notes\/?$/, "/display");
  // Dragging: the divider holds the pointer, so the move events keep coming to it even over the display frame.
  const dragTo = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId) || !grid.current) return;
    const box = grid.current.getBoundingClientRect();
    setSplit(clamp(Math.round(((e.clientX - box.left) / box.width) * 100) / 100, SPLIT));
  };

  return <div className="console notes" style={{ "--note-size": `${size}px`, "--split": split } as React.CSSProperties}>
    <header className="con-head">
      <div className="con-title">
        <span className="d">Speaker notes</span>
        <span className="m"><i className={"dot" + (status === "open" ? " ok" : "")} /> session {view.state.id} · {status}</span>
      </div>
      <div className="note-step">
        <span className="m">{step.part} · step {shown + 1} / {RUN_SHEET.length}{live === undefined && browse === null ? " · run sheet not started, → on the console does this step" : ""}</span>
        <span className="d">{step.label}</span>
      </div>
      <div className="con-status">
        {browse === null
          ? <span className="chip lime">following the console</span>
          : <><span className="chip warn">browsing · console is on step {liveIdx + 1}</span><button className="mini on" onClick={() => setBrowse(null)}>Back to live</button></>}
      </div>
    </header>
    {status !== "open" && <div className="alert bad">Reconnecting… the step and the display may be out of date.</div>}

    {/* Hidden, the frame is removed rather than covered, so the display stops rendering a second time on this machine. */}
    <div ref={grid} className={"notes-grid" + (showDisplay ? "" : " solo")}>
      <div className="pane note-pane">
        <div className="pane-h">
          <span className="eb">Note · step {shown + 1}</span>
          <span className="btns">
            <button className="mini" disabled={shown === 0} onClick={() => go(shown - 1)}>◀ Prev</button>
            <button className="mini" disabled={shown === RUN_SHEET.length - 1} onClick={() => go(shown + 1)}>Next ▶</button>
            {editing
              ? <button className="mini on" onClick={done}>Done</button>
              : <button className="mini" disabled={!!readOnly} onClick={edit}>Edit</button>}
            <button className={"mini" + (showDisplay ? " on" : "")} aria-pressed={showDisplay} onClick={() => setShowDisplay((v) => !v)}>Display</button>
            <button className="mini" disabled={size <= SIZE.min} title="Smaller text (-)" aria-label="Smaller text" onClick={() => resize(-1)}>A−</button>
            <button className="mini" disabled={size >= SIZE.max} title="Larger text (+)" aria-label="Larger text" onClick={() => resize(1)}>A+</button>
          </span>
        </div>
        {!showDisplay && <span className="m">On the display: {onDisplay}{next ? ` · → next: ${next.label}` : " · end of the run sheet"}</span>}
        {readOnly && <span className="m bad">{readOnly}</span>}
        {slide && <img className="note-slide" src={`slides/${encodeURIComponent(slide)}`} alt={`Slide this step puts up: ${slide}`} />}
        {editing
          ? <>
            <textarea className="note-edit" autoFocus value={draft.text} aria-label={`Note for step ${shown + 1}`}
              onChange={(e) => { const d = { index: shown, text: e.target.value }; setDraft(d); setSave("unsaved"); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => void flush(d), SAVE_AFTER_MS); }}
              onBlur={() => void flush()} />
            <span className={"m" + (typeof save === "object" ? " bad" : "")}>{saveText} · <kbd>⌘ / Ctrl + Enter</kbd> done</span>
          </>
          : <div className="note-text" key={shown}>{text ? text.split(/\n{2,}/).map((p, i) => <p key={i}><Inline text={p} /></p>) : <span className="empty">No note for this step.{readOnly ? "" : " Press E to write one."}</span>}</div>}
      </div>

      {showDisplay && <div className="note-divider" role="separator" aria-orientation="vertical" aria-label="Width of the note beside the display"
        aria-valuemin={SPLIT.min * 100} aria-valuemax={SPLIT.max * 100} aria-valuenow={Math.round(split * 100)} tabIndex={0}
        title="Drag to change the widths; double-click for the default"
        onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={dragTo}
        onDoubleClick={() => setSplit(SPLIT.initial)}
        onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); setSplit((f) => clamp(f + (e.key === "ArrowLeft" ? -SPLIT.step : SPLIT.step), SPLIT)); } }} />}

      {showDisplay && <div className="pane display-pane">
        <div className="pane-h"><span className="eb">On the display</span><span className="m">{onDisplay}{next ? ` · → next: ${next.label}` : " · end of the run sheet"}</span></div>
        {/* Not clickable: the display's own keys (V, I, M) belong to the projector window. */}
        <iframe className="display-frame" src={displayUrl} title="The display, as the room sees it" tabIndex={-1} />
      </div>}
    </div>

    <footer className="keys">{KEYS.map(([k, l]) => <span key={k}><kbd>{k}</kbd>{l}</span>)}<span>This view never changes the display.</span></footer>
    {error && <div className="toast">{error}</div>}
  </div>;
}
