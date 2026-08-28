# Neira

Neira is a Tauri-based desktop code editor with an integrated AI assistant panel.

## Language

**Integration**:
A connection to an external third-party service (Jira, Confluence, GitHub) authenticated via Personal Access Token, used to bring outside data into Neira as AI context.
_Avoid_: Provider (reserved for AI model providers), Connection, Plugin

**Provider**:
An AI model vendor (OpenAI, Anthropic, etc.) configured in Settings → Models via an API key.
_Avoid_: Integration
