# Neira

Neira is a Tauri-based desktop code editor with an integrated AI assistant panel.

## Language

**Integration**:
A connection to an external third-party service (Jira, Confluence, GitHub) authenticated via Personal Access Token, used to bring outside data into Neira as AI context.
_Avoid_: Provider (reserved for AI model providers), Connection, Plugin

**Provider**:
An AI model vendor (OpenAI, Anthropic, etc.) configured in Settings → Models via an API key.
_Avoid_: Integration

**Agent**:
A selectable chat persona (e.g. Coder, Architect, Impact Analysis) — a system-prompt swap applied within the same conversation loop (`streamText` in `src/modules/ai/lib/agent.ts`). No tool restriction and no context isolation: every Agent sees the same tool registry and the same message history. Independent of Permission Mode — selecting an Agent never changes the active mode.
_Avoid_: Persona, Mode, Variant

**Permission Mode**:
A single global setting, shared across every window and conversation, controlling whether a mutating tool (`write_file`, `create_directory`, `edit`, `multi_edit`, `bash_run`, `bash_background`) executes immediately or waits for the user to approve it via the AI SDK's `needsApproval` gate. Four values: **Manual** (default, every mutating tool call asks individually), **Accept Edits** (file-mutating tools auto-approve; shell calls still ask), **Auto** (every mutating tool auto-approves), **Plan** (mutating tools are omitted from the tool registry entirely, the model cannot call them at all). Sticky, except it resets to Manual whenever any conversation starts fresh (`chatStore.newSession()`), unless the last active mode was Plan; this reset is global too, so starting a new chat in one window can reset Auto/Plan mid-turn in another window's unrelated session (known rough edge, not yet fixed). Independent of Agent. The secret-path deny-list and shell-command heuristics in `security.ts` apply unconditionally in every mode, including Auto.
_Avoid_: Mode alone (Neira also uses "mode" for editor/theme contexts elsewhere), Permission Level, Trust Level, Auto-approve (that's a value of this concept, not the concept itself)

**Reasoning Effort**:
A per-model setting controlling how much a self-hosted or freeform model "thinks" before answering (its `reasoning_effort` or equivalent, sent via `providerOptions` on `streamText`). Only exists for the five providers with no standardized way to control this: named custom OpenAI-compatible endpoints (`CustomEndpoint.reasoning`), LM Studio, MLX, Ollama, and OpenRouter (each via a `lmstudioReasoning`/`mlxReasoning`/`ollamaReasoning`/`openrouterReasoning` preference). Curated cloud models (OpenAI, Anthropic, Google, xAI, Cerebras, Groq) don't have this, out of scope, since each uses its own native mechanism (token budgets, not effort levels) that this concept doesn't cover. The level vocabulary (`levels`) is exactly whatever the user defines for that model (Neira has no fixed Low/Medium/High scale), sent through one of three **delivery shapes** (`ReasoningShape`): `flat` (top-level `reasoning_effort`), `chat-template-kwargs` (llama.cpp-style, nested; commonly stripped silently by a proxy in front of the backend, e.g. LiteLLM, verify it actually changes behavior before trusting it), or `openrouter` (OpenRouter's unified `reasoning.effort`). Persists per-model (`activeLevel`), remembered independently across model switches; the configured `defaultLevel` is what a never-touched model gets.
_Avoid_: Thinking Budget (that's a token-count mechanism, distinct from this level-based one; Anthropic/Google use it natively but it's out of scope here), Reasoning Level (use "level" for one value, "Reasoning Effort" for the whole concept)

**Subagent**:
An isolated, tool-restricted worker invoked via the `run_subagent` tool from within an Agent's turn. Runs its own `generateText` call with no parent message history and only a whitelisted tool set (its `SUBAGENTS` registry entry), returning a distilled summary — never the raw transcript — to the calling Agent's context. Its step trace remains visible to the human user via the UI (see Step trace). Cannot itself call `run_subagent` (no recursion).
_Avoid_: Sub-agent, Explorer (a category of Subagent, not the general term)

**Step trace**:
The recorded sequence of a Subagent's tool calls (tool name, input, output, duration — duration is the tool's own execution time, not the surrounding model turn) interleaved with any reasoning segments it produced, in the order they happened during its run. Kept live while the Subagent is running and persisted alongside the parent session afterward, so the user can inspect it from the `run_subagent` tool card at any time, with reasoning segments rendered the same collapsible way as the main chat's reasoning. Distinct from the distilled summary, which is the only thing the calling Agent ever sees.
_Avoid_: Transcript (reserved for the raw message history a Subagent explicitly never receives/returns to its caller), Activity log

**Explorer**:
A Subagent whose whitelisted tools only read from one external Integration (e.g. `github-explorer`, `atlassian-explorer`) and report findings back — never mutates anything.
