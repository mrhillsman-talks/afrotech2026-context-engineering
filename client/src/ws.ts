import { useCallback, useEffect, useRef, useState } from "react";
import type { AnyView, ClientMessage, Command, ServerMessage } from "@ctx/shared";

export type Role = "participant" | "display" | "control" | "facilitator" | "notes";
/** The speaker notes as the server last sent them; only a notes socket receives them. */
export interface Notes { notes: string[]; readOnly?: string }
export type Status = "connecting" | "open" | "closed" | "unauthorized";

export const TOKEN_KEY = "ctx.token";
export const SPEAKER_KEY = "ctx.key";

export function speakerKey(): string {
  const q = new URLSearchParams(location.search).get("key");
  if (q) localStorage.setItem(SPEAKER_KEY, q);
  return q ?? localStorage.getItem(SPEAKER_KEY) ?? "";
}

/** One socket per surface. Reconnects with backoff and always takes a full snapshot on (re)connect. */
export function useSession<V extends AnyView>(role: Role) {
  const [view, setView] = useState<V | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Notes | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pending = useRef(new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>());
  const seq = useRef(1);
  const backoff = useRef(1000);

  useEffect(() => {
    let closed = false;
    let timer: number | undefined;
    const connect = () => {
      // Relative to <base href>, so the socket follows the path prefix the server is mounted at.
      const target = new URL("ws", document.baseURI);
      target.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(target.href);
      wsRef.current = ws;
      setStatus("connecting");
      ws.onopen = () => {
        backoff.current = 1000;
        const hello: ClientMessage = { type: "hello", role, token: localStorage.getItem(TOKEN_KEY) ?? undefined, key: speakerKey() };
        ws.send(JSON.stringify(hello));
        setStatus("open");
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as ServerMessage;
        if (msg.type === "snapshot") setView(msg.view as V);
        else if (msg.type === "notes") setNotes({ notes: msg.notes, readOnly: msg.readOnly });
        else if (msg.type === "registered") { localStorage.setItem(TOKEN_KEY, msg.token); }
        else if (msg.type === "unauthorized") { setStatus("unauthorized"); ws.close(); }
        else if (msg.type === "ack") {
          const p = pending.current.get(msg.id); pending.current.delete(msg.id);
          if (!p) return;
          if (msg.ok) p.resolve(msg.data); else { setError(msg.error); p.reject(new Error(msg.error)); }
        }
      };
      ws.onclose = () => {
        // A socket this effect already replaced (StrictMode's double mount, or a reconnect) must not null the live one.
        if (wsRef.current === ws) wsRef.current = null;
        if (closed) return;
        setStatus((s) => (s === "unauthorized" ? s : "closed"));
        timer = window.setTimeout(connect, backoff.current);
        backoff.current = Math.min(8000, backoff.current * 2);
      };
      ws.onerror = () => ws.close();
    };
    connect();
    const ping = window.setInterval(() => wsRef.current?.readyState === WebSocket.OPEN && wsRef.current.send(JSON.stringify({ type: "ping" })), 20000);
    return () => { closed = true; window.clearInterval(ping); if (timer) window.clearTimeout(timer); wsRef.current?.close(); };
  }, [role]);

  const send = useCallback((cmd: Command) => new Promise<unknown>((resolve, reject) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) { setError("Not connected"); return reject(new Error("not connected")); }
    const id = seq.current++;
    pending.current.set(id, { resolve, reject });
    const msg: ClientMessage = { type: "cmd", id, cmd };
    ws.send(JSON.stringify(msg));
    window.setTimeout(() => { if (pending.current.delete(id)) reject(new Error("timeout")); }, 10000);
  }), []);

  useEffect(() => { if (error) { const t = window.setTimeout(() => setError(null), 3500); return () => window.clearTimeout(t); } }, [error]);

  return { view, status, send, error, notes };
}
