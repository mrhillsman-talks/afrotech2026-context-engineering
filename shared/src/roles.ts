import type { RoleId } from "./types.js";

export interface RoleDef {
  id: RoleId;
  title: string;
  brief: string;
  cardId?: string;
  /** The holder never sends: the speaker's presets bring the card in, so the phone shows the role and card with no Send button. */
  waitForSpeaker?: boolean;
  ability?: "restore" | "summarize";
}

export const ROLES: RoleDef[] = [
  { id: "crm", title: "CRM Connector", brief: "You hold the customer contract. When connectors are asked to contribute, send it.", cardId: "ATLAS-002" },
  { id: "arch", title: "Architecture Repository", brief: "You hold ADR-019. Send it when asked.", cardId: "ATLAS-004" },
  { id: "monitoring", title: "Monitoring Tool", brief: "You are the infrastructure monitoring tool. You hold the live capacity reading. The speaker brings it in later, when the region's status changes.", cardId: "ATLAS-005", waitForSpeaker: true },
  { id: "stale-slack", title: "Stale Slack", brief: "You are a two-month-old Slack thread. Contribute like everyone else.", cardId: "ATLAS-006" },
  { id: "apollo", title: "Apollo Engineer", brief: "You know how Apollo runs. You are not doing anything wrong.", cardId: "APOLLO-001" },
  { id: "exec", title: "Executive Strategy", brief: "You hold the company's cloud strategy memo.", cardId: "ATLAS-007" },
  { id: "webpage", title: "Untrusted Webpage", brief: "You are a vendor web page from outside the company. The speaker brings your content in later.", cardId: "ATLAS-009", waitForSpeaker: true },
  { id: "private-memory", title: "Private User Memory", brief: "You are Alice's personal memory. Your card is private to Alice. The speaker brings it in later.", cardId: "PRIVATE-001", waitForSpeaker: true },
  { id: "long-term-memory", title: "Long-Term Memory", brief: "You can reintroduce a fact that was removed earlier.", ability: "restore" },
  { id: "summarizer", title: "Summarizer", brief: "You can propose a compressed version of one active card.", ability: "summarize" },
];

/** Preset 03: role Send buttons open this long after the phase starts, so the room reads its roles before cards fly in. */
export const ROLE_SEND_DELAY_MS = 10_000;

export const ROLE_BY_ID: Record<RoleId, RoleDef> = Object.fromEntries(ROLES.map((r) => [r.id, r])) as Record<RoleId, RoleDef>;

/** Roles are dealt in this order and repeated, so a small room still gets the important ones. */
export const ROLE_DEAL_ORDER: RoleId[] = [
  "crm", "monitoring", "arch", "apollo", "webpage", "stale-slack", "exec", "private-memory", "summarizer", "long-term-memory",
];
