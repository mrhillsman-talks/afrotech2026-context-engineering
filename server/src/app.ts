import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import type { ClientMessage, ServerMessage, Participant } from "@ctx/shared";
import type { Store } from "./store.js";
import { CommandError, isSpeakerCommand } from "./store.js";
import { participantView, displayView, controlView } from "./views.js";
import { llmConfigured } from "./llm.js";
import { slideLister } from "./slides.js";
import type { NotesFile } from "./notes.js";

export interface AppOptions { store: Store; notes: NotesFile; speakerKey: string; joinUrl: string; shortUrl?: string; distDir: string; slidesDir: string; basePath?: string }

/** "/talk" for talk, /talk or /talk/; "/" for the root. */
export function normalizeBasePath(p: string): string { return "/" + p.replace(/^\/+|\/+$/g, ""); }
/** Path prefix the app is served under, taken from PUBLIC_URL: https://host/talk gives /talk, https://host gives /. */
export function basePathOf(publicUrl: string): string {
  try { return normalizeBasePath(new URL(publicUrl).pathname); } catch { return "/"; }
}

/** Builds the HTTP + WebSocket server for a store. index.ts wires env and listens; tests start it on a random port. */
export function createApp({ store, notes, speakerKey: SPEAKER_KEY, joinUrl, shortUrl, distDir: dist, slidesDir, basePath = "/" }: AppOptions) {
const app = express();
// Everything hangs off one router mounted at the base path, so a Route or proxy prefix (BASE_PATH, see index.ts)
// only moves the mount point and the WebSocket path. `base` is "" at the root and "/talk" under a prefix.
const base = basePath === "/" ? "" : normalizeBasePath(basePath);
const r = express.Router();
store.slides = slideLister(slidesDir);
// The speaker's own deck: PNGs dropped into the slides directory, shown full-screen on the display on request.
r.use("/slides", express.static(slidesDir, { index: false, maxAge: "1h" }));
r.get("/api/health", (_req, res) => res.json({ ok: true, version: store.state.version, phase: store.state.phase, participants: store.participants.size, llm: llmConfigured() }));
r.get("/api/join-url", (_req, res) => res.json({ joinUrl }));
// The event log carries participant numbers only, never names, so the display can fetch it for replay.
r.get("/api/events", (_req, res) => res.json(store.state.events.filter((e) => e.type !== "display")));
// Speaker-only download of the End-session export (or any earlier one by name).
r.get("/api/export/:name?", (req, res) => {
  if (req.query.key !== SPEAKER_KEY) return res.status(401).send("speaker key required");
  const dataDir = store.dataDir;
  const name = req.params.name && /^export-[\w-]+\.json$/.test(req.params.name) ? req.params.name : store.state.exportFile;
  if (!name) return res.status(404).send("no export yet");
  const file = path.join(dataDir, name);
  if (!fs.existsSync(file)) return res.status(404).send("export not found");
  res.download(file, name);
});
r.get("/", (_req, res) => res.redirect(`${base}/session/main`));

if (fs.existsSync(dist)) {
  // The built index.html carries <base href="/"> and relative asset URLs; rewriting the base to the prefix lets one
  // build serve at any path.
  const html = fs.readFileSync(path.join(dist, "index.html"), "utf8").replace('<base href="/"', `<base href="${base}/"`);
  r.use(express.static(dist, { index: false }));
  r.get(/^\/session\/.*/, (_req, res) => res.type("html").send(html));
} else {
  r.get(/^\/session\/.*/, (_req, res) => res.status(503).send("Client not built. Run `npm run build` (or `npm run dev` for Vite)."));
}

app.use(base || "/", r);
if (base) app.get("/", (_req, res) => res.redirect(`${base}/session/main`));

const server = http.createServer(app);
// Every client message is a small command (a note is the largest, a few KB); a bigger frame closes the socket (1009).
const wss = new WebSocketServer({ server, path: `${base}/ws`, maxPayload: 64 * 1024 });
// Messages one socket may send in any ten-second window. A phone sends a few per minute; the room is a public URL.
const RATE_LIMIT = { window: 10_000, max: 100 };

type Role = "participant" | "display" | "control" | "facilitator" | "notes";
interface Conn { ws: WebSocket; role?: Role; participantId?: string; alive: boolean; sent: number[] }
const conns = new Set<Conn>();
const send = (ws: WebSocket, msg: ServerMessage) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };

function viewFor(c: Conn, cache: { display?: ReturnType<typeof displayView>; control?: ReturnType<typeof controlView> }) {
  if (c.role === "participant") {
    const p = c.participantId ? store.participants.get(c.participantId) : undefined;
    return p ? participantView(store, p) : undefined;
  }
  if (c.role === "display") return (cache.display ??= displayView(store, joinUrl, shortUrl));
  if (c.role === "control" || c.role === "facilitator" || c.role === "notes") return (cache.control ??= controlView(store, joinUrl, shortUrl));
  return undefined;
}

let flushTimer: NodeJS.Timeout | undefined;
function broadcast() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    const cache = {};
    for (const c of conns) { const v = viewFor(c, cache); if (v) send(c.ws, { type: "snapshot", view: v }); }
  }, 80);
}
store.onChange(broadcast);
// The notes travel apart from the snapshots, to notes sockets only, and only when they change.
const notesMessage = (): ServerMessage => ({ type: "notes", notes: notes.notes, readOnly: notes.readOnly });

wss.on("connection", (ws) => {
  const c: Conn = { ws, alive: true, sent: [] };
  conns.add(c);
  ws.on("pong", () => { c.alive = true; });
  // ws reports a bad or oversized frame as an error on the socket and then closes it. Without a listener the
  // error is uncaught and takes the whole server down, so a hostile client must never find one missing.
  ws.on("error", (e) => { console.warn(`socket error: ${e.message}`); });
  ws.on("message", async (raw) => {
    let msg: ClientMessage;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    const now = Date.now();
    c.sent = c.sent.filter((t) => now - t < RATE_LIMIT.window); c.sent.push(now);
    if (c.sent.length > RATE_LIMIT.max) {
      if (msg.type === "cmd") send(ws, { type: "ack", id: msg.id, ok: false, error: "Too many requests; slow down" });
      return;
    }
    if (msg.type === "ping") return send(ws, { type: "pong" });
    if (msg.type === "hello") {
      if ((msg.role === "control" || msg.role === "facilitator" || msg.role === "notes") && msg.key !== SPEAKER_KEY) return send(ws, { type: "unauthorized" });
      c.role = msg.role;
      if (msg.role === "participant" && msg.token) {
        const id = store.byToken.get(msg.token);
        if (id) { c.participantId = id; const p = store.participants.get(id)!; p.connected++; p.lastSeen = new Date().toISOString(); }
      }
      const v = viewFor(c, {});
      if (v) send(ws, { type: "snapshot", view: v });
      if (msg.role === "notes") { notes.refresh(); send(ws, notesMessage()); }
      if (msg.role === "participant") broadcast(); // connection counts on the console and facilitator view
      return;
    }
    if (msg.type === "cmd") {
      try {
        if (msg.cmd.type === "register") {
          if (c.role !== "participant") throw new CommandError("not a participant socket");
          const p = store.register(msg.cmd.firstName, msg.cmd.lastName, msg.cmd.experience);
          c.participantId = p.id; p.connected++;
          send(ws, { type: "registered", token: p.token, number: p.number });
          send(ws, { type: "ack", id: msg.id, ok: true });
          return;
        }
        if (msg.cmd.type === "notes.set") {
          if (c.role !== "notes") throw new CommandError("notes view only");
          notes.set(msg.cmd.index, msg.cmd.text);
          send(ws, { type: "ack", id: msg.id, ok: true });
          const m = notesMessage();
          for (const o of conns) if (o.role === "notes") send(o.ws, m);
          return;
        }
        if (isSpeakerCommand(msg.cmd)) {
          if (c.role !== "control") throw new CommandError("speaker only");
          const data = await store.handleSpeaker(msg.cmd);
          return send(ws, { type: "ack", id: msg.id, ok: true, data });
        }
        if (c.role !== "participant" || !c.participantId) throw new CommandError("Please register first");
        const p = store.participants.get(c.participantId) as Participant;
        const data = store.handleParticipant(p, msg.cmd);
        if (msg.cmd.type === "leave") { p.connected = Math.max(0, p.connected - 1); c.participantId = undefined; }
        send(ws, { type: "ack", id: msg.id, ok: true, data });
      } catch (e) {
        const error = e instanceof CommandError ? e.message : "Something went wrong";
        if (!(e instanceof CommandError)) console.error(e);
        send(ws, { type: "ack", id: msg.id, ok: false, error });
      }
    }
  });
  ws.on("close", () => {
    conns.delete(c);
    if (c.participantId) { const p = store.participants.get(c.participantId); if (p) p.connected = Math.max(0, p.connected - 1); }
    broadcast();
  });
});

const pingTimer = setInterval(() => {
  for (const c of conns) { if (!c.alive) { c.ws.terminate(); continue; } c.alive = false; c.ws.ping(); }
}, 15000);

// Console and facilitator metrics (event rate, stuck clients, connections) move with time, not only with state:
// push them a fresh view every few seconds. Participants and the display only get real changes.
const metricsTimer = setInterval(() => {
  const cache = {};
  for (const c of conns) if (c.role === "control" || c.role === "facilitator") { const v = viewFor(c, cache); if (v) send(c.ws, { type: "snapshot", view: v }); }
}, 3000);
// Timers must not keep a test process alive, and go away with the server.
pingTimer.unref(); metricsTimer.unref();
server.on("close", () => { clearInterval(pingTimer); clearInterval(metricsTimer); if (flushTimer) clearTimeout(flushTimer); for (const c of conns) c.ws.terminate(); });

return server;
}
