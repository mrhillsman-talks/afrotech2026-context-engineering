import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { PARTICIPANT_COMMAND_TYPES, RUN_SHEET, parseNotes, notesForSheet } from "@ctx/shared";
import type { ServerMessage, ClientMessage, AnyView, Command, DisplayView } from "@ctx/shared";
import { Store } from "../src/store.js";
import { NotesFile } from "../src/notes.js";
import { createApp, basePathOf, normalizeBasePath } from "../src/app.js";

const KEY = "test-key";
let store: Store;
let server: ReturnType<typeof createApp>;
let url = "";
let dataDir = "";
let slidesDir = "";
let notesPath = "";

/** A socket with a message queue, so tests can wait for a specific message type. */
class Client {
  ws: WebSocket;
  queue: ServerMessage[] = [];
  waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];
  seq = 1;
  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on("message", (raw) => {
      const m = JSON.parse(String(raw)) as ServerMessage;
      const i = this.waiters.findIndex((w) => w.pred(m));
      if (i >= 0) { const [w] = this.waiters.splice(i, 1); w.resolve(m); } else this.queue.push(m);
    });
  }
  static async open(role: ClientMessage extends { type: "hello" } ? never : "participant" | "display" | "control" | "facilitator" | "notes", opts: { key?: string; token?: string } = {}) {
    const ws = new WebSocket(url);
    await new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("error", rej); });
    const c = new Client(ws);
    c.send({ type: "hello", role, key: opts.key, token: opts.token });
    return c;
  }
  send(m: ClientMessage) { this.ws.send(JSON.stringify(m)); }
  next(pred: (m: ServerMessage) => boolean, timeoutMs = 3000): Promise<ServerMessage> {
    const i = this.queue.findIndex(pred);
    if (i >= 0) return Promise.resolve(this.queue.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.waiters = this.waiters.filter((w) => w.resolve !== resolve); reject(new Error("timeout waiting for message")); }, timeoutMs);
      this.waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m); } });
    });
  }
  snapshot() { return this.next((m) => m.type === "snapshot").then((m) => (m as { view: AnyView }).view); }
  async cmd(cmd: Command) {
    const id = this.seq++;
    this.send({ type: "cmd", id, cmd });
    const ack = await this.next((m) => m.type === "ack" && m.id === id) as Extract<ServerMessage, { type: "ack" }>;
    return ack;
  }
  async silence(ms = 400) { await new Promise((r) => setTimeout(r, ms)); return this.queue.length === 0; }
  close() { this.ws.close(); }
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-test-"));
  store = new Store({ fresh: true, dataDir });
  slidesDir = path.join(dataDir, "slides");
  fs.mkdirSync(slidesDir);
  for (const f of ["10.png", "2.png", "1.png", "notes.txt", ".DS_Store"]) fs.writeFileSync(path.join(slidesDir, f), "");
  notesPath = path.join(dataDir, "notes", "speaker-notes.md");
  server = createApp({ store, notes: new NotesFile(notesPath), speakerKey: KEY, joinUrl: "http://test/session/main", shortUrl: "cwa.link/test", distDir: path.join(dataDir, "no-dist"), slidesDir });
  await new Promise<void>((res) => server.listen(0, res));
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;
});
after(async () => {
  await new Promise<void>((res) => server.close(() => res()));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("socket layer", () => {
  test("control and facilitator need the speaker key; display does not", async () => {
    const bad = await Client.open("control", { key: "wrong" });
    assert.equal((await bad.next((m) => m.type === "unauthorized")).type, "unauthorized"); bad.close();
    const good = await Client.open("control", { key: KEY });
    assert.equal((await good.snapshot()).kind, "control"); good.close();
    const fac = await Client.open("facilitator", { key: KEY });
    assert.equal((await fac.snapshot()).kind, "control"); fac.close();
    const disp = await Client.open("display");
    const v = await disp.snapshot();
    assert.equal(v.kind, "display");
    if (v.kind !== "display") throw new Error();
    assert.equal(v.shortUrl, "cwa.link/test", "SHORT_URL reaches the lobby");
    assert.equal(v.joinUrl, "http://test/session/main", "and leaves the QR target alone");
    assert.ok(!JSON.stringify(v).includes("lastName"), "the display never carries surnames"); disp.close();
  });

  test("every participant command type routes to the participant handler, not the speaker one", async () => {
    const p = await Client.open("participant");
    const reg = await p.cmd({ type: "register", firstName: "Route", lastName: "Check", experience: "build" });
    assert.equal(reg.ok, true);
    for (const type of PARTICIPANT_COMMAND_TYPES) {
      if (type === "register" || type === "leave") continue;
      const ack = await p.cmd({ type, itemId: "ATLAS-002", state: "active", pollId: "x", optionId: "x", source: "Web", enabled: true, text: "hi", value: 1 } as unknown as Command);
      assert.notEqual(ack.ok === false && ack.error, "speaker only", `${type} was routed as a speaker command`);
    }
    const sp = await p.cmd({ type: "advance" });
    assert.equal(sp.ok, false); assert.equal(sp.ok === false && sp.error, "speaker only");
    p.close();
  });

  test("registration returns a token and a number, and the phone's view follows the speaker", async () => {
    const ctl = await Client.open("control", { key: KEY }); await ctl.snapshot();
    const p = await Client.open("participant");
    p.send({ type: "cmd", id: 99, cmd: { type: "register", firstName: "Chris", lastName: "Okafor", experience: "use" } });
    const registered = await p.next((m) => m.type === "registered") as Extract<ServerMessage, { type: "registered" }>;
    assert.match(registered.number, /^P\d{3}$/);
    const first = await p.snapshot();
    assert.equal(first.kind, "participant");
    if (first.kind !== "participant") throw new Error();
    assert.equal(first.me.firstName, "Chris");
    assert.equal(first.me.parked, false, "joining in the lobby never parks");
    assert.equal((await ctl.cmd({ type: "preset", phase: "solo-select" })).ok, true);
    const next = await p.next((m) => m.type === "snapshot" && (m as { view: AnyView }).view.kind === "participant" && ((m as { view: AnyView }).view as { shared: { phase: string } }).shared.phase === "solo-select");
    assert.ok(next);
    const run = await p.cmd({ type: "solo.set", itemId: "ATLAS-002", state: "active" });
    assert.equal(run.ok, true);
    // Reconnect with the token: full snapshot, same participant.
    p.close();
    const again = await Client.open("participant", { token: registered.token });
    const v = await again.snapshot();
    if (v.kind !== "participant") throw new Error();
    assert.equal(v.me.number, registered.number);
    assert.equal(v.me.solo.items["ATLAS-002"], "active", "state survives reconnect");
    again.close(); ctl.close();
  });

  test("mid-phase joiners are parked until the phase changes and cannot act meanwhile", async () => {
    const ctl = await Client.open("control", { key: KEY }); await ctl.snapshot();
    await ctl.cmd({ type: "preset", phase: "shared-auction" });
    const p = await Client.open("participant");
    await p.cmd({ type: "register", firstName: "Late", lastName: "One", experience: "infra" });
    const v = await p.snapshot();
    if (v.kind !== "participant") throw new Error();
    assert.equal(v.me.parked, true);
    const vote = await p.cmd({ type: "credits.set", itemId: "ATLAS-002", value: 10 });
    assert.equal(vote.ok, false);
    await ctl.cmd({ type: "advance" });
    const after = await p.next((m) => m.type === "snapshot" && ((m as { view: AnyView }).view as { me: { parked: boolean } }).me.parked === false);
    assert.ok(after);
    p.close(); ctl.close();
  });

  test("leave blanks the name, kills the token, refuses further commands and keeps aggregates", async () => {
    const ctl = await Client.open("control", { key: KEY }); await ctl.snapshot();
    await ctl.cmd({ type: "preset", phase: "shared-auction" });
    const p = await Client.open("participant");
    p.send({ type: "cmd", id: 98, cmd: { type: "register", firstName: "Gone", lastName: "Soon", experience: "use" } });
    const registered = await p.next((m) => m.type === "registered") as Extract<ServerMessage, { type: "registered" }>;
    await ctl.cmd({ type: "parked.release" });
    assert.equal((await p.cmd({ type: "credits.set", itemId: "ATLAS-002", value: 25 })).ok, true);
    const before = store.audienceTotals()["ATLAS-002"] ?? 0;
    assert.equal((await p.cmd({ type: "leave" })).ok, true);
    assert.equal((await p.cmd({ type: "credits.set", itemId: "ATLAS-002", value: 30 })).ok, false);
    const rec = [...store.participants.values()].find((x) => x.number === registered.number)!;
    assert.equal(rec.left, true); assert.equal(rec.firstName, ""); assert.equal(rec.lastName, "");
    assert.equal(store.audienceTotals()["ATLAS-002"], before, "credits already cast stay in the totals");
    assert.ok(!store.present().some((x) => x.number === registered.number));
    const ghost = await Client.open("participant", { token: registered.token });
    assert.equal(await ghost.silence(), true, "a dead token gets no view");
    ghost.close(); p.close(); ctl.close();
  });

  test("the slide deck is listed in natural order and only the console can put a slide on the display", async () => {
    const ctl = await Client.open("control", { key: KEY }); await ctl.snapshot();
    const disp = await Client.open("display");
    let v = await disp.snapshot() as DisplayView;
    assert.deepEqual(v.slides, ["1.png", "2.png", "10.png"]);
    assert.equal(v.state.slide, undefined);
    const http = url.replace(/^ws/, "http").replace(/\/ws$/, "");
    assert.equal((await fetch(`${http}/slides/1.png`)).status, 200);
    assert.equal((await fetch(`${http}/slides/notes.txt`)).status, 200); // static files are served; only the deck listing filters by type
    assert.equal((await fetch(`${http}/slides/missing.png`)).status, 404);

    assert.equal((await ctl.cmd({ type: "slide.set", index: 1 })).ok, true);
    v = await disp.snapshot() as DisplayView; assert.equal(v.state.slide, 1);
    await ctl.cmd({ type: "slide.step", delta: 5 });
    v = await disp.snapshot() as DisplayView; assert.equal(v.state.slide, 2, "steps clamp to the last slide");
    await ctl.cmd({ type: "slide.set", index: null });
    v = await disp.snapshot() as DisplayView; assert.equal(v.state.slide, undefined);
    await ctl.cmd({ type: "slide.step", delta: 1 });
    v = await disp.snapshot() as DisplayView; assert.equal(v.state.slide, 0, "stepping from the live view opens the first slide");

    // A newly dropped file shows up without a restart, and the display socket cannot drive the deck.
    fs.writeFileSync(path.join(slidesDir, "3.png"), "");
    await ctl.cmd({ type: "slide.set", index: 3 });
    v = await disp.snapshot() as DisplayView; assert.deepEqual(v.slides, ["1.png", "2.png", "3.png", "10.png"]); assert.equal(v.state.slide, 3);
    assert.equal((await disp.cmd({ type: "slide.set", index: 0 })).ok, false);
    await ctl.cmd({ type: "slide.set", index: null });
    ctl.close(); disp.close();
  });

  test("snapshot and events land in the configured data directory, not the repo", async () => {
    await new Promise((r) => setTimeout(r, 2300));
    assert.ok(fs.existsSync(path.join(dataDir, "snapshot.json")));
    assert.ok(fs.existsSync(path.join(dataDir, "events.ndjson")));
  });
});

describe("advance and back", () => {
  test("back loads the previous main phase, stops at the lobby, and leaves an activity for the phase it came from", async () => {
    const st = new Store({ fresh: true, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "ctx-back-")) });
    await st.handleSpeaker({ type: "preset", phase: "privacy" });
    await st.handleSpeaker({ type: "back" });
    assert.equal(st.state.phase, "scope");
    await st.handleSpeaker({ type: "advance" });
    assert.equal(st.state.phase, "privacy");
    await st.handleSpeaker({ type: "preset", phase: "provenance" });
    await st.handleSpeaker({ type: "back" });
    assert.equal(st.state.phase, "privacy");
    await st.handleSpeaker({ type: "preset", phase: "lobby" });
    await st.handleSpeaker({ type: "back" });
    assert.equal(st.state.phase, "lobby");
  });
});

describe("talk clock", () => {
  test("start, pause and resume bank the elapsed time; reset clears it", async () => {
    const st = new Store({ fresh: true, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "ctx-clock-")) });
    assert.deepEqual(st.state.timer, { elapsedMs: 0 });
    await st.handleSpeaker({ type: "timer.start" });
    const started = st.state.timer.startedAt!;
    assert.ok(started > 0);
    await st.handleSpeaker({ type: "timer.start" });
    assert.equal(st.state.timer.startedAt, started, "a second start does not restart the clock");
    await new Promise((r) => setTimeout(r, 20));
    await st.handleSpeaker({ type: "timer.pause" });
    assert.equal(st.state.timer.startedAt, undefined);
    const banked = st.state.timer.elapsedMs;
    assert.ok(banked >= 15);
    await st.handleSpeaker({ type: "timer.pause" });
    assert.equal(st.state.timer.elapsedMs, banked, "a second pause banks nothing");
    await st.handleSpeaker({ type: "timer.reset" });
    assert.equal(st.state.timer.elapsedMs, 0);
    assert.deepEqual(st.state.timer.partMarks, { 0: 0 }, "reset forgets the marks and starts the current part at 0:00");
  });
  test("each part's slot starts when the speaker enters it, from the preset or the slide; going back resumes it", async () => {
    const st = new Store({ fresh: true, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "ctx-clock-")) });
    st.slides = () => Array.from({ length: 25 }, (_, i) => `${String(i + 1).padStart(2, "0")}-slide.svg`);
    const at = (ms: number) => { st.state.timer = { ...st.state.timer, elapsedMs: ms }; };
    await st.handleSpeaker({ type: "timer.reset" });
    at(200_000);
    await st.handleSpeaker({ type: "slide.set", index: 6 }); // 07, Part 1's setup slide, before its first preset
    assert.equal(st.state.timer.partIndex, 1);
    assert.equal(st.state.timer.partMarks?.[1], 200_000);
    at(260_000);
    await st.handleSpeaker({ type: "preset", phase: "solo-select" });
    assert.equal(st.state.timer.partMarks?.[1], 200_000, "the first preset of the same part does not restart its slot");
    at(300_000);
    await st.handleSpeaker({ type: "slide.set", index: 8 }); // 09, Part 2
    assert.equal(st.state.timer.partMarks?.[2], 300_000);
    at(310_000);
    await st.handleSpeaker({ type: "slide.set", index: 6 }); // back to 07; the preset still says Part 1
    assert.equal(st.state.timer.partIndex, 1);
    assert.equal(st.state.timer.partMarks?.[1], 200_000, "going back resumes the earlier part's slot");
    at(320_000);
    await st.handleSpeaker({ type: "slide.set", index: 8 });
    assert.equal(st.state.timer.partMarks?.[2], 320_000, "moving forward into a part starts its slot afresh");
    await st.handleSpeaker({ type: "timer.start" });
    await st.handleSpeaker({ type: "timer.pause" });
    assert.equal(st.state.timer.partIndex, 2, "pausing keeps the part and its marks");
    assert.equal(st.state.timer.partMarks?.[2], 320_000);
  });
  test("a session with no part noted yet takes the part's scheduled mark", async () => {
    const st = new Store({ fresh: true, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "ctx-clock-")) });
    st.state.phase = "privacy";
    st.state.timer = { elapsedMs: 21 * 60_000 };
    await st.handleSpeaker({ type: "timer.start" });
    assert.equal(st.state.timer.partIndex, 3);
    assert.equal(st.state.timer.partMarks?.[3], 20 * 60_000, "Part 3 is taken to have begun at its 20:00 mark");
  });
});

describe("base path", () => {
  test("PUBLIC_URL's path is the prefix; BASE_PATH-style input is normalized", () => {
    assert.equal(basePathOf("https://talks.example.com/ctx/"), "/ctx");
    assert.equal(basePathOf("https://talks.example.com"), "/");
    assert.equal(basePathOf("http://192.168.1.4:3000"), "/");
    assert.equal(basePathOf("not a url"), "/");
    assert.equal(normalizeBasePath("talk"), "/talk");
    assert.equal(normalizeBasePath("/talk/"), "/talk");
    assert.equal(normalizeBasePath("/"), "/");
    assert.equal(normalizeBasePath(""), "/");
  });

  test("under a prefix every surface, the socket and the assets move with it; the root only redirects", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-base-"));
    const dist = path.join(dir, "dist"); fs.mkdirSync(dist);
    fs.writeFileSync(path.join(dist, "index.html"), '<!doctype html><html><head><base href="/" /><script src="./assets/app.js"></script></head><body></body></html>');
    const slides = path.join(dir, "slides"); fs.mkdirSync(slides); fs.writeFileSync(path.join(slides, "1.png"), "");
    const st = new Store({ fresh: true, dataDir: dir });
    const srv = createApp({ store: st, notes: new NotesFile(path.join(dir, "notes.md")), speakerKey: KEY, joinUrl: "http://test/talk/session/main", distDir: dist, slidesDir: slides, basePath: "talk/" });
    await new Promise<void>((res) => srv.listen(0, res));
    const http = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    try {
      assert.equal((await fetch(`${http}/talk/api/health`)).status, 200);
      assert.equal((await fetch(`${http}/api/health`)).status, 404, "nothing is served outside the prefix");
      assert.equal((await fetch(`${http}/talk/slides/1.png`)).status, 200);
      const page = await fetch(`${http}/talk/session/main/display`);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /<base href="\/talk\/" \/>/, "the base tag is rewritten to the prefix");
      for (const from of ["/talk", "/talk/", "/"]) {
        const r = await fetch(`${http}${from}`, { redirect: "manual" });
        assert.equal(r.status, 302, `${from} redirects`);
        assert.equal(r.headers.get("location"), "/talk/session/main");
      }
      const ws = new WebSocket(`${http.replace(/^http/, "ws")}/talk/ws`);
      await new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("error", rej); });
      ws.send(JSON.stringify({ type: "hello", role: "display" }));
      const snap = JSON.parse(String(await new Promise((res) => ws.once("message", res)))) as ServerMessage;
      assert.equal(snap.type, "snapshot"); ws.close();
      const bare = new WebSocket(`${http.replace(/^http/, "ws")}/ws`);
      await new Promise<void>((res) => { bare.once("error", () => res()); bare.once("open", () => { bare.close(); assert.fail("the root socket path must not answer under a prefix"); }); });
    } finally {
      await new Promise<void>((res) => srv.close(() => res()));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("speaker notes", () => {
  type NotesMsg = Extract<ServerMessage, { type: "notes" }>;
  const isNotes = (m: ServerMessage) => m.type === "notes";

  test("the notes view needs the speaker key and gets the console's view plus one note per step", async () => {
    const bad = await Client.open("notes", { key: "wrong" });
    assert.equal((await bad.next((m) => m.type === "unauthorized")).type, "unauthorized"); bad.close();
    const n = await Client.open("notes", { key: KEY });
    assert.equal((await n.snapshot()).kind, "control");
    const m = await n.next(isNotes) as NotesMsg;
    assert.equal(m.notes.length, RUN_SHEET.length);
    assert.equal(m.readOnly, undefined);
    n.close();
  });

  test("a save writes the file and reaches every notes view, and no other socket", async () => {
    const a = await Client.open("notes", { key: KEY }), b = await Client.open("notes", { key: KEY });
    await a.next(isNotes); await b.next(isNotes);
    const ctl = await Client.open("control", { key: KEY }), disp = await Client.open("display");
    await ctl.snapshot(); await disp.snapshot();
    assert.equal((await a.cmd({ type: "notes.set", index: 3, text: "\n  Point at the slide.\n\n" })).ok, true);
    const got = await b.next(isNotes) as NotesMsg;
    assert.equal(got.notes[3], "  Point at the slide.", "the note as the file holds it: blank lines around it dropped");
    assert.equal(notesForSheet(parseNotes(fs.readFileSync(notesPath, "utf8"))).notes[3], "  Point at the slide.");
    await ctl.silence(300);
    assert.ok(![...ctl.queue, ...disp.queue].some(isNotes), "notes never reach the console or the display");
    const fromConsole = await ctl.cmd({ type: "notes.set", index: 3, text: "x" });
    assert.equal(fromConsole.ok === false && fromConsole.error, "notes view only");
    const heading = await a.cmd({ type: "notes.set", index: 3, text: "ok\n## Step 4 · Opening · Slide 03 base" });
    assert.equal(heading.ok, false);
    const range = await a.cmd({ type: "notes.set", index: RUN_SHEET.length, text: "x" });
    assert.equal(range.ok === false && range.error, `No run sheet step ${RUN_SHEET.length + 1}`);
    a.close(); b.close(); ctl.close(); disp.close();
  });

  test("the run sheet's arrows on the console move the notes view's step", async () => {
    const ctl = await Client.open("control", { key: KEY }), n = await Client.open("notes", { key: KEY });
    await ctl.snapshot(); await n.snapshot();
    const step = (v: AnyView) => (v.kind === "control" ? v.state.runStep : undefined);
    const landed = (i: number) => n.next((m) => m.type === "snapshot" && step(m.view) === i);
    assert.equal((await ctl.cmd({ type: "run.goto", index: 0 })).ok, true);
    await landed(0);
    assert.equal((await ctl.cmd({ type: "run.next" })).ok, true);
    await landed(1);
    assert.equal((await ctl.cmd({ type: "run.back" })).ok, true);
    await landed(0);
    ctl.close(); n.close();
  });
});
