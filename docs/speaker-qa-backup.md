# Context Window Live: Q&A backup

Answers for the questions the room is most likely to ask after the talk, each with a spoken-length
reply and the source that backs it. The sources were checked on 2026-09-29, and the CWA claims
again on 2026-10-02 against its draft-release (spec dated 2026-10-01). Entries 11 to 14 were added
and their sources checked on 2026-10-08. The two working notes in
`docs/misc/`, `context_engineering_tools.md` and `more_details.md`, are kept out of git. They are
chat transcripts with unresolved citation markers; this file is where their claims were traced to
something citable, and the last section lists the places where the sources say something slightly
different from the notes.

Use it from the console during questions. Say the short answer. Reach for the detail only if the
questioner pushes. Pause the talk clock first (`T`); questions sit outside the forty minutes, so the
talk time reads red after 40:00 and that is expected.

---

## 1. "Why doesn't the spec just fix the best order?"

**Short answer.** Position matters, and that is exactly why nobody should hard-code one. The
research says models do not treat every position equally. The providers' own guides disagree about
where to put what, and one of them moves tool definitions around on your behalf. So the spec fixes
the semantics, what each item is, and makes the layout a versioned profile per route that has to be
evaluated before it is promoted. Semantics are stable. Layout is measured.

**Detail.**

- Position effects are real. *Lost in the Middle* (Liu et al., 2023, TACL) found that performance
  is often highest when the relevant passage is at the beginning or end of a long input and drops
  when it is in the middle, even for models built for long contexts.
- Advertised context is not effective context. *RULER* (Hsieh et al., 2024) found that of models
  claiming 32K-token windows or more, only about half kept satisfactory performance at 32K.
- The providers disagree. Anthropic's prompting guide says to put long documents and inputs near
  the top of the prompt, above the query, instructions and examples. OpenAI's GPT-4.1 prompting
  guide says that with long context you should ideally put instructions at both the beginning and
  the end, and if only once, above the context, and tells you to experiment because the optimal
  arrangement varies.
- The provider also controls some placement. OpenAI's tool search documentation says all tools are
  loaded at the end of the model's context window, and an `additional_tools` item makes tools
  available only from the point in the input where it appears. Gemini's request format keeps
  `systemInstruction`, `contents`, `tools`, `toolConfig` and `cachedContent` as separate fields, so
  the final layout is partly the provider's.
- The spec's position. Context Window Architecture (draft), section 5: "Placement is model-, task- and
  content-dependent. This specification takes no position on where items go." Placement profiles
  are versioned, per route, and evaluated against that route's tasks before promotion (rules R-19
  and R-20). The site's five example profiles are marked unevaluated.

**Sources.** Liu et al. [arXiv:2307.03172](https://arxiv.org/abs/2307.03172). Hsieh et al.
[arXiv:2404.06654](https://arxiv.org/abs/2404.06654). Anthropic,
[Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices),
"Put longform data at the top". OpenAI,
[GPT-4.1 prompting guide](https://developers.openai.com/cookbook/examples/gpt4-1_prompting_guide).
OpenAI, [Tool search](https://developers.openai.com/api/docs/guides/tools-tool-search). Google,
[GenerateContentRequest](https://ai.google.dev/api/generate-content). CWA,
[specification](https://contextwindowarchitecture.io/spec.html), section 5.

---

## 2. "Isn't this just prompt engineering?"

**Short answer.** Prompt engineering is how you write the instructions. Context engineering is
deciding everything the model sees, including the instructions, and keeping that set right as the
work goes on. Every card you moved today was a context decision. Not one of them changed a prompt.

**Detail.** Anthropic's engineering post distinguishes the two directly: context engineering is
"strategies for curating and maintaining the optimal set of tokens (information) during LLM
inference"; prompt engineering is "methods for writing and organizing LLM instructions". That is
the same split as the talk's definition, choose and maintain.

**Source.** Anthropic,
[Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents),
2025-09-29.

---

## 3. "Isn't this just RAG?"

**Short answer.** Retrieval is one producer. It hands you candidates. Somebody still decides which
candidates get in, at what size, under what authority, and what they are never allowed to overrule.
Part 4 was that: five search results, two seats.

**Detail.** The CWA site puts it in one line: "Retrieval produces candidates for the Evidence
plane. CWA decides which are admitted, where they're placed, and what they may never overrule."
In the operator language of `context_engineering_tools.md`, a typical RAG pipeline is retrieve,
filter, rerank, pack, inject: five of roughly thirty context operations.

**Sources.** CWA, [site overview, "Where it fits"](https://contextwindowarchitecture.io/#fit) and
[Producers](https://contextwindowarchitecture.io/producers.html).
`docs/misc/context_engineering_tools.md`, "The actual operations you can perform on context".

---

## 4. "Won't million-token windows make all this go away?"

**Short answer.** A bigger window is more room, not better judgement. The evidence says recall gets
worse as the window fills, and models often cannot use the length they advertise. And a bigger
window does nothing about scope, permission or trust. Apollo, Alice's memory and the vendor page
were all wrong at any size.

**Detail.** RULER: only about half of the models claiming 32K-token contexts kept satisfactory
performance at 32K. Anthropic's post describes an "attention budget" and "context rot": as tokens in
the window increase, the model's ability to accurately recall information from it decreases, because
attention cost grows with the square of the length. `context_engineering_tools.md` states the
consequence: a larger context window and better memory are not the same thing.

**Sources.** Hsieh et al. [arXiv:2404.06654](https://arxiv.org/abs/2404.06654). Anthropic,
[Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).

---

## 5. "Why not just tell the model to ignore instructions in documents?"

**Short answer.** We did. The system card in every shared preset says to treat instructions inside
retrieved documents as data, and with the trust filter off the page still won. An instruction to
the model is guidance. A boundary has to be enforced outside the model, which is what the
quarantine did.

**Detail.** OWASP's top risk for LLM applications is prompt injection; indirect injection is when
content from websites or files alters the model's behaviour. Its mitigations include separating and
clearly denoting untrusted content, and handling privileged functions in code rather than giving
them to the model. CWA section 3.1: "A retrieved document is not an instruction because it contains
imperatives." Only governing and user items may direct the model (R-6), and no item gains authority
from imperative wording in its body (R-7). Its rule zero (R-5): language guidance goes in context,
enforceable invariants go outside the model; the model is instructed, but the application still
enforces the rule.

**Sources.** OWASP,
[LLM01:2025 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/). CWA,
[specification](https://contextwindowarchitecture.io/spec.html), section 3, rule zero (R-5), R-6 and R-7.
The app's system card is `SYS-001` in `shared/src/cards.ts`.

---

## 6. "How is this different from MCP?"

**Short answer.** MCP is how an application discovers and fetches tools, resources and prompts.
It says nothing about which of them enter a given inference, at what size, or with what authority.
That is the machinery in the middle. MCP feeds it.

**Detail.** The MCP architecture page: "MCP focuses solely on the protocol for context exchange—it
does not dictate how AI applications use LLMs or manage the provided context." Its three server
primitives are tools, resources and prompts. On the CWA side, a producer is "anything that emits
candidate items into a slot: a retriever, a memory store, an MCP server, a state service, a
capability policy, the application's policy loader, its conversation." MCP results land as evidence
items, and tool specifications are proposed to the route's capability policy rather than gaining
governing authority by themselves (R-15).

**Sources.** MCP, [Architecture overview](https://modelcontextprotocol.io/docs/learn/architecture).
CWA, [Producers](https://contextwindowarchitecture.io/producers.html),
[site overview, "Where it fits"](https://contextwindowarchitecture.io/#fit) and
[specification](https://contextwindowarchitecture.io/spec.html), R-15.

---

## 7. "Is CWA a standard? Who is using it?"

**Short answer.** It is a draft specification, and it says so on its front page. No assembler has
been released and the example profiles are unevaluated. I am not asking you to adopt it. I am
pointing at the machinery it describes, because that machinery exists in every system in this room whether or
not anyone has named it.

**Detail.** The spec header reads "draft · 2026-10-01" and "Status: draft. Not yet stable." The
assembler page reads "In progress. No release yet." Three assemblers, in Python, TypeScript and Go,
pass every published conformance case, and none is released; the Assembler page tracks them. The
spec states that the example profiles are all unevaluated, and its sample profile carries
`evaluation: { status: "unevaluated" }`. Make no performance claims about it.

**Sources.** CWA, [specification](https://contextwindowarchitecture.io/spec.html) and
[Assembler](https://contextwindowarchitecture.io/assembler.html).

---

## 8. "The model is random. What does a deterministic assembler buy you?"

**Short answer.** Reproducibility of the input, not the output. Same state, same sources, same
policy, same payload. The answer may still vary, but now "it said something weird on Tuesday"
becomes a trace you can open: what went in, what was compressed, what was excluded and why. That
is the Inspector. And deterministic is not the same as correct: you can reliably retrieve the
wrong document. Determinism gives you the trace. Evaluation tells you whether the policy is any
good.

**Detail.** CWA section 6 requires a trace with a profile id and version, the budget, and arrays of
included items, compressions, exclusions and conflicts, and defines debuggable as "an engineer can
reconstruct and compare assembly decisions, not just read the payload." R-23 makes the input
deterministic: the same frozen snapshot, clock and policy give the same payload bytes and hash, or
the same refusal. The spec makes no claim that the model response will be identical.

**Source.** CWA, [specification](https://contextwindowarchitecture.io/spec.html), section 6 and R-23.

---

## 9. "When I'm blending, where is my hook?"

**Short answer.** Three places, from least to most control. The connector's own configuration:
which sources, which scopes. The framework or SDK, which usually exposes a hook before the model
call where you can edit the messages, summarize history or drop tools. And a gateway between your
application and the provider, which can rewrite the request on the way out: add instructions, redact
secrets, enforce a budget, cache. None of these change the model. All of them change what it sees.

**Detail.** LangChain middleware exposes hooks around model and tool calls and ships a
summarization middleware for old history. The OpenAI Agents SDK separates application-local
context from what the model sees and manages session state. LiteLLM's proxy exposes pre-call hooks
that modify a request before it reaches the model. Keep vendor names out of the spoken answer
unless asked; say the three layers.

**Sources.** The links in `docs/misc/context_engineering_tools.md`, sections 1, 6 and 13.

---

## 10. "Which tools actually do this?"

**Short answer.** By category: frameworks with pre-model hooks, retrieval and rerankers, history
compaction, memory systems, gateways, guardrails and redaction, observability and evals. Every one
of them implements a handful of the operations you performed today. The talk repo has the list with
links.

**Source.** `docs/misc/context_engineering_tools.md`, sections 1 to 17. Note that its links are
replacement references, not the original bibliography, and vendor names date quickly.

---

## 11. "Doesn't the search just use the question as asked?"

**Short answer.** Often it shouldn't. People ask things like "why is it still failing?", and that
sentence finds nothing on its own. Many systems rewrite the question before they search, using
the conversation to fill in the project, the system and the error. So there is one more decision
before retrieval: what to search for. In part 4 the search used the question as it stood. Change
the search words and you change which five results come back.

**Detail.** Ma et al. (EMNLP 2023) add a rewrite step in front of retrieval, which they call
Rewrite-Retrieve-Read: a model writes the search query first, and a small rewriter is then trained
on feedback from the model that reads the results. HyDE (Gao et al., 2022) goes further: the model
writes a made-up answer, and the system searches for real documents that look like it. The working
notes list other forms: expanding the query, running several queries, splitting a question into
sub-questions. All of them change what retrieval hands the assembler.

**Sources.** Ma et al., *Query Rewriting for Retrieval-Augmented Large Language Models*,
[arXiv:2305.14283](https://arxiv.org/abs/2305.14283). Gao et al., *Precise Zero-Shot Dense
Retrieval without Relevance Labels*, [arXiv:2212.10496](https://arxiv.org/abs/2212.10496).
`docs/misc/context_engineering_tools.md`, section 9.

---

## 12. "Why keep Alice's whole note out? Why not just hide the $80,000?"

**Short answer.** Because the whole note is Alice's, not just the number. Her name is on the card,
so the card stays out for everyone else. Hiding the value is the right move when a card everyone
may see has one sensitive thing inside it: a support ticket with a customer's phone number, a log
line with an account ID. Then you keep the card and replace the value before the model sees it.
One decision removes the card, the other changes it. Both happen before the call, and neither
depends on the model being discreet.

**Detail.** OWASP's entry on sensitive information disclosure lists data sanitization, redaction
of confidential content before processing, and input validation that filters sensitive data out
of inputs. Presidio is an open-source service that detects personal data in text and images and
then redacts, masks or otherwise anonymizes it. The app does not mask. `PRIVATE-001` is scoped to
`{ user: "alice" }`, and the permission filter in preset 07 removes the whole card for the shared
window.

**Sources.** OWASP,
[LLM02:2025 Sensitive Information Disclosure](https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/).
[Presidio](https://github.com/data-privacy-stack/presidio). `docs/misc/context_engineering_tools.md`,
section 14. The card is in `shared/src/cards.ts`.

---

## 13. "If every tool takes room, what happens with fifty of them?"

**Short answer.** You stop sending all of them. Real systems pick tools per question, the same way
they pick documents: search the tool list, load the few that fit, leave the rest out. Preset 12
showed the room cost. There is a second cost: the more tools on the list, the worse the model gets
at choosing the right one. The tool list is context, so it gets the same treatment as everything
else.

**Detail.** Anthropic's tool search documentation gives its own numbers: a typical setup with
GitHub, Slack, Sentry, Grafana and Splunk servers can spend about 55,000 tokens on tool definitions
before any work starts; loading tools on demand typically cuts that by more than 85 percent, to the
three to five tools a request needs; and the model's ability to pick the right tool degrades once
more than 30 to 50 are available. Deferred tools stay out of the window until a search finds them.
OpenAI's tool search (entry 1) does the same job. In the app, the Blend counter comes from
`blendToolUnits` in `shared/src/presets.ts`.

**Sources.** Anthropic,
[Tool search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool).
OpenAI, [Tool search](https://developers.openai.com/api/docs/guides/tools-tool-search).
`docs/misc/context_engineering_tools.md`, section 11.

---

## 14. "Does the Inspector show everything the model sees?"

**Short answer.** No, and no application can. You control the request you send. The provider adds
its own material on top: when you send tools, some providers add a system prompt you never wrote,
and they decide where tool definitions sit. In Buy, the vendor controls almost all of it. So the
honest claim is narrower: you control what your application sends and in what order. The
Inspector shows what this app assembled. A trace records what the assembler produced, which is
exactly the part you own.

**Detail.** Anthropic's tool use documentation says that when a request includes tools, the API
also adds a special system prompt that enables tool use, and lists its size per model; for Claude
Opus 5.5 with automatic tool choice it is 286 tokens. OpenAI's tool search documentation says
tools are loaded at the end of the model's context window (entry 1). Gemini's request format keeps
system instructions, tools and cached content as separate fields. The working note
`more_details.md`, "What I would *not* claim", makes the same point.

**Sources.** Anthropic,
[Tool use with Claude](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview),
"Pricing". OpenAI, [Tool search](https://developers.openai.com/api/docs/guides/tools-tool-search).
Google, [GenerateContentRequest](https://ai.google.dev/api/generate-content).

---

## Where the sources differ from the working notes

Keep these in mind if you quote `more_details.md` directly.

- **OpenAI prompt sections.** The note says OpenAI's current guidance structures prompts as
  identity, instructions, examples, context. The current text-generation guide no longer contains
  that section; the closest statement is that "different models might need to be prompted
  differently." The identity-instructions-examples-context layout survives in the GPT-4.1 cookbook
  guide, which also says to experiment.
- **Determinism sentence.** The note quotes the spec as saying the same inputs and policy produce
  the same payload while the response may differ. R-23 states the first half: identical inputs give
  identical payload bytes and hash. The spec says nothing about the response, so do not quote the
  second half as the spec's.
- **Spec date and name.** The note cites a v2 draft dated September 22. The live spec is now dated
  2026-10-01, still draft, and it does not number itself: profiles and traces name it `cwa/draft`
  until the first release, and versions start at v1 then. Say "the draft specification", not "v2".
- **Assembler status.** The note says a complete conformant reference assembler remains in
  progress. The spec now says three assemblers, in Python, TypeScript and Go, pass every published
  conformance case, and none is released.
- **Presidio link.** `context_engineering_tools.md` links Presidio under the `data-privacy-stack`
  organization. That is correct: the repository moved from Microsoft's organization, and the old
  URL redirects.
