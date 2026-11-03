# Context Window Live

The interactive app for the talk **Context Engineering: AI productivity in your day to day**.
The audience joins from their phones and operates the assistant's context window: they
experience selection, compression, scope, privacy, prompt injection, retrieval and
policy for the fictional Project Atlas launch.

## Contents

- [Resources](#resources)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Development and tests](#development-and-tests)
- [Deploy to OpenShift](#deploy-to-openshift-public-url-fallback)
- [Running the talk](#during-the-talk)
- [Speaker cheat sheet and show slides](#speaker-cheat-sheet)
- [Speaker notes](#speaker-notes)
- [Rehearsal checklist](#rehearsal-checklist-spec-51)
- [Repository layout](#layout)

## Resources

| What | Where |
|---|---|
| Spec and speaker runbook | `docs/spec-and-runbook.md` |
| Printable run of show | `docs/speaker-cheat-sheet.html` |
| Spoken script | `docs/speaker-transcript.md` |
| Slide numbering | `slides/README.md` |

## Quick start

```bash
npm install
npm run build
npm start
```

The server prints five URLs:

| Surface | URL |
|---|---|
| Participants (QR target) | `http://<lan-ip>:3000/session/main` |
| Projected display | `http://<lan-ip>:3000/session/main/display` |
| Speaker console | `http://<lan-ip>:3000/session/main/control?key=<SPEAKER_KEY>` |
| Facilitator / debug | `http://<lan-ip>:3000/session/main/facilitator?key=<SPEAKER_KEY>` |
| Speaker notes | `http://<lan-ip>:3000/session/main/notes?key=<SPEAKER_KEY>` |

## Configuration

Copy `.env.example` to `.env` and set `SPEAKER_KEY`. `.env` is read once at startup, so restart
the server after editing it.

### Live model (optional)

Without any of this the app runs fully offline in deterministic mode, and every live failure or
timeout (8 s by default) falls back to the canned answer.

| Variable | Purpose |
|---|---|
| `LLM_PROVIDER` | `anthropic`, `openai`, `openai-responses`, `openai-compatible` or `ollama` |
| `LLM_MODEL` | the model to use |
| `LLM_API_KEY` | the key. `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` also work, and on their own they select that provider |
| `LLM_BASE_URL` | required for `openai-compatible`: the server's `/v1` root (Ollama's `/v1`, LM Studio, vLLM, llama.cpp, OpenRouter, Groq). For `ollama` it overrides the native API address, `http://localhost:11434` by default; no key is needed locally |
| `LLM_EFFORT` | reasoning effort, where the API has one |

### Public URL and QR code

| Variable | Purpose |
|---|---|
| `PUBLIC_URL` | where the QR code points when that is not your LAN address. A path in it (`https://host/talk`) makes the app serve itself under that prefix |
| `BASE_PATH` | overrides the prefix, for a proxy that strips it before forwarding |
| `SHORT_URL` | replaces only the text printed under the QR code (a short link, say); the QR code still encodes `PUBLIC_URL` |

### Speaker notes

| Variable | Purpose |
|---|---|
| `NOTES_FILE` | the notes file, `notes/speaker-notes.md` by default (see [Speaker notes](#speaker-notes)) |
| `NOTES_READONLY` | `1` turns saving off; the notes view still shows the notes |

### Persistence

State is kept in memory and snapshotted to `data/snapshot.json` every two seconds, so a server
restart keeps the room. The event log is appended to `data/events.ndjson`. `npm run fresh` starts
with a clean session.

## Development and tests

| Command | What it does |
|---|---|
| `npm run dev` | hot reload: Vite on :5173 proxies to the server on :3000 |
| `npm test` | engine suite, then server suite (below) |
| `npm run typecheck` | type checks; fails if a participant command is missing from the list in `shared/src/types.ts` |
| `npm run cheatsheet` | regenerates the speaker cheat sheet |
| `npm run notes:draft` | drafts `notes/speaker-notes.md` from the spoken script; `-- --force` overwrites it |

`npm test` runs two suites:

- **Engine (`shared/test`)**: every talk beat (solo outcomes, overflow packing, audience credits,
  scope, privacy, injection, retrieval, final, auto-summarization, drift) is run through the
  assembler and deterministic assistant and checked for the expected outcome, trace and eval result.
  Run it after any change to the cards, presets, assembler or assistant rules.
- **Server (`server/test`)**: starts the real HTTP and WebSocket server on a random port with a
  throwaway data directory and checks authentication, command routing (every participant command
  type against the speaker gate), registration and reconnect, lobby parking, leaving, and that
  snapshots land in the configured directory.

The participant command list in `shared/src/types.ts` is checked for completeness at compile time,
so a new command that is not listed fails `npm run typecheck`.

## Deploy to OpenShift (public URL fallback)

```bash
oc login ...
PROJECT=ctx-talk deploy/openshift/deploy.sh
```

Every setting is an environment variable; unset ones take the defaults. The script:

1. creates the project when it is missing;
2. creates the `<NAME>-secrets` secret from your environment or `.env` on the first run
   (`REFRESH_SECRET=1` rewrites it when the speaker key or the model settings change);
3. gets an image (see [Image source](#image-source));
4. renders `deploy/openshift/app.yaml` with `oc process` (an OpenShift Template: PVC, one-replica
   Deployment, Service, edge-TLS Route with a long WebSocket timeout) and applies it;
5. sets `PUBLIC_URL` from the Route so the QR code points at it.

Re-run it to ship changes. See also `deploy/openshift/README.md`.

### Settings

| Variable | Default | What it sets |
|---|---|---|
| `PROJECT` (or `NAMESPACE`) | the current project | project to deploy into, created when missing |
| `NAME` | `ctx-audience-app` | name of every object; two names run two independent rooms in one project |
| `ROUTE_HOST` | generated `<NAME>-<PROJECT>.<apps domain>` | the Route's hostname; a name outside the apps domain needs DNS to the router and usually a certificate |
| `ROUTE_PATH` | none | path prefix such as `/talk` to share a hostname; the app serves itself under it, so the join URL becomes `https://<host>/talk/session/main` |
| `ROUTE_TIMEOUT` | `1h` | HAProxy timeout; sockets idle between phases |
| `ROUTE_TLS_CERT_FILE`, `ROUTE_TLS_KEY_FILE`, `ROUTE_TLS_CA_FILE` | the router's certificate | PEM files for the Route's edge TLS |
| `PUBLIC_URL` | `https://<route host><ROUTE_PATH>` | QR target, when another name fronts the Route |
| `SHORT_URL` | the site root | lobby text under the QR code only, e.g. a short link; changes nothing else |
| `NOTES_READONLY` | `1` | `1` turns saving speaker notes off; the notes view shows the `notes/speaker-notes.md` built into the image. `0` saves into the container's copy, which the next deploy or restart replaces |
| `STORAGE_CLASS`, `STORAGE_SIZE` | cluster default, `1Gi` | the data volume; both are fixed once the claim exists |
| `CPU_REQUEST`, `MEMORY_REQUEST`, `CPU_LIMIT`, `MEMORY_LIMIT` | `100m`, `128Mi`, `1`, `512Mi` | container resources |
| `IMAGE`, `PLATFORM`, `TAG` | in-cluster build, `linux/amd64`, git short SHA | image source, below |

Example:

```bash
PROJECT=talks NAME=ctx-rehearsal ROUTE_HOST=talks.example.com ROUTE_PATH=/ctx STORAGE_CLASS=gp3-csi deploy/openshift/deploy.sh
```

### Image source

By default the script uses an in-cluster binary build (`deploy/openshift/build.yaml`). If the
cluster has no Build capability (the error mentions `serviceaccounts "builder" not found`), build
locally instead and push to any registry you can reach:

```bash
podman login quay.io
IMAGE=quay.io/<you>/ctx-audience-app deploy/openshift/deploy.sh
```

- **Tags.** Either way the image is tagged with the git short SHA (`-dirty` appended when the
  working tree has uncommitted changes), so every deploy gives the Deployment a new image reference
  and the cluster pulls it. `latest` is updated too. Set `TAG` to override.
- **Platform.** `PLATFORM` defaults to `linux/amd64`; set it to `linux/arm64` for Arm nodes.
- **Private registries.** A private repository gets a pull secret made from podman's auth file and
  linked to the project's default service account.

### Data and cleanup

- The room's snapshot lives on the PVC, so a pod restart keeps state.
  `oc exec deploy/<NAME> -- rm data/snapshot.json` followed by a restart gives a clean room.
- Every object a deploy creates carries the label `ctx-audience-app/deployed-set=<NAME>`. The
  script prints the label after the URLs, with the command that removes the set by that label.
- `deploy/openshift/deploy.sh delete` does the same after listing the set and asking. Both delete
  the volume claim and the room's data with it, unless the script is run with `KEEP_DATA=1`.

## During the talk

### Console basics

- **Presets 00–15** map to the runbook phases. Selecting one atomically sets phase, policy,
  budget, card states, polls and participant mode. `]` advances and `[` goes back.
- **Load expected state** (`L`) restores the canonical card state for the current phase without
  changing the phase. Use it whenever an audience phase gets chaotic.
- **Reset phase** (`R`) restores the cards, policy and polls for the current phase but keeps what
  participants already chose (credits, votes, solo selections). Picking a different preset resets those.
- **Invoke assistant** runs the assembler over the current window with the current policy.
  "Force good" / "Force bad" show a predefined answer. "Disable live model" pins deterministic mode.
- **Simulate N** adds simulated participants who select, vote and contribute realistically so the
  whole talk works with zero real attendees. **Clear sims** removes only the simulated participants.
- **Staging.** Free-text submissions land here; nothing reaches the model until you promote it.
- **Secret roles** are dealt automatically on entering 03 Shared chaos (about 20% of the room,
  always including CRM, Monitoring, Architecture, Apollo and the untrusted webpage).
  "Monitoring", "Untrusted webpage" and "Private memory" holders are told to wait for you;
  you can also inject those cards yourself from the console.
- **Metadata overlay.** `V` toggles it on the console; on the display, `V` toggles it locally and
  `I` opens the Context Inspector next to the assistant's answer.
- **Speaker notes.** The [notes view](#notes-view) shows the note for the run sheet's current step
  beside the display and follows `→`, `←`, presets loaded by hand and slides put up by hand.

### Talk clock

`T`, or Start, Pause and Reset beside it, in the middle of the console header.

- The large figure counts down the current part's slot from when the speaker entered the part:
  green, yellow in the last 30 seconds, red once it runs out.
- A small line counts the whole talk up to 40:00 next to the part's start mark.
- The part comes from the loaded preset or the slide on the display, whichever is later; the marks
  are the transcript's, in `TALK_PARTS` in `shared/src/presets.ts`.
- The time and the part marks live with the session, so a refresh or a server restart keeps them.

### Slides

The deck lives in `slides/` as one image per slide (PNG, JPG, WebP, GIF or SVG), ordered by file
name with numbers compared numerically; `SLIDES_DIR` in `.env` points elsewhere.

- **Structure.** It follows the cheat sheet in six parts. The exported AfroTech slides open and
  close the talk, and each part has a SETUP slide (the idea, and what the room does in its presets)
  before a live stretch of two or three presets and a LESSONS slide after it, so people who only
  watch can follow without a slide every two minutes. A legend slide before the lobby explains
  cards, units and the window, and a recap follows part 6. Each generated slide's corner names the
  presets to run with it.
- **Controls.** The console shows the deck as a thumbnail strip: click a thumbnail, or press `S`
  to show or hide the current slide, `X` and `Z` to move forward and back, `P` or **Live view** to
  return the display to the phase view.
- **Behavior.** It is one deck you can jump into at any point; the room keeps running underneath,
  so you can set up the next phase behind a slide and reveal it when ready. Files added while the
  server runs appear on the console within a refresh, no restart needed.

### Optional activities

**A1 to A5** sit below the main presets. They are outside the `]` order: **Advance** from an
activity returns to the phase you left.

| Activity | What happens |
|---|---|
| **A1 Provenance challenge (§40)** | Shows the same sentence three times with sources hidden, the room votes, and `V` on the display reveals contract, Slack message and vendor webpage. |
| **A2 Semantic routing (§46)** | Enables a relevance floor and lets you switch the question between deployment and dashboard color from the console; the window re-assembles live and Invoke answers each question from what survived. |
| **A3 Poisoning by repetition (§42)** | Puts five low-authority "Azure preferred" cards that copied each other against one contract. Invoke stays AWS while the contract is present; Evict contract and Invoke again to watch the copies win and the eval flag it. |
| **A4 Multi-agent coordinator (§44)** | Display slide with a poll: three agent findings against an 80-unit coordinator. |
| **A5 Structured context (§45)** | Display slide with a poll: the contract as prose versus JSON. |

### Summary corruption (spec §39)

The Summarizer role can compress a card with either the faithful summary or a tempting shorter one
that quietly changes its meaning (the contract's "requires AWS and U.S. residency" becomes
"prefers U.S.-based hosting"). You can do the same from the console with the **Drift** button on
the contract, security policy or approval cards.

Run the assistant: the hard constraint becomes a preference, the answer follows it, the Inspector
shows "summary fidelity: meaning drifted", and the eval fails on "constraint not softened to a
preference". Ask: what did compression cost us?

### Replay

**Replay event log on display** (policy pane) plays the session's event log back in about 45 s,
whatever the room size. The phase strip lights up in order, every card changes state as it did
during the talk, counters and the latest assistant run tick along, and the last events scroll by.

- Joins, leaves and solo runs that arrive in a row play as one frame of up to 2.4 s with one line,
  for example "100 participants joined" or "58 solo runs: 35 AWS · 23 AZURE".
- Run-sheet steps, renderer changes and other bookkeeping events take no time and print no line.
- Every other event shows for 0.3 to 1.2 s, depending on how many there are.

At the end, the card grid shows the cards as preset 14 left them (preset 15's reset is skipped),
and the evictions, summaries and retrievals tiles show the same numbers as the Close stats screen.
The server logs a `stats` event at each preset load and after each assistant run; the tiles count
from the latest one, so solo choices show up as a step at each phase change.

While replay is on, the console shows the playhead under the switch, with **Play/Pause**,
**Restart**, **−5 s**, **+5 s**, **End**, and one button per phase change (`01`, `02`, …) that
jumps to it. **Play** at the end starts over. The playhead runs on the server's clock, so every
display shows the same moment and a reloaded display rejoins at the same point.

The replay covers the log up to the moment it started. To include later events, switch it off and
on again. Preset 15 starts it on its own. Selecting any other preset switches the display back to
live.

### Participants and the room

- **Late joiners are parked.** Anyone who registers while a phase is in progress sees a waiting
  screen and cannot act until the next preset; the console header shows "N waiting in lobby ·
  admit now" to let them in early. Joining during Lobby or Close never parks, and simulated
  participants are never parked.
- **Leave the room.** Every participant screen ends with a small "Leave the room" link. Leaving
  blanks the person's name immediately, forgets the phone's token (the next registration on that
  device gets a fresh number), and stops counting them as present. What they already voted stays in
  the room's totals, anonymously. The console header shows how many have left.
- **Reset session** (presets pane, and in the toolbar once a session has ended) starts a fresh room
  in place: every participant is removed, names deleted, phase, policy and cards reset,
  registration reopened. State is server-side, so closing browsers or redeploying does not do this.
- **End session** (bottom toolbar) writes `data/export-<time>.json` with the stats, every assistant
  run and its inclusion traces, poll and credit totals, anonymous per-participant decisions and the
  event log, then deletes every participant name and closes registration. "Download export" appears
  in the header; the file is also served at `/api/export?key=<SPEAKER_KEY>`.

### Facilitator view

Read-only and uses the speaker key: connections, duplicate sessions, event rate, stuck clients,
model and fallback status, participants by phase, recent events. It refreshes every three seconds,
so a second person can watch it without touching the console.

### Notes view

Uses the speaker key. The left side shows the note for the run sheet step the console is on and
changes when the console moves: `←` / `→`, a main preset loaded by hand (clicked, `[`, `]`,
**Reset phase**, or End session's move to 15 Close), or a slide put up by hand. **Reset phase**
takes the note back to the step that loads that preset. Steps that change the display without
moving the sheet (**Live view** or `P`, switches, Inject and Invoke clicked by
hand) keep the current note. The right side is the display in a 16:9 frame; it shows the server's
state, so `V`, `I` and `M` pressed in the projector window do not show there.

| Key | Action |
|---|---|
| `,` / `.` | previous / next step's note, without changing the display; a slide step shows its slide |
| `Home` | back to the step the console is on |
| `E` | edit the note |
| `⌘` / `Ctrl` + `Enter` | done editing |
| `D` | show or hide the display frame (the projector is not affected); hidden, the note takes the full width and a line above it names what is on the display and the next step. The **Display** button does the same, and the browser remembers the choice |
| `-` / `+` / `0` | smaller, larger, or default note text (40 to 180 px in steps of 10, 40 by default); also the **A−** and **A+** buttons |

Drag the divider between the note and the display to change their widths (the note takes 20 % to 80 %); double-click it for the default 40 %, or focus it and use `←` / `→`. The browser remembers the text size and the widths.

A note saves 0.8 s after the last keystroke, on blur, on Done, and before the view moves to another
step. When saving is off, the reason shows above the note and Edit is disabled. The view sends no
speaker commands.

## Speaker cheat sheet

`npm run cheatsheet` regenerates `docs/speaker-cheat-sheet.html` from the presets and cards: one
landscape page per section with the run of show (say, press, audience, expected card state, lesson)
grouped into the six parts of the talk, each headed by its cue line (the slides to put up, numbered
as the console strip numbers them, and the live stretches to run between them), the optional
activities from spec §39–46 with their status, and the card table. Print it from the browser.

## Show slides

`python3 scripts/show-slides.py` rewrites the generated slides in `slides/` from the copy at the
top of that file: one entry per part (eyebrow, title, its presets with what the room does, its
lessons), plus the title slide, whose speaker line is a placeholder to fill in, and the Context
Window Architecture statement slide before part 6. It embeds the Funnel
fonts and AfroTech artwork from `slides/src` so the display renders them offline.

Run it after changing a part's copy, and keep each lesson's text the same as its preset's so the
slide, the console and the cheat sheet agree. `docs/speaker-transcript.md` is the spoken script for
the same structure.

## Speaker notes

`notes/speaker-notes.md` holds one note per run sheet step, under a heading of the form
`## Step 12 · Part 2 · X-ray on` (step number from 1, the part, and the step's label in
`shared/src/runsheet.ts`). Text before the first heading is ignored. No line in a note may have the
heading form.

`npm run notes:draft` writes a first draft from the SAY passages of
`docs/speaker-transcript-human.md`: each step gets the SAY text between its own cue and the next
step's cue, with the script's line wraps joined into paragraphs. It prints a table of step, script
line, word count and label to check by hand, stops without writing if a step has no cue in the
script, and refuses to overwrite an existing file unless run with `-- --force`. IF, ROOM and SCREEN
text is not copied.

`npm test` fails when a heading's step, part or label no longer matches the run sheet, so a step
added to or renamed in `RUN_SHEET` needs the notes file updated in the same change.

The server reads the file at start, and again before a save when it changed on disk, so a save
keeps edits made outside the app. Only sockets that open with the speaker key as the `notes` role
receive the notes or may save one (`notes.set`). Saving is off when `NOTES_READONLY=1`, and when a
section no longer matches the run sheet, since writing the file back would drop that section's
text; fix the file and reload the notes view.

## Rehearsal checklist (spec §51)

- [ ] Zero participants: run every preset and Invoke assistant in each; use Simulate 10 and 200
- [ ] Unset the live model (`LLM_PROVIDER` and every key) and set renderer to "Live model": the answer still appears (fallback)
- [ ] Refresh the display and the console mid-phase: both rehydrate from the snapshot, and the talk clock keeps its time
- [ ] Open the participant page twice in one browser: the facilitator view counts a duplicate session
- [ ] Press `]` twice quickly: the state machine only ever moves one phase per press

## Layout

```
shared/   types, canonical Atlas cards, presets, context assembler, deterministic assistant, prompt builder;
          test/ runs every talk beat through the engine
server/   app.ts (Express + ws for a store), index.ts (env + listen), in-memory store with snapshot,
          per-role views, simulator, Claude adapter; test/ exercises the socket layer
client/   Vite + React: participant app, display, speaker console, facilitator view, notes view
scripts/  cheatsheet.ts generates docs/speaker-cheat-sheet.html from the presets and cards;
          notes-from-script.ts drafts notes/speaker-notes.md from the spoken script;
          show-slides.py generates the run-of-show slides
notes/    speaker-notes.md, one note per run sheet step
slides/   the deck as images, served at /slides and driven from the console; src/ holds the fonts
          and artwork the generated slides embed
deploy/   OpenShift Templates and deploy script
docs/     spec and runbook, generated cheat sheet
```

## Releases

Tags mark what was deployed: `v1.0.0` (rehearsed build), `v1.1.0` (server tests), `v1.2.0` (all optional activities).
