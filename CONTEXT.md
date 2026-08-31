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
A per-conversation setting controlling whether a mutating tool (`write_file`, `create_directory`, `edit`, `multi_edit`, `bash_run`, `bash_background`, managed-agent tools) executes immediately or waits for the user to approve it via the AI SDK's `needsApproval` gate. Four values: **Manual** (default — every mutating tool call asks individually), **Accept Edits** (file-mutating tools auto-approve; shell and managed-agent tools still ask), **Auto** (every mutating tool auto-approves), **Plan** (mutating tools are omitted from the tool registry entirely — the model cannot call them at all). Stored globally and sticky, except it resets to Manual at the start of a new conversation unless the last active mode was Plan. Independent of Agent. The secret-path deny-list and shell-command heuristics in `security.ts` apply unconditionally in every mode, including Auto.
_Avoid_: Mode alone (Neira also uses "mode" for editor/theme contexts elsewhere), Permission Level, Trust Level, Auto-approve (that's a value of this concept, not the concept itself)

**Subagent**:
An isolated, tool-restricted worker invoked via the `run_subagent` tool from within an Agent's turn. Runs its own `generateText` call with no parent message history and only a whitelisted tool set (its `SUBAGENTS` registry entry), returning a distilled summary — never the raw transcript — to the calling Agent's context. Its step trace remains visible to the human user via the UI (see Step trace). Cannot itself call `run_subagent` (no recursion).
_Avoid_: Sub-agent, Explorer (a category of Subagent, not the general term)

**Step trace**:
The recorded sequence of a Subagent's tool calls (tool name, input, output, duration — duration is the tool's own execution time, not the surrounding model turn) interleaved with any reasoning segments it produced, in the order they happened during its run. Kept live while the Subagent is running and persisted alongside the parent session afterward, so the user can inspect it from the `run_subagent` tool card at any time, with reasoning segments rendered the same collapsible way as the main chat's reasoning. Distinct from the distilled summary, which is the only thing the calling Agent ever sees.
_Avoid_: Transcript (reserved for the raw message history a Subagent explicitly never receives/returns to its caller), Activity log

**Explorer**:
A Subagent whose whitelisted tools only read from one external Integration (e.g. `github-explorer`, `atlassian-explorer`) and report findings back — never mutates anything.
