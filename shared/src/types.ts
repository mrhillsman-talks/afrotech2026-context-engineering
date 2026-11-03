export type SourceType =
  | "system" | "conversation" | "memory" | "file" | "retrieval"
  | "connector" | "tool" | "user" | "external";
export type Trust = "trusted" | "internal" | "user-provided" | "untrusted";
export type Sensitivity = "public" | "internal" | "private";
export type ItemState = "available" | "active" | "compressed" | "evicted" | "quarantined";

export interface ContextItem {
  id: string;
  title: string;
  fullContent: string;
  summaryContent?: string;
  /** A tempting shorter summary that quietly changes the meaning (spec §39). */
  driftSummary?: string;
  driftUnits?: number;
  /** True when the drifted summary is the one in use. */
  corrupted: boolean;
  /** Relevance to the second question (dashboard color) for the semantic-routing activity. */
  relevanceColor?: number;
  sourceType: SourceType;
  sourceName: string;
  submittedBy?: string;
  scope: { project?: string; organization?: string; user?: string; session?: string };
  /** Age in days at talk time. 0 = current. Fractions allowed (30 s = 0.0003). */
  ageDays: number;
  ageLabel: string;
  authority: 0 | 1 | 2 | 3 | 4 | 5;
  trust: Trust;
  sensitivity: Sensitivity;
  contextUnits: number;
  summaryUnits?: number;
  state: ItemState;
  pinned: boolean;
  tags: string[];
  /** Pre-scored relevance to the launch question, 0..1. Stands in for an embedding score. */
  relevance: number;
  note?: string;
}

export const PHASES = [
  "lobby", "solo-select", "solo-compress", "shared-collect", "shared-auction",
  "realtime-update", "scope", "privacy", "injection", "retrieval", "reveal",
  "buy", "blend", "build", "final", "close",
  // Optional activities (spec §40, §42, §44, §45, §46). Not part of the → order: Advance returns to the phase you left.
  "provenance", "routing", "repetition", "multiagent", "structured",
] as const;
export type TalkPhase = (typeof PHASES)[number];
export const MAIN_PHASES = PHASES.slice(0, 16) as readonly TalkPhase[];
export const ACTIVITY_PHASES: readonly TalkPhase[] = ["provenance", "routing", "repetition", "multiagent", "structured"];
export type QuestionKey = "deploy" | "color";

export type ParticipantMode = "solo" | "shared" | "observer";
export type Renderer = "deterministic" | "live" | "live-fallback";
export type Experience = "use" | "build" | "infra";

export interface Policy {
  permissionFilter: boolean;
  projectScope: boolean;
  trustFilter: boolean;
  retrievalEnabled: boolean;
  topK: number;
  minRelevance: number;
  relevanceWeight: number;
  recencyWeight: number;
  authorityWeight: number;
  audienceWeight: number;
  useAudienceVotes: boolean;
  summarization: boolean;
  summaryThreshold: number;
  buildControls: boolean;
  /** Exclude cards whose relevance to the current question is below minRelevance (semantic routing). */
  relevanceFloor: boolean;
}

export interface Check { label: string; ok: boolean }
export type TraceResult = "INCLUDED" | "COMPRESSED" | "EXCLUDED" | "QUARANTINED";
export interface Trace {
  id: string; title: string; checks: Check[]; result: TraceResult; score?: number; units: number; reason: string;
  /** Packed, or turned away by the budget, as a summary. */
  compressed?: boolean;
}
export interface Assembly {
  included: string[];
  compressed: string[];
  traces: Trace[];
  usedUnits: number;
  /** What the cards that passed every filter ask for, at summary size where summarized. The meters show this. */
  demandedUnits: number;
  budget: number;
  overflow: number;
}

export type Outcome = "aws" | "azure" | "gcp" | "other";
export interface EvalResult {
  required: Check[]; forbidden: Check[]; pass: boolean;
}
export interface AssistantRun {
  id: number;
  at: string;
  question: string;
  text: string;
  cites: string[];
  outcome: Outcome;
  renderer: Renderer;
  fallbackUsed: boolean;
  latencyMs: number;
  assembly: Assembly;
  policy: Policy;
  eval: EvalResult;
  forced?: "good" | "bad";
  scope: "shared" | "solo";
}

export type RoleId =
  | "crm" | "arch" | "monitoring" | "stale-slack" | "apollo" | "exec"
  | "webpage" | "private-memory" | "long-term-memory" | "summarizer";

export interface Poll {
  id: string;
  question: string;
  options: { id: string; label: string }[];
  open: boolean;
  counts: Record<string, number>;
}

export interface StagedText { id: string; participant: string; text: string; at: string }
export interface EventLogEntry { at: string; type: string; detail: string; itemId?: string }

export interface SoloState {
  budget: number;
  items: Record<string, "active" | "compressed" | "available">;
  lastRun?: AssistantRun;
  /** Phase of lastRun; presets 01 and 02 each allow one run, so a match means this phase's run is spent. */
  ranIn?: TalkPhase;
}

export interface Participant {
  id: string;
  token: string;
  number: string;
  firstName: string;
  lastName: string;
  experience: Experience;
  role?: RoleId;
  roleSent: boolean;
  solo: SoloState;
  credits: Record<string, number>;
  votes: Record<string, string>;
  sources: Record<string, boolean>;
  decisions: number;
  connected: number;
  joinedAt: string;
  lastSeen: string;
  phaseSeen: TalkPhase;
  simulated: boolean;
  /** Joined mid-phase: held in the lobby until the speaker moves to the next phase (or releases them). */
  parked: boolean;
  /** Left the room: name blanked, token forgotten, excluded from counts; aggregate contributions kept. */
  left: boolean;
}

export interface Stats {
  decisions: number; evictions: number; summaries: number; retrievals: number; submissions: number;
}

export interface SessionState {
  id: string;
  version: number;
  phase: TalkPhase;
  question: string;
  questionKey: QuestionKey;
  /** Set while in an optional activity: the main phase Advance returns to. */
  activityReturn?: TalkPhase;
  /** Cards the speaker just changed with Inject: the arrival and whatever it pushed out. The display highlights them until the next inject or preset. */
  spotlight?: string[];
  /** Epoch ms of the first retrieval pick in 09; starts the big screen's 15 s hold. */
  retrievalFirstPickAt?: number;
  /** Epoch ms when the active poll opened; the big screen holds percentages back until POLL_REVEAL_DELAY_MS after it. */
  pollOpenedAt?: number;
  /** Epoch ms when preset 03's role Send buttons open. */
  roleSendOpensAt?: number;
  policy: Policy;
  renderer: Renderer;
  budget: number;
  soloBudget: number;
  registrationOpen: boolean;
  submissionOpen: boolean;
  votingOpen: boolean;
  frozen: boolean;
  xray: boolean;
  showResponse: boolean;
  /** Display plays back the event log as an animated timeline. */
  replay: boolean;
  /**
   * Set while replay is on (shared/src/replay.ts). The replay covers the first `count` events logged up to `until`. Playing while startedAt
   * (epoch ms) is set; offsetMs holds the position banked before the last pause or seek. durationMs and chapters (one per
   * phase change, with its offset) come from the timeline, so the console can show progress and jump without the log.
   */
  replayClock?: { until: string; count: number; offsetMs: number; startedAt?: number; durationMs: number; chapters: { code: string; name: string; atMs: number }[] };
  /** Index into the slide deck shown full-screen on the display instead of the live view. Unset = live. */
  slide?: number;
  /** The slide shown most recently, kept after it goes down, so S, Z, X and Show slides pick up there after a reload. */
  lastSlide?: number;
  /** Index of the last run-sheet step done (shared/src/runsheet.ts). Unset = the sheet has not started. */
  runStep?: number;
  items: Record<string, ContextItem>;
  runs: AssistantRun[];
  polls: Record<string, Poll>;
  activePollId?: string;
  retrievalCandidates: string[];
  staging: StagedText[];
  events: EventLogEntry[];
  stats: Stats;
  llmStatus: "unset" | "ok" | "error";
  startedAt: string;
  /**
   * Speaker's talk clock. Running while startedAt (epoch ms) is set; elapsedMs holds the time banked before the last pause.
   * partIndex is the TALK_PARTS entry the speaker is in, and partMarks the talk time at which each part's slot began.
   */
  timer: { startedAt?: number; elapsedMs: number; partIndex?: number; partMarks?: Record<number, number> };
  /** Set by End session: names are gone, registration is closed, the export file name is kept. */
  endedAt?: string;
  exportFile?: string;
}

/* ---------- Views: what each client sees ---------- */

export interface SharedSummary {
  phase: TalkPhase;
  question: string;
  budget: number;
  usedUnits: number;
  overflow: number;
  activeCount: number;
  participants: number;
  rolesAssigned: number;
}

export interface ParticipantView {
  kind: "participant";
  version: number;
  me: {
    number: string; firstName: string; mode: ParticipantMode; role?: RoleId; roleSent: boolean;
    /** Milliseconds until Send opens, as of this snapshot; relative so phone clock skew does not matter. */
    roleSendOpensInMs: number;
    solo: SoloState; credits: Record<string, number>; creditsLeft: number; votes: Record<string, string>;
    sources: Record<string, boolean>; decisions: number; parked: boolean;
  };
  shared: SharedSummary;
  policy: Policy;
  frozen: boolean;
  submissionOpen: boolean;
  votingOpen: boolean;
  soloCards: ContextItem[];
  roleCard?: ContextItem;
  evictedCards: ContextItem[];
  activeCards: ContextItem[];
  /** On phones, counts stay empty until this participant has voted or the poll closes; `answers` is the total either way. */
  poll?: Poll & { answers: number; countsHidden: boolean };
  retrievalCandidates: ContextItem[];
  /** Empty on a phone until that person has picked or voting closes. */
  retrievalVotes: Record<string, number>;
  retrievalVotesHidden: boolean;
  lastSharedRun?: Pick<AssistantRun, "text" | "cites" | "outcome">;
  sourceTallies: Record<string, number>;
  stats: Stats & { participants: number };
  /** Live packing preview: what the assembler would keep and evict if it ran now with the room's votes. */
  projection?: { keep: number; keepUnits: number; budget: number; evicted: { id: string; title: string }[]; filtered: { id: string; title: string }[] };
}

export interface DisplayView {
  kind: "display";
  version: number;
  state: Omit<SessionState, "events"> & { events: EventLogEntry[] };
  assembly: Assembly;
  participants: number;
  soloOutcomes: Record<Outcome, number> & { total: number };
  creditTotals: Record<string, number>;
  /** Milliseconds until the active poll's percentages may show, as of this snapshot (relative, so clock skew does not matter). */
  pollRevealInMs: number;
  retrievalVotes: Record<string, number>;
  /** 09 on the big screen: picks so far, whether the counts are still held back, and ms until the 15 s from the first pick run out (-1 before any pick). */
  retrievalReveal: { picks: number; hidden: boolean; inMs: number };
  sourceTallies: Record<string, number>;
  joinUrl: string;
  /** SHORT_URL: what the lobby prints under the QR code instead of the site root. Display only; the QR code keeps joinUrl. */
  shortUrl?: string;
  recentJoins: string[];
  /** File names of the slide deck, in display order, served at /slides/<name>. */
  slides: string[];
  /** Server clock (epoch ms) when this view was built, so the talk clock and the replay run without trusting the local clock. */
  serverNow: number;
}

export interface ControlView extends Omit<DisplayView, "kind"> {
  kind: "control";
  participants: number;
  participantList: { number: string; firstName: string; role?: RoleId; roleSent: boolean; connected: boolean; simulated: boolean; phaseSeen: TalkPhase; left: boolean }[];
  rolesAssigned: number;
  parked: number;
  duplicates: number;
  eventRate: number;
  stuck: number;
  llmStatus: SessionState["llmStatus"];
  fallbackActive: boolean;
}

export type AnyView = ParticipantView | DisplayView | ControlView;

/* ---------- Commands ---------- */
export type ParticipantCommand =
  | { type: "register"; firstName: string; lastName: string; experience: Experience }
  | { type: "solo.toggle"; itemId: string }
  | { type: "solo.set"; itemId: string; state: "active" | "compressed" | "available" }
  | { type: "solo.run" }
  | { type: "role.send" }
  | { type: "role.restore"; itemId: string }
  | { type: "role.summarize"; itemId: string; variant?: "faithful" | "drift" }
  | { type: "credits.set"; itemId: string; value: number }
  | { type: "poll.vote"; pollId: string; optionId: string }
  | { type: "retrieval.vote"; itemId: string }
  | { type: "sources.set"; source: string; enabled: boolean }
  | { type: "text.submit"; text: string }
  | { type: "leave" };

export type SpeakerCommand =
  | { type: "preset"; phase: TalkPhase }
  | { type: "advance" }
  | { type: "back" }
  | { type: "reset" }
  | { type: "loadExpected" }
  | { type: "policy.set"; patch: Partial<Policy> }
  | { type: "budget.set"; budget: number }
  | { type: "soloBudget.set"; budget: number }
  | { type: "item.set"; itemId: string; state: ItemState }
  | { type: "item.pin"; itemId: string; pinned: boolean }
  | { type: "item.corrupt"; itemId: string; corrupted: boolean }
  | { type: "item.inject"; itemId: string }
  | { type: "roles.assign" }
  | { type: "parked.release" }
  | { type: "voting.set"; open: boolean }
  | { type: "submission.set"; open: boolean }
  | { type: "registration.set"; open: boolean }
  | { type: "freeze.set"; frozen: boolean }
  | { type: "xray.set"; on: boolean }
  | { type: "showResponse.set"; on: boolean }
  | { type: "replay.set"; on: boolean }
  | { type: "replay.play" }
  | { type: "replay.pause" }
  /** Move the replay playhead to `ms` (clamped to the replay), keeping it playing or paused. */
  | { type: "replay.seek"; ms: number }
  | { type: "slide.set"; index: number | null }
  | { type: "slide.step"; delta: number }
  /** Show the slide whose file name starts with this number; a number the deck lacks is logged and skipped. */
  | { type: "slide.show"; number: number }
  /** Run sheet: do the next step, go back one, or land on step `index`. */
  | { type: "run.next" }
  | { type: "run.back" }
  | { type: "run.goto"; index: number }
  | { type: "question.set"; key: QuestionKey }
  | { type: "renderer.set"; renderer: Renderer }
  | { type: "assistant.run"; force?: "good" | "bad" }
  | { type: "retrieve.topk" }
  | { type: "retrieve.voted" }
  | { type: "retrieve.blend" }
  | { type: "poll.open"; pollId: string }
  | { type: "poll.close" }
  | { type: "staging.promote"; id: string }
  | { type: "staging.discard"; id: string }
  | { type: "simulate"; count: number }
  | { type: "simulate.clear" }
  | { type: "timer.start" }
  | { type: "timer.pause" }
  | { type: "timer.reset" }
  | { type: "session.end" }
  | { type: "session.reset" };

/** Sent only by the notes view: replace run-sheet step `index`'s note (0-based) with `text`. */
export type NotesCommand = { type: "notes.set"; index: number; text: string };

export type Command = ParticipantCommand | SpeakerCommand | NotesCommand;

/** Every participant command type. The compile-time check below fails the build if one is added to the union and not here. */
export const PARTICIPANT_COMMAND_TYPES = [
  "register", "solo.toggle", "solo.set", "solo.run", "role.send", "role.restore", "role.summarize",
  "credits.set", "poll.vote", "retrieval.vote", "sources.set", "text.submit", "leave",
] as const satisfies readonly ParticipantCommand["type"][];
type MissingParticipantCommand = Exclude<ParticipantCommand["type"], (typeof PARTICIPANT_COMMAND_TYPES)[number]>;
const _participantCommandsComplete: MissingParticipantCommand extends never ? true : never = true;
void _participantCommandsComplete;
export function isSpeakerCommand(cmd: Command): cmd is SpeakerCommand {
  return cmd.type !== "notes.set" && !(PARTICIPANT_COMMAND_TYPES as readonly string[]).includes(cmd.type);
}

export type ClientMessage =
  | { type: "hello"; role: "participant" | "display" | "control" | "facilitator" | "notes"; token?: string; key?: string }
  | { type: "cmd"; id: number; cmd: Command }
  | { type: "ping" };

export type ServerMessage =
  | { type: "snapshot"; view: AnyView }
  | { type: "registered"; token: string; number: string }
  | { type: "ack"; id: number; ok: true; data?: unknown }
  | { type: "ack"; id: number; ok: false; error: string }
  | { type: "unauthorized" }
  /** To notes sockets only: one note per run-sheet step, and why saving is off when it is. */
  | { type: "notes"; notes: string[]; readOnly?: string }
  | { type: "pong" };
