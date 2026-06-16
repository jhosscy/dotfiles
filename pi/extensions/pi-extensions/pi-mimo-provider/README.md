# pi-mimo-provider

Custom provider for pi that connects to Xiaomi's MiMo free AI API
(`https://api.xiaomimimo.com/api/free-ai/openai/chat`).

## Why a custom provider

MiMo's API is OpenAI Chat Completions–shaped but it has quirks that don't
fit pi's built-in `openai-completions` provider:

- **Custom endpoint** (`/api/free-ai/openai/chat`) and required headers
  (`X-Mimo-Source`, `x-session-affinity`, specific `User-Agent`).
- **JWT bootstrap** — a JWT is obtained lazily on the first request via
  `/api/free-ai/bootstrap`, cached in memory, and reused for all subsequent
  requests. No startup delay, no user API key required.
- **Mandatory system prompt** — the server fingerprints the first system
  message and rejects any variation with `403 Illegal access`. The prompt
  is the official MiMoCode prompt (captured by intercepting a real mimo
  run); pi's own system prompt must go in a *second* system message.

## Why a custom `streamSimple`

The `streamSimple` here is a custom one (not the built-in
`streamSimpleOpenAICompletions`) because:

- The server requires the official system prompt to be the *first* system
  message and pi's prompt as the *second*. pi-ai's built-in takes a single
  `context.systemPrompt` string and cannot express two system messages.
- The session affinity ID must be a per-request value — easier to do in a
  wrapper than to splice into pi's transport layer.

The stream parser handles `reasoning_content` for thinking text, tool
calls (with streaming JSON arguments), usage reporting, and finish reasons,
mirroring what the built-in `streamSimpleOpenAICompletions` does.

## Install

```bash
pi install /root/playground/pi-mimo-provider
```

Then use `/model mimo/mimo-auto` (or pass `--model mimo/mimo-auto` on
the command line).

## Files

- `index.ts` — Extension entry point. Bootstraps the JWT, registers the
  `mimo` provider, and implements the streaming parser.
- `mimo-system-prompt.txt` — The official MiMoCode system prompt
  (data, not code). Update this file to refresh the prompt without
  touching the extension.
- `package.json` — pi package metadata and dependencies.

## Authentication

- JWT is fetched lazily on the first request to the LLM, not at startup.
- Once fetched, it is cached in memory and reused for all subsequent
  requests in the same process.
- No startup delay — the bootstrap call happens only when needed.
- No user API key required.

## Limitations

- Only text input is supported (`input: ["text"]`).
- Costs are set to 0 because the free tier does not expose per-request
  pricing.
- Headers, session id format and user agent are hardcoded to the values
  captured from a real `mimo run`.
