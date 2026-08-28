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
A selectable chat persona (e.g. Coder, Architect, Impact Analysis) — a system-prompt swap applied within the same conversation loop (`runAgentStream()`). No tool restriction and no context isolation: every Agent sees the same tool registry and the same message history.
_Avoid_: Persona, Mode, Variant

**Subagent**:
An isolated, tool-restricted worker invoked via the `run_subagent` tool from within an Agent's turn. Runs its own `generateText` call with no parent message history and only a whitelisted tool set (its `SUBAGENTS` registry entry), returning a distilled summary — never the raw transcript — to the caller. Cannot itself call `run_subagent` (no recursion).
_Avoid_: Sub-agent, Explorer (a category of Subagent, not the general term)

**Explorer**:
A Subagent whose whitelisted tools only read from one external Integration (e.g. `github-explorer`, `atlassian-explorer`) and report findings back — never mutates anything.
