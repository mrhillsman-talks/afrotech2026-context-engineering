# Context Window Live

Context Window Live is the audience application for the talk *Context Engineering: AI productivity
in your day to day*. It is for the speaker who runs the talk and for anyone who runs or adapts it.

## What the talk does

The audience joins from their phones and operates an assistant's context window for one fixed
scenario, Project Atlas, a product launching on Tuesday. The question is the same for the whole
talk: what should Project Atlas do for Tuesday's production launch? The model is the same too. Only
the information the assistant is allowed to see changes.

Sixteen presets, one per phase, take the room through:

- selecting cards within a budget, then compressing them when the budget shrinks (solo, presets 01 and 02);
- filling one shared window from secret roles and voting on what deserves attention (03 to 05);
- scope, privacy and trust filters, each turned on live after the room has seen the failure (06 to 08);
- retrieval from outside the window, then the reveal of the assembly pipeline (09 and 10);
- who owns the context machinery when you buy, blend or build (11 to 13);
- the final run with the engineered context, and a replay of everything the room did (14 and 15).

Every assistant run is deterministic by default: scripted answers keyed on which cards reach the
window, a trace per card, and an eval of required facts and forbidden dependencies. A live model is
optional and falls back to the scripted answer.

The outcome the talk is built for: the audience leaves with one definition, that context engineering
is how we choose and maintain the information available to an assistant as it works, and with the
four questions every context decision answers: what gets in, how it is represented, what stays, and
who decides.

## Documents

| Document | Contents |
|---|---|
| `docs/spec-and-runbook.md` | What the app is and does: scenario, cards, presets, assembler, surfaces, architecture, and the speaker's per-preset walkthrough |
| `docs/speaker-transcript.md` | The spoken script with console cues. `docs/speaker-transcript-human.md` is the version the notes are drafted from |
| `docs/speaker-cheat-sheet.html` | Generated run of show: presets, expected card state, lessons, card table |
| `docs/speaker-qa-backup.md` | Answers and sources for likely questions |
| `notes/speaker-notes.md` | One note per run sheet step, shown in the notes view |
| `slides/README.md` | The slide deck: file order, generation, Google Slides export |
| `deploy/openshift/README.md` | Deploying to OpenShift |

## Quick start

Requires Node 20 or later.

```bash
npm install
```

```bash
cp .env.example .env
```

In `.env`, replace the three placeholders, `SPEAKER_KEY`, `PUBLIC_URL` and `SHORT_URL` (see
[Configuration](#configuration)). Then:

```bash
npm run build
```

```bash
npm start
```

The server prints the URLs of the five surfaces:

| Surface | URL |
|---|---|
| Participants (QR target) | `http://<lan-ip>:3000/session/main` |
| Projected display | `http://<lan-ip>:3000/session/main/display` |
| Speaker console | `http://<lan-ip>:3000/session/main/control?key=<SPEAKER_KEY>` |
| Facilitator view (read-only) | `http://<lan-ip>:3000/session/main/facilitator?key=<SPEAKER_KEY>` |
| Speaker notes | `http://<lan-ip>:3000/session/main/notes?key=<SPEAKER_KEY>` |

No network access is needed. The join URL defaults to the machine's LAN address, so a laptop on a
hotspot or the venue Wi-Fi serves the room.

## Configuration

`.env` is read once at startup; restart the server after editing it. `.env.example` documents every
variable.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port for every surface |
| `SPEAKER_KEY` | required | Gates the console, facilitator view, notes view and export. The server refuses to start when it is empty or still the placeholder |
| `PUBLIC_URL` | `http://<lan-ip>:<port>` | Where the QR code points. A path in it (`https://host/talk`) makes the app serve itself under that prefix |
| `BASE_PATH` | the path of `PUBLIC_URL` | Overrides the prefix, for a proxy that strips it before forwarding |
| `SHORT_URL` | the site root | Text printed under the QR code only; the QR code still encodes `PUBLIC_URL` |
| `SLIDES_DIR` | `slides/` | Folder of slide images |

**`SPEAKER_KEY`, `PUBLIC_URL` and `SHORT_URL` must be updated.** `.env.example` ships them as
placeholders, `CHOOSE-A-SECRET`, `https://YOUR-PUBLIC-HOST` and `YOUR-SHORT-LINK`, and the server
refuses to start while any of them still holds its placeholder. Choose a long random speaker key;
it is printed with the URLs only when the server runs on a terminal, never into captured logs. Set `PUBLIC_URL` to the address the audience's devices will reach, or leave
it empty to use the LAN address, which only works when every device is on the same network. Set
`SHORT_URL` to your own short link, or leave it empty to print the site root.
| `NOTES_FILE` | `notes/speaker-notes.md` | Speaker notes, one per run sheet step |
| `NOTES_READONLY` | unset | `1` turns saving notes off; the notes view still shows them |
| `MAX_PARTICIPANTS` | `1000` | Real registrations the room accepts; later ones get "The room is full". Simulated participants are not counted |

### Live model (optional)

With none of these set the app runs in deterministic mode. With a model configured, every failure or
timeout falls back to the scripted answer.

| Variable | Purpose |
|---|---|
| `LLM_PROVIDER` | `anthropic`, `openai`, `openai-responses`, `openai-compatible` or `ollama` |
| `LLM_MODEL` | Model name. Required for `openai-compatible` and `ollama` |
| `LLM_API_KEY` | The key. `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` also work, and on their own select that provider |
| `LLM_BASE_URL` | API root. Required for `openai-compatible` (Ollama's `/v1`, LM Studio, vLLM, llama.cpp, OpenRouter, Groq). For `ollama` it overrides `http://localhost:11434` |
| `LLM_EFFORT` | Reasoning effort, where the API has one |
| `LLM_MAX_TOKENS` | Answer budget, `400` by default |
| `LLM_TIMEOUT_MS` | Wait before falling back, `8000` by default |

### Persistence

State is held in memory and snapshotted to `data/snapshot.json` every two seconds, so a server
restart keeps the room. Events are appended to `data/events.ndjson`. `npm run fresh` starts with a
clean session.

## Development and tests

| Command | What it does |
|---|---|
| `npm run dev` | Hot reload: Vite on :5173 proxies to the server on :3000 |
| `npm test` | Engine suite, then server suite |
| `npm run typecheck` | Type checks all three packages |
| `npm run cheatsheet` | Regenerates `docs/speaker-cheat-sheet.html` from the presets and cards |
| `npm run slides` | Regenerates the generated slides in `slides/` (see `slides/README.md`) |
| `npm run notes:draft` | Drafts `notes/speaker-notes.md` from the SAY passages of the human transcript; `-- --force` overwrites |
| `npm run gslides:notes` | Writes the notes file for a Google Slides export (see `slides/README.md`) |

`npm test` runs two suites:

- **Engine (`shared/test`)**: every talk beat (solo outcomes, overflow packing, audience credits,
  scope, privacy, injection, retrieval, final, auto-summarization, drift) runs through the assembler
  and the deterministic assistant and is checked for the expected outcome, trace and eval. Run it
  after any change to the cards, presets, assembler or assistant rules.
- **Server (`server/test`)**: starts the real HTTP and WebSocket server on a random port with a
  throwaway data directory and checks authentication, command routing, registration and reconnect,
  lobby parking, leaving, and that snapshots land in the configured directory.

`npm test` also fails when a heading in `notes/speaker-notes.md` no longer matches the run sheet.

The participant command list in `shared/src/types.ts` is checked for completeness at compile time,
so a new command that is not listed fails `npm run typecheck`.

## Running the talk

Open the console and put the display on the projector. `→` on the console does the next run sheet
step: everything the script has the speaker press before the next spoken line (take a slide down,
load a preset, flip a switch, invoke). `←` goes back one step. The notes view beside the display
follows the run sheet. Presets can also be loaded by hand from the console.

| Key (console) | Action |
|---|---|
| `→` / `←` | Next / previous run sheet step |
| `]` / `[` | Next / previous main preset |
| `T` | Start or pause the talk clock |
| `L` | Load the expected card state for the current phase |
| `R` | Reset the phase, keeping what participants chose |
| `F` | Freeze or unfreeze the audience |
| `V` | X-ray (card metadata) on or off for the whole room |
| Names switch (header) | Show first names in the display's "Just joined" line; off by default, numbers only |
| `S` / `X` / `Z` / `P` | Show or hide the slide; next slide; previous slide; back to the live view |

On the display window itself, `V` toggles X-ray locally, `I` the Context Inspector and `M` a
magnifier. The toolbar, the run sheet, the notes view, the talk clock, replay, participants and the
session export are described in `docs/spec-and-runbook.md`, sections 21 to 27; the per-preset
walkthrough is section 21 and the rehearsal protocol is section 51.

## Deploy to OpenShift

```bash
PROJECT=ctx-talk deploy/openshift/deploy.sh
```

The script creates the project when missing, builds the image in-cluster (or locally with
`IMAGE=<registry>/<repo>`), applies the templates and sets `PUBLIC_URL` from the Route so the QR
code points at it. Re-run it to ship changes. `deploy/openshift/deploy.sh delete` removes what a
deploy created. Options, secrets, certificates and removal are in `deploy/openshift/README.md`.

## Repository layout

```
shared/   types, the Atlas cards, presets, roles, run sheet, context assembler, deterministic assistant,
          prompt builder, replay timing; test/ runs every talk beat through the engine
server/   Express + ws server, in-memory store with snapshot and event log, per-role views, simulator,
          live model adapter, notes file; test/ exercises the socket layer
client/   Vite + React: participant app, display, speaker console, facilitator view, notes view
scripts/  cheatsheet.ts, show-slides.py, notes-from-script.ts, google-slides-notes.ts, google-slides-import.gs
notes/    speaker-notes.md, one note per run sheet step
slides/   the deck as images, served at /slides; src/ holds the fonts and artwork the generated slides embed
deploy/   OpenShift Templates and deploy script
docs/     spec and runbook, transcripts, Q&A backup, generated cheat sheet
```

## Releases

| Tag | Contents |
|---|---|
| `v1.0.0` | Rehearsed build |
| `v1.1.0` | Server tests |
| `v1.2.0` | All optional activities |
