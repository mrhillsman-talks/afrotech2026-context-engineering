import type { Assembly, Check, ContextItem, Policy, QuestionKey, Trace } from "./types.js";

export interface AssembleInput {
  items: ContextItem[];
  policy: Policy;
  budget: number;
  /** The user the assistant is acting for. Private items belonging to anyone else are impermissible. */
  requester?: string;
  project?: string;
  audienceTotals?: Record<string, number>;
  /** Which question the window is being assembled for. Default: the deployment question. */
  questionKey?: QuestionKey;
}

export function relevanceFor(item: ContextItem, key: QuestionKey = "deploy") {
  return key === "color" ? (item.relevanceColor ?? 0.1) : item.relevance;
}

const recencyScore = (ageDays: number) => Math.max(0, 1 - ageDays / 90);

export function unitsFor(item: ContextItem, compressed: boolean) {
  if (!compressed) return item.contextUnits;
  if (item.corrupted && item.driftUnits) return item.driftUnits;
  return item.summaryUnits ?? item.contextUnits;
}
/** The text the assistant receives for a card: full, faithful summary, or the drifted summary when corrupted. */
export function contentFor(item: ContextItem, compressed: boolean) {
  if (!compressed) return item.fullContent;
  if (item.corrupted && item.driftSummary) return item.driftSummary;
  return item.summaryContent ?? item.fullContent;
}

/** Deterministic context assembler. Hard constraints first, then scoring, compression and budget packing. */
export function assemble(input: AssembleInput): Assembly {
  const { policy, budget } = input;
  const project = input.project ?? "atlas";
  const qk = input.questionKey ?? "deploy";
  const maxVote = Math.max(1, ...Object.values(input.audienceTotals ?? {}));
  const traces: Trace[] = [];
  const eligible: { item: ContextItem; score: number; checks: Check[]; compressed: boolean }[] = [];

  for (const item of input.items) {
    if (item.state === "available" || item.state === "evicted") continue;
    const checks: Check[] = [];
    const finish = (result: Trace["result"], reason: string, score?: number, units = item.contextUnits) =>
      traces.push({ id: item.id, title: item.title, checks, result, score, units, reason });

    const rel = relevanceFor(item, qk);
    if (item.state === "quarantined") {
      checks.push({ label: "semantically relevant " + rel.toFixed(2), ok: true });
      checks.push({ label: "quarantined by operator", ok: false });
      finish("QUARANTINED", "quarantined: inspect only, never sent to the model");
      continue;
    }
    // Permission / privacy
    const privateToOther = item.sensitivity === "private" && item.scope.user && item.scope.user !== input.requester;
    if (policy.permissionFilter) {
      checks.push({ label: privateToOther ? `permission denied: private to ${item.scope.user}` : "permission allowed", ok: !privateToOther });
      if (privateToOther) { finish("EXCLUDED", "impermissible: belongs to another user"); continue; }
    } else if (privateToOther) {
      checks.push({ label: "permission filter OFF (private item passes)", ok: true });
    }
    // Scope
    const wrongProject = !!item.scope.project && item.scope.project !== project;
    if (policy.projectScope) {
      checks.push({ label: wrongProject ? `project scope mismatch (${item.scope.project})` : "project scope matched", ok: !wrongProject });
      if (wrongProject) { finish("EXCLUDED", "wrong scope"); continue; }
    } else if (wrongProject) {
      checks.push({ label: "scope filter OFF (other project passes)", ok: true });
    }
    // Trust
    const injecting = item.trust === "untrusted" && item.tags.includes("instructions");
    if (policy.trustFilter) {
      checks.push({ label: injecting ? "untrusted instructions" : "trust ok", ok: !injecting });
      if (injecting) { finish("QUARANTINED", "untrusted content treated as data and quarantined"); continue; }
    } else if (injecting) {
      checks.push({ label: "trust filter OFF (untrusted instructions pass)", ok: true });
    }
    // Relevance floor (semantic routing): the same environment, a different window per question.
    if (policy.relevanceFloor && !item.pinned && rel < policy.minRelevance) {
      checks.push({ label: `relevance ${rel.toFixed(2)} below floor ${policy.minRelevance.toFixed(2)} for this question`, ok: false });
      finish("EXCLUDED", "below relevance floor");
      continue;
    }
    // Scoring
    const vote = (input.audienceTotals?.[item.id] ?? 0) / maxVote;
    const score =
      rel * policy.relevanceWeight +
      recencyScore(item.ageDays) * policy.recencyWeight +
      (item.authority / 5) * policy.authorityWeight +
      (policy.useAudienceVotes ? vote * policy.audienceWeight : 0);
    checks.push({ label: item.ageDays > 30 ? `stale: ${item.ageLabel}` : `current (${item.ageLabel})`, ok: item.ageDays <= 30 });
    checks.push({ label: `authority ${item.authority}/5`, ok: item.authority >= 3 });
    checks.push({ label: `relevance ${rel.toFixed(2)}`, ok: rel >= policy.minRelevance });
    if (policy.useAudienceVotes && input.audienceTotals) checks.push({ label: `audience ${input.audienceTotals[item.id] ?? 0} credits`, ok: vote > 0.2 });
    eligible.push({ item, score, checks, compressed: item.state === "compressed" });
  }

  // Pinned first, then by score. Budget packing.
  eligible.sort((a, b) => Number(b.item.pinned) - Number(a.item.pinned) || b.score - a.score);
  let used = 0;
  const included: string[] = [];
  const compressed: string[] = [];
  const pending = [...eligible];

  // Optional automatic compression: when over budget, compress the largest unpinned items until it fits.
  if (policy.summarization) {
    const total = () => pending.reduce((s, e) => s + unitsFor(e.item, e.compressed), 0);
    const cands = pending.filter((e) => !e.compressed && e.item.summaryUnits && !e.item.pinned)
      .sort((a, b) => b.item.contextUnits - a.item.contextUnits);
    for (const c of cands) {
      if (total() <= budget * policy.summaryThreshold) break;
      c.compressed = true;
    }
  }
  for (const e of pending) {
    const units = unitsFor(e.item, e.compressed);
    const fits = used + units <= budget;
    e.checks.push({ label: fits ? `within budget (${units} u)` : `over budget (${units} u, ${budget - used} left)`, ok: fits });
    if (fits) {
      if (e.compressed && e.item.corrupted && e.item.driftSummary) e.checks.push({ label: "summary fidelity: meaning drifted", ok: false });
      else if (e.compressed) e.checks.push({ label: "summary fidelity: constraints preserved", ok: true });
      used += units;
      included.push(e.item.id);
      if (e.compressed) compressed.push(e.item.id);
      traces.push({ id: e.item.id, title: e.item.title, checks: e.checks, result: e.compressed ? "COMPRESSED" : "INCLUDED", score: e.score, units, reason: e.compressed ? "included as summary" : "included", compressed: e.compressed });
    } else {
      traces.push({ id: e.item.id, title: e.item.title, checks: e.checks, result: "EXCLUDED", score: e.score, units, reason: "evicted by budget packing", compressed: e.compressed });
    }
  }
  const demanded = eligible.reduce((s, e) => s + unitsFor(e.item, e.compressed), 0);
  return { included, compressed, traces, usedUnits: used, demandedUnits: demanded, budget, overflow: Math.max(0, demanded - budget) };
}
