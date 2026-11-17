/**
 * kobo (酵母, yeast) — individual agent lifecycle layer, local domain
 * (AWAI-3079).
 *
 * Designed from the former Worker's method list (spawnAgent / budAgent /
 * sporulate / ferment / getAgent); the original logic ran on a remote
 * LangServer and was not in this repository.
 *
 * Lifecycle, after budding yeast:
 *   spawn     → a generation-0 agent, "active".
 *   bud       → an active parent produces a child one generation deeper. Every
 *               bud leaves a bud scar; at BUD_SCAR_LIMIT scars the parent
 *               becomes "senescent" and cannot bud again (replicative aging).
 *   sporulate → an active agent becomes a dormant "spore".
 *   ferment   → an active or senescent agent turns substrate into product.
 *               Spores do not ferment.
 */
import type { LocalStore } from "../local-store.js";
import { getOne, idSlug, isNonEmpty, nowISO, put } from "./records.js";

export const AGENT = "cloud.itonami.apps.kobo.agent";
export const FERMENT = "cloud.itonami.apps.kobo.fermentation";
export const BUD_SCAR_LIMIT = 20;
/** Product per unit of substrate (glucose → ethanol is about 0.51 by mass). */
export const YIELD = 0.51;

export type AgentState = "active" | "senescent" | "spore";
export interface Agent {
  agentId: string; name: string; generation: number; parentId?: string; state: AgentState;
  budScars: number; children: string[]; fermented: number; produced: number; createdAt: string; updatedAt: string;
}

export interface SpawnAgentInput { agentId: string; name: string }
export interface BudAgentInput { parentId: string; childId: string; name?: string }
export interface SporulateInput { agentId: string }
export interface FermentInput { fermentId: string; agentId: string; substrate: string; amount: number }
export interface GetAgentInput { agentId: string }

const key = (id: string) => `agent-${idSlug(id)}`;
const load = (e: LocalStore, id: string) => getOne<Agent>(e, AGENT, key(id));

export async function spawnAgent(e: LocalStore, input: SpawnAgentInput) {
  if (!isNonEmpty(input.agentId) || !isNonEmpty(input.name)) return { status: "rejected", error: "missingRequiredFields" };
  if (await load(e, input.agentId)) return { status: "alreadyExists" };
  const now = nowISO();
  const agent: Agent = { agentId: input.agentId, name: input.name, generation: 0, state: "active", budScars: 0, children: [], fermented: 0, produced: 0, createdAt: now, updatedAt: now };
  return { status: "spawned", agentUri: await put(e, AGENT, key(input.agentId), agent), generation: 0 };
}

export async function budAgent(e: LocalStore, input: BudAgentInput) {
  if (!isNonEmpty(input.parentId) || !isNonEmpty(input.childId)) return { status: "rejected", error: "missingRequiredFields" };
  const parent = await load(e, input.parentId);
  if (!parent) return { status: "rejected", error: "parentNotFound" };
  if (parent.value.state !== "active") return { status: "rejected", error: `parentIs${parent.value.state[0].toUpperCase()}${parent.value.state.slice(1)}` };
  if (await load(e, input.childId)) return { status: "rejected", error: "childIdExists" };
  const now = nowISO();
  const child: Agent = { agentId: input.childId, name: input.name || `${parent.value.name}′`, generation: parent.value.generation + 1, parentId: input.parentId, state: "active", budScars: 0, children: [], fermented: 0, produced: 0, createdAt: now, updatedAt: now };
  await put(e, AGENT, key(input.childId), child);
  const scars = parent.value.budScars + 1;
  const updated: Agent = { ...parent.value, budScars: scars, children: [...parent.value.children, input.childId], state: scars >= BUD_SCAR_LIMIT ? "senescent" : "active", updatedAt: now };
  await put(e, AGENT, key(input.parentId), updated);
  return { status: "budded", childId: input.childId, generation: child.generation, parentBudScars: scars, parentState: updated.state };
}

export async function sporulate(e: LocalStore, input: SporulateInput) {
  const agent = isNonEmpty(input.agentId) ? await load(e, input.agentId) : null;
  if (!agent) return { status: "rejected", error: "agentNotFound" };
  if (agent.value.state === "spore") return { status: "alreadySpore" };
  if (agent.value.state !== "active") return { status: "rejected", error: "onlyActiveAgentsSporulate" };
  await put(e, AGENT, key(input.agentId), { ...agent.value, state: "spore", updatedAt: nowISO() });
  return { status: "sporulated", agentId: input.agentId };
}

export async function ferment(e: LocalStore, input: FermentInput) {
  if (!isNonEmpty(input.fermentId) || !isNonEmpty(input.agentId) || !isNonEmpty(input.substrate)) return { status: "rejected", error: "missingRequiredFields" };
  if (typeof input.amount !== "number" || !(input.amount > 0)) return { status: "rejected", error: "amountMustBePositive" };
  const agent = await load(e, input.agentId);
  if (!agent) return { status: "rejected", error: "agentNotFound" };
  if (agent.value.state === "spore") return { status: "rejected", error: "sporesAreDormant" };
  if (await getOne(e, FERMENT, `ferment-${idSlug(input.fermentId)}`)) return { status: "alreadyExists" };
  const product = Math.round(input.amount * YIELD * 1000) / 1000;
  await put(e, FERMENT, `ferment-${idSlug(input.fermentId)}`, { ...input, product, fermentedAt: nowISO() });
  await put(e, AGENT, key(input.agentId), { ...agent.value, fermented: agent.value.fermented + input.amount, produced: Math.round((agent.value.produced + product) * 1000) / 1000, updatedAt: nowISO() });
  return { status: "fermented", product, totalProduced: Math.round((agent.value.produced + product) * 1000) / 1000 };
}

export async function getAgent(e: LocalStore, input: GetAgentInput) {
  const agent = isNonEmpty(input.agentId) ? await load(e, input.agentId) : null;
  if (!agent) return { status: "notFound" };
  return { status: "ok", agent: agent.value, budsLeft: Math.max(0, BUD_SCAR_LIMIT - agent.value.budScars) };
}
