import { ROOT } from "./env.js";
import os from "node:os";
import path from "node:path";
import { Store } from "./store.js";
import { NotesFile } from "./notes.js";
import { attachSimulator } from "./simulate.js";
import { createApp, basePathOf, normalizeBasePath } from "./app.js";
import { llmInfo } from "./llm.js";

const PORT = Number(process.env.PORT || 3000);
const SPEAKER_KEY = process.env.SPEAKER_KEY || "change-me";
const fresh = process.argv.includes("--fresh");

function lanIp() {
  for (const ifs of Object.values(os.networkInterfaces())) for (const i of ifs ?? []) if (i.family === "IPv4" && !i.internal) return i.address;
  return "localhost";
}
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://${lanIp()}:${PORT}`).replace(/\/$/, "");
const joinUrl = `${PUBLIC_URL}/session/main`;
// Printed in the lobby instead of the site root, e.g. a short link that redirects to it. Display only: the QR code,
// base path, Route and TLS all still come from PUBLIC_URL.
const SHORT_URL = process.env.SHORT_URL?.trim() || undefined;
// The app serves itself under the path in PUBLIC_URL (a Route or proxy prefix such as /talk). BASE_PATH overrides that,
// e.g. BASE_PATH=/ behind a proxy that strips the prefix before forwarding.
const basePath = process.env.BASE_PATH ? normalizeBasePath(process.env.BASE_PATH) : basePathOf(PUBLIC_URL);

const store = new Store({ fresh, dataDir: path.join(ROOT, "data") });
attachSimulator(store);
const slidesDir = process.env.SLIDES_DIR ? path.resolve(ROOT, process.env.SLIDES_DIR) : path.join(ROOT, "slides");
// The speaker notes, one per run-sheet step. NOTES_READONLY=1 turns saving off (the cluster, where a save would not
// survive the next deploy).
const notesFile = process.env.NOTES_FILE ? path.resolve(ROOT, process.env.NOTES_FILE) : path.join(ROOT, "notes/speaker-notes.md");
const notes = new NotesFile(notesFile, /^(1|true|yes)$/i.test(process.env.NOTES_READONLY ?? ""));
const server = createApp({ store, notes, speakerKey: SPEAKER_KEY, joinUrl, shortUrl: SHORT_URL, distDir: path.join(ROOT, "client/dist"), slidesDir, basePath });

server.listen(PORT, () => {
  console.log(`Context Window Live`);
  console.log(`  participants : ${joinUrl}`);
  if (SHORT_URL) console.log(`  short url    : ${SHORT_URL} (lobby text only)`);
  console.log(`  display      : ${PUBLIC_URL}/session/main/display`);
  console.log(`  control      : ${PUBLIC_URL}/session/main/control?key=${SPEAKER_KEY}`);
  console.log(`  facilitator  : ${PUBLIC_URL}/session/main/facilitator?key=${SPEAKER_KEY}`);
  console.log(`  notes        : ${PUBLIC_URL}/session/main/notes?key=${SPEAKER_KEY}  (${path.relative(ROOT, notesFile)}${notes.readOnly ? ", read-only" : ""})`);
  const llm = llmInfo();
  console.log(`  live model   : ${llm.configured ? llm.info : `off (deterministic only${llm.reason ? `: ${llm.reason}` : ""})`}${fresh ? "  · fresh state" : ""}`);
  console.log(`  slides       : ${store.slides?.().length ?? 0} in ${slidesDir}`);
  if (basePath !== "/") console.log(`  base path    : ${basePath}`);
});
