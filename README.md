# Kirby

Kirby is a local-first desktop runtime. Drop a behavioral markdown playbook on it. The main process strips foreign personas, shards the remaining mechanics, and mounts at most two of them under a locked identity core. A Plan → Act → Verify loop can rewrite a shard only when an objective gate agrees.

The window is pink and dark. The model call, if you seal a key, goes to **Ollama Cloud** or **OpenRouter** and nowhere else.

## Run

```bash
npm install
npm test
npm run dev
```

`npm run build` writes the main process, the preload bridge, and the renderer into `out/`. `npm run preview` opens that build.

## What stays where

| Piece | Process | Notes |
| --- | --- | --- |
| Identity core | Main | `resources/identity_core.md`. Injected first. No IPC can write it. |
| API keys | Main | `safeStorage` when the OS keychain is available, otherwise AES-256-GCM with a `0600` key file. The renderer can seal or clear a key. It cannot read one back. |
| Ingest, routing, verification | Main, off the UI thread | A Node worker parses, strips, and shards. The window only receives telemetry. |
| Skill shards | Disk | `skills_registry/` in development, and the app user-data directory when packaged. |
| Renderer | Isolated | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The preload exposes a typed bridge and nothing else. |

Endpoints are constants:

- Ollama Cloud: `https://ollama.com/v1`
- OpenRouter: `https://openrouter.ai/api/v1`

There is no custom base URL. A sealed key cannot be redirected.

## Models

Defaults are the strongest general models on each host as of November 2026:

- Ollama Cloud: `kimi-k3.1-pro`
- OpenRouter: `anthropic/claude-opus-5.5`

The picker also includes DeepSeek V4.1 Flash, GLM 5.3 and GLM 5.3 Prime, GPT-6.1 Sol Pro, Hy4, Muse Wonder, Claude Fable 5.2, MiMo V2.6 Pro, Mistral Large 4, MiniMax M3.1 Flash, Beam, and OpenRouter Auto Code. Batch and free variants are omitted.

Without a key, a turn is an offline rehearsal. Routing and the verification gate still run. The answer is labeled as a rehearsal.

## Inhale

1. Parse the markdown AST.
2. Drop identity claims, vendor names, and product catalogs.
3. Pack the remaining workflows into shards aimed at 200–500 tokens.
4. Write `skills_registry/*.md` plus `manifest.json` (triggers, token count, version history).
5. If a shard is over 600 tokens, distill repeated rules and keep the result only when verification passes.

During a turn the router mounts the top one or two shards inside `<absorbed_behavior>` blocks, below the identity core.

## Plan → Act → Verify

The loop is a fixed state machine: `PLANNING`, `ACTING`, `VERIFYING`, then `COMMITTED` or `REJECTED`.

A proposed shard edit is written only when all of these hold:

- The markdown still parses, keeps a heading, and does not bring a foreign identity back.
- JSON schema samples and `verifyjs` fences pass. Scripts run in a Node process with the permission model on, no filesystem write, and no API key in the environment.
- The edit does not grow the shard unless the pass rate actually improves, and it does not push a fitting shard past 600 tokens.

Failed edits stay in the diff viewer and off disk. A shard that crosses 600 tokens gets a compression pass under the same gate.

## Try it

Use **Inhale the sample** to load `resources/examples/foreign-agent-playbook.md`. The graph keeps the identity core locked in the center. Ask how to reproduce a flaky test and only the matching shards light up. **Try a bloated edit** proposes a longer shard so you can watch the gate reject it.
