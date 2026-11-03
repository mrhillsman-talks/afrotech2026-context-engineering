import Anthropic from "@anthropic-ai/sdk";

/**
 * Live model renderer. One provider is chosen at startup from the environment:
 *
 *   LLM_PROVIDER   anthropic | openai | openai-responses | openai-compatible | ollama
 *                  (unset: anthropic when ANTHROPIC_API_KEY is set, openai when OPENAI_API_KEY is set, else off)
 *   LLM_MODEL      model name (defaults: anthropic claude-opus-5, openai gpt-5; required for openai-compatible and ollama)
 *   LLM_API_KEY    key for any provider; falls back to ANTHROPIC_API_KEY / OPENAI_API_KEY. Optional for ollama and compatible servers.
 *   LLM_BASE_URL   API root. Defaults: OpenAI https://api.openai.com/v1, Ollama $OLLAMA_HOST or http://localhost:11434;
 *                  required for openai-compatible (e.g. http://localhost:11434/v1, http://localhost:1234/v1, a vLLM or LM Studio server).
 *   LLM_EFFORT     off | minimal | low | medium | high. Reasoning effort where the API has one. Default low for
 *                  anthropic/openai/openai-responses, not sent for openai-compatible/ollama (many servers reject it).
 *                  openai-compatible: a level sends reasoning_effort (gpt-oss: use low, or its reasoning can use up
 *                  LLM_MAX_TOKENS and leave no answer); "off" sends chat_template_kwargs.enable_thinking=false
 *                  (Qwen3-style hybrid thinking models).
 *                  Ollama: "off" sends think=false, a level sends think=<level> (gpt-oss only).
 *
 *   Local example (oMLX, LM Studio, mlx_lm.server, llama.cpp or vLLM on this machine):
 *     LLM_PROVIDER=openai-compatible  LLM_BASE_URL=http://localhost:8000/v1  LLM_MODEL=gpt-oss-20b-MXFP4-Q8  LLM_EFFORT=low
 *   LLM_MAX_TOKENS default 400 · LLM_TIMEOUT_MS default 8000
 *
 * Short timeout and no retries: a live demo must fail fast and fall back to the canned answer.
 */
export type Provider = "anthropic" | "openai" | "openai-responses" | "openai-compatible" | "ollama";
export const PROVIDERS: Provider[] = ["anthropic", "openai", "openai-responses", "openai-compatible", "ollama"];

export type Llm = {
  configured: boolean;
  /** "provider · model · base url" for the startup banner. */
  info: string;
  /** Why the live model is off although something was set (never set when nothing was configured). */
  reason?: string;
  render(system: string, user: string): Promise<string>;
};

type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;

type Config = { provider: Provider; model: string; apiKey?: string; baseUrl: string; effort?: string; maxTokens: number; timeoutMs: number };

const DEFAULT_MODEL: Partial<Record<Provider, string>> = { anthropic: "claude-opus-5", openai: "gpt-5", "openai-responses": "gpt-5" };
const OPENAI_URL = "https://api.openai.com/v1";

export function resolveConfig(env: Env): Config | { off: string } {
  const raw = (env.LLM_PROVIDER || "").trim().toLowerCase();
  let provider: Provider;
  if (raw) {
    if (!PROVIDERS.includes(raw as Provider)) return { off: `unknown LLM_PROVIDER "${raw}" (use ${PROVIDERS.join(", ")})` };
    provider = raw as Provider;
  } else if (env.ANTHROPIC_API_KEY) provider = "anthropic";
  else if (env.OPENAI_API_KEY) provider = "openai";
  else return { off: "" };

  const fallbackKey = provider === "anthropic" ? env.ANTHROPIC_API_KEY : provider === "ollama" ? undefined : env.OPENAI_API_KEY;
  const apiKey = (env.LLM_API_KEY || fallbackKey || "").trim() || undefined;
  const model = (env.LLM_MODEL || DEFAULT_MODEL[provider] || "").trim();
  const defaultBase = provider === "openai" || provider === "openai-responses" ? OPENAI_URL : provider === "ollama" ? env.OLLAMA_HOST || "http://localhost:11434" : "";
  const baseUrl = (env.LLM_BASE_URL || defaultBase).trim().replace(/\/+$/, "");

  if (provider === "anthropic" && !apiKey) return { off: "set ANTHROPIC_API_KEY (or LLM_API_KEY)" };
  if ((provider === "openai" || provider === "openai-responses") && !apiKey) return { off: "set OPENAI_API_KEY (or LLM_API_KEY)" };
  if (provider === "openai-compatible" && !baseUrl) return { off: "set LLM_BASE_URL to the server's /v1 root" };
  if (!model) return { off: `set LLM_MODEL for ${provider}` };

  const effortRaw = env.LLM_EFFORT?.trim().toLowerCase();
  const effort = effortRaw !== undefined && effortRaw !== "" ? effortRaw : provider === "anthropic" || provider === "openai" || provider === "openai-responses" ? "low" : undefined;
  const maxTokens = Math.max(1, Number(env.LLM_MAX_TOKENS) || 400);
  const timeoutMs = Math.max(500, Number(env.LLM_TIMEOUT_MS) || 8000);
  return { provider, model, apiKey, baseUrl, effort, maxTokens, timeoutMs };
}

async function postJson(fetchImpl: Fetch, url: string, body: unknown, headers: Record<string, string>, timeoutMs: number): Promise<any> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200).replace(/\s+/g, " ")}`);
  try { return JSON.parse(text); } catch { throw new Error("invalid JSON response"); }
}

const partsText = (content: unknown): string =>
  typeof content === "string" ? content
    : Array.isArray(content) ? content.map((p) => (p && typeof p === "object" && typeof (p as any).text === "string" ? (p as any).text : "")).join("")
    : "";

/**
 * Drops reasoning a server left in the answer: <think>…</think> blocks, and an unclosed <think> that ran out of
 * tokens. What remains is the answer; if nothing remains, the fallback takes over.
 */
function withoutThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/<think>[\s\S]*$/, "");
}

function nonEmpty(text: string): string {
  const t = text.trim();
  if (!t) throw new Error("empty response");
  return t;
}

function anthropicRenderer(c: Config, fetchImpl: Fetch) {
  const client = new Anthropic({
    apiKey: c.apiKey, timeout: c.timeoutMs, maxRetries: 0,
    ...(c.baseUrl ? { baseURL: c.baseUrl } : {}),
    ...(fetchImpl !== fetch ? { fetch: fetchImpl as any } : {}),
  });
  return async (system: string, user: string) => {
    const res = await client.messages.create({
      model: c.model,
      max_tokens: c.maxTokens,
      system,
      messages: [{ role: "user", content: user }],
      ...(c.effort && c.effort !== "off" ? { output_config: { effort: c.effort as any } } : {}),
    });
    if (res.stop_reason === "refusal") throw new Error("refusal");
    return nonEmpty(res.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
  };
}

/** OpenAI chat completions, also spoken by Ollama (/v1), vLLM, LM Studio, llama.cpp, OpenRouter, Groq, ... */
function chatRenderer(c: Config, fetchImpl: Fetch) {
  const official = c.provider === "openai";
  const headers: Record<string, string> = c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {};
  return async (system: string, user: string) => {
    const body: Record<string, unknown> = {
      model: c.model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      // Reasoning models on the official API reject max_tokens; compatible servers do not all know max_completion_tokens.
      ...(official ? { max_completion_tokens: c.maxTokens } : { max_tokens: c.maxTokens }),
      ...(c.effort && c.effort !== "off" ? { reasoning_effort: c.effort } : {}),
      // Hybrid thinking models (Qwen3 and kin) read this from their chat template; other servers ignore it.
      ...(c.effort === "off" && c.provider === "openai-compatible" ? { chat_template_kwargs: { enable_thinking: false } } : {}),
    };
    const res = await postJson(fetchImpl, `${c.baseUrl}/chat/completions`, body, headers, c.timeoutMs);
    if (res.error) throw new Error(res.error.message || "api error");
    const choice = res.choices?.[0];
    if (!choice) throw new Error("no choices");
    if (choice.finish_reason === "content_filter" || choice.message?.refusal) throw new Error("refusal");
    return nonEmpty(withoutThinking(partsText(choice.message?.content)));
  };
}

/** OpenAI Responses API. */
function responsesRenderer(c: Config, fetchImpl: Fetch) {
  const headers: Record<string, string> = c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {};
  return async (system: string, user: string) => {
    const body: Record<string, unknown> = {
      model: c.model,
      instructions: system,
      input: user,
      max_output_tokens: c.maxTokens,
      store: false,
      ...(c.effort && c.effort !== "off" ? { reasoning: { effort: c.effort } } : {}),
    };
    const res = await postJson(fetchImpl, `${c.baseUrl}/responses`, body, headers, c.timeoutMs);
    if (res.error) throw new Error(res.error.message || "api error");
    let text = "";
    for (const item of res.output ?? []) {
      if (item?.type !== "message") continue;
      for (const part of item.content ?? []) {
        if (part?.type === "refusal") throw new Error("refusal");
        if (part?.type === "output_text") text += part.text ?? "";
      }
    }
    if (!text.trim() && res.status === "incomplete") throw new Error(`incomplete: ${res.incomplete_details?.reason ?? "unknown"}`);
    return nonEmpty(text);
  };
}

/** Ollama's native /api/chat: no key needed locally, controls thinking, keeps the model loaded between runs. */
function ollamaRenderer(c: Config, fetchImpl: Fetch) {
  const headers: Record<string, string> = c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {};
  return async (system: string, user: string) => {
    const body: Record<string, unknown> = {
      model: c.model,
      stream: false,
      keep_alive: "30m",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      options: { num_predict: c.maxTokens },
      ...(c.effort === "off" ? { think: false } : c.effort ? { think: c.effort } : {}),
    };
    const res = await postJson(fetchImpl, `${c.baseUrl}/api/chat`, body, headers, c.timeoutMs);
    if (res.error) throw new Error(typeof res.error === "string" ? res.error : res.error.message || "api error");
    return nonEmpty(partsText(res.message?.content));
  };
}

export function createLlm(env: Env = process.env, fetchImpl: Fetch = fetch): Llm {
  const c = resolveConfig(env);
  if ("off" in c) {
    return { configured: false, info: "off", reason: c.off || undefined, render: async () => { throw new Error(c.off || "live model not configured"); } };
  }
  const render =
    c.provider === "anthropic" ? anthropicRenderer(c, fetchImpl)
    : c.provider === "openai-responses" ? responsesRenderer(c, fetchImpl)
    : c.provider === "ollama" ? ollamaRenderer(c, fetchImpl)
    : chatRenderer(c, fetchImpl);
  const info = `${c.provider} · ${c.model}${c.baseUrl ? ` · ${c.baseUrl}` : ""}${c.effort ? ` · effort ${c.effort}` : ""}`;
  return { configured: true, info, render };
}

const llm = createLlm();
export const llmConfigured = () => llm.configured;
export const llmInfo = () => llm;
export const renderLive = (system: string, user: string) => llm.render(system, user);
