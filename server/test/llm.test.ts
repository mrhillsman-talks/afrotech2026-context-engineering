import { test } from "node:test";
import assert from "node:assert/strict";
import { createLlm, resolveConfig } from "../src/llm.js";

type Call = { url: string; body: any; headers: Record<string, string> };

/** A fetch stub that records the request and answers with the given JSON (or status). */
function fakeFetch(reply: unknown, status = 200) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: any, init: any) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
    return new Response(typeof reply === "string" ? reply : JSON.stringify(reply), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

test("provider is inferred from the key that is set, and off when nothing is", () => {
  assert.equal("off" in resolveConfig({}) && (resolveConfig({}) as any).off, "");
  assert.equal((resolveConfig({ ANTHROPIC_API_KEY: "a" }) as any).provider, "anthropic");
  assert.equal((resolveConfig({ OPENAI_API_KEY: "o" }) as any).provider, "openai");
  assert.match((resolveConfig({ LLM_PROVIDER: "cohere" }) as any).off, /unknown LLM_PROVIDER/);
  assert.match((resolveConfig({ LLM_PROVIDER: "openai" }) as any).off, /OPENAI_API_KEY/);
  assert.match((resolveConfig({ LLM_PROVIDER: "openai-compatible", LLM_MODEL: "m" }) as any).off, /LLM_BASE_URL/);
  assert.match((resolveConfig({ LLM_PROVIDER: "ollama" }) as any).off, /LLM_MODEL/);
  const ollama = resolveConfig({ LLM_PROVIDER: "ollama", LLM_MODEL: "llama3.2" }) as any;
  assert.equal(ollama.baseUrl, "http://localhost:11434");
  assert.equal(ollama.effort, undefined, "no effort is sent to servers that may reject it");
  assert.equal(ollama.apiKey, undefined);
});

test("openai: chat completions with max_completion_tokens, low effort and a bearer key", async () => {
  const { calls, fetchImpl } = fakeFetch({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "  Use AWS [ATL-001]. " } }] });
  const llm = createLlm({ OPENAI_API_KEY: "sk-test" }, fetchImpl);
  assert.equal(llm.configured, true);
  assert.equal(await llm.render("SYS", "USER"), "Use AWS [ATL-001].");
  assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
  assert.equal(calls[0].headers.authorization, "Bearer sk-test");
  assert.deepEqual(calls[0].body.messages, [{ role: "system", content: "SYS" }, { role: "user", content: "USER" }]);
  assert.equal(calls[0].body.max_completion_tokens, 400);
  assert.equal(calls[0].body.max_tokens, undefined);
  assert.equal(calls[0].body.reasoning_effort, "low");
});

test("openai: refusals and content filters surface as errors so the fallback kicks in", async () => {
  const refusal = fakeFetch({ choices: [{ finish_reason: "stop", message: { content: null, refusal: "no" } }] });
  await assert.rejects(createLlm({ OPENAI_API_KEY: "k" }, refusal.fetchImpl).render("s", "u"), /refusal/);
  const filtered = fakeFetch({ choices: [{ finish_reason: "content_filter", message: { content: "" } }] });
  await assert.rejects(createLlm({ OPENAI_API_KEY: "k" }, filtered.fetchImpl).render("s", "u"), /refusal/);
  const http = fakeFetch({ error: { message: "bad key" } }, 401);
  await assert.rejects(createLlm({ OPENAI_API_KEY: "k" }, http.fetchImpl).render("s", "u"), /401/);
});

test("openai-responses: instructions + input, parses output_text parts", async () => {
  const { calls, fetchImpl } = fakeFetch({
    status: "completed",
    output: [{ type: "reasoning", summary: [] }, { type: "message", content: [{ type: "output_text", text: "Answer " }, { type: "output_text", text: "[ATL-002]" }] }],
  });
  const llm = createLlm({ LLM_PROVIDER: "openai-responses", LLM_API_KEY: "k", LLM_MODEL: "gpt-5-mini", LLM_EFFORT: "minimal" }, fetchImpl);
  assert.equal(await llm.render("SYS", "USER"), "Answer [ATL-002]");
  assert.equal(calls[0].url, "https://api.openai.com/v1/responses");
  assert.equal(calls[0].body.model, "gpt-5-mini");
  assert.equal(calls[0].body.instructions, "SYS");
  assert.equal(calls[0].body.input, "USER");
  assert.equal(calls[0].body.max_output_tokens, 400);
  assert.deepEqual(calls[0].body.reasoning, { effort: "minimal" });
  const empty = fakeFetch({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [{ type: "reasoning" }] });
  await assert.rejects(createLlm({ LLM_PROVIDER: "openai-responses", LLM_API_KEY: "k" }, empty.fetchImpl).render("s", "u"), /max_output_tokens/);
  const refused = fakeFetch({ status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] });
  await assert.rejects(createLlm({ LLM_PROVIDER: "openai-responses", LLM_API_KEY: "k" }, refused.fetchImpl).render("s", "u"), /refusal/);
});

test("openai-compatible: custom base url, max_tokens, no key and no effort unless asked", async () => {
  const { calls, fetchImpl } = fakeFetch({ choices: [{ message: { content: [{ type: "text", text: "local answer" }] } }] });
  const llm = createLlm({ LLM_PROVIDER: "openai-compatible", LLM_BASE_URL: "http://localhost:11434/v1/", LLM_MODEL: "qwen3" }, fetchImpl);
  assert.equal(llm.info, "openai-compatible · qwen3 · http://localhost:11434/v1");
  assert.equal(await llm.render("SYS", "USER"), "local answer");
  assert.equal(calls[0].url, "http://localhost:11434/v1/chat/completions");
  assert.equal(calls[0].headers.authorization, undefined);
  assert.equal(calls[0].body.max_tokens, 400);
  assert.equal(calls[0].body.max_completion_tokens, undefined);
  assert.equal(calls[0].body.reasoning_effort, undefined);
  const withEffort = fakeFetch({ choices: [{ message: { content: "x" } }] });
  await createLlm({ LLM_PROVIDER: "openai-compatible", LLM_BASE_URL: "http://h/v1", LLM_MODEL: "m", LLM_EFFORT: "high", LLM_API_KEY: "tok" }, withEffort.fetchImpl).render("s", "u");
  assert.equal(withEffort.calls[0].body.reasoning_effort, "high");
  assert.equal(withEffort.calls[0].headers.authorization, "Bearer tok");
  assert.equal(withEffort.calls[0].body.chat_template_kwargs, undefined);
});

test("openai-compatible: effort off turns template thinking off, and leftover <think> text is dropped", async () => {
  const { calls, fetchImpl } = fakeFetch({ choices: [{ message: { content: "<think>weigh the cards</think>\n\nUse AWS [ATLAS-002]." } }] });
  const llm = createLlm({ LLM_PROVIDER: "openai-compatible", LLM_BASE_URL: "http://h/v1", LLM_MODEL: "qwen", LLM_EFFORT: "off" }, fetchImpl);
  assert.equal(await llm.render("s", "u"), "Use AWS [ATLAS-002].");
  assert.deepEqual(calls[0].body.chat_template_kwargs, { enable_thinking: false });
  assert.equal(calls[0].body.reasoning_effort, undefined);
  // Reasoning that ran out of tokens before the answer is no answer: the deterministic fallback takes over.
  const cut = fakeFetch({ choices: [{ finish_reason: "length", message: { content: "<think>still thinking about the contract" } }] });
  await assert.rejects(createLlm({ LLM_PROVIDER: "openai-compatible", LLM_BASE_URL: "http://h/v1", LLM_MODEL: "qwen" }, cut.fetchImpl).render("s", "u"), /empty response/);
});

test("ollama: native /api/chat, non-streaming, thinking controlled by LLM_EFFORT", async () => {
  const { calls, fetchImpl } = fakeFetch({ message: { role: "assistant", content: "from ollama" }, done: true });
  const llm = createLlm({ LLM_PROVIDER: "ollama", LLM_MODEL: "llama3.2", LLM_MAX_TOKENS: "120" }, fetchImpl);
  assert.equal(await llm.render("SYS", "USER"), "from ollama");
  assert.equal(calls[0].url, "http://localhost:11434/api/chat");
  assert.equal(calls[0].body.stream, false);
  assert.deepEqual(calls[0].body.options, { num_predict: 120 });
  assert.equal("think" in calls[0].body, false);
  const off = fakeFetch({ message: { content: "x" } });
  await createLlm({ LLM_PROVIDER: "ollama", LLM_MODEL: "qwen3", LLM_EFFORT: "off", OLLAMA_HOST: "http://gpu-box:11434" }, off.fetchImpl).render("s", "u");
  assert.equal(off.calls[0].url, "http://gpu-box:11434/api/chat");
  assert.equal(off.calls[0].body.think, false);
  const err = fakeFetch({ error: "model 'nope' not found" }, 404);
  await assert.rejects(createLlm({ LLM_PROVIDER: "ollama", LLM_MODEL: "nope" }, err.fetchImpl).render("s", "u"), /404.*not found/);
});

test("anthropic keeps the original request shape", async () => {
  const { calls, fetchImpl } = fakeFetch({ id: "m", type: "message", role: "assistant", model: "claude-opus-5", stop_reason: "end_turn", content: [{ type: "text", text: "claude says [ATL-003]" }], usage: { input_tokens: 1, output_tokens: 1 } });
  const llm = createLlm({ ANTHROPIC_API_KEY: "sk-ant" }, fetchImpl);
  assert.equal(await llm.render("SYS", "USER"), "claude says [ATL-003]");
  assert.match(calls[0].url, /api\.anthropic\.com\/v1\/messages$/);
  assert.equal(calls[0].body.system, "SYS");
  assert.equal(calls[0].body.max_tokens, 400);
  assert.deepEqual(calls[0].body.output_config, { effort: "low" });
});
