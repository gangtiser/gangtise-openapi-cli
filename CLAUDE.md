# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Snapshot

This is a TypeScript CLI for Gangtise OpenAPI.

Key paths:
- `src/cli.ts` — CLI entrypoint and command wiring
- `src/core/client.ts` — auth, requests, downloads, local lookup reads
- `src/core/endpoints.ts` — endpoint registry
- `src/core/auth.ts` — token cache and credential helpers
- `src/core/config.ts` — env config and defaults
- `src/core/output.ts` — table/json/jsonl/csv/markdown rendering
- `src/core/args.ts` — reusable CLI argument collectors
- `src/core/errors.ts` — CLI/API error classes and hints
- `tests/unit/output.test.ts` — current Vitest coverage
- `src/core/lookupData.ts` — built-in lookup enums for research areas, broker orgs, meeting orgs, and industries

## Commands

Canonical commands are now defined in `package.json`:

- `npm run build` — compile the CLI to `dist/`
- `npm run dev -- --help` — run the CLI entry in development mode
- `npm test` — run Vitest unit tests
- `npm link` — expose the `gangtise` binary globally for local use

The built CLI entrypoint is exposed via the `gangtise` bin in `package.json`.

## Real API validation status

The repository has been smoke-tested against real Gangtise credentials. Confirmed working command families include:

- auth: `login`
- lookup: research areas, broker orgs, meeting orgs, industries
- insight: opinion list, summary list/download, roadshow/site-visit/strategy/forum lists, research list/download, foreign-report list/download, announcement list/download
- quote: day-kline, income-statement, main-business, valuation-analysis
- ai: knowledge-batch, knowledge-resource-download, security-clue, cloud-disk-list, one-pager, investment-logic, peer-comparison

Important implementation detail: some Gangtise endpoints do not return the standard `code/msg/status/data` envelope on success (for example cloud disk list), so the client layer must preserve compatibility with both enveloped and non-enveloped success responses.

Important API usage detail:
- the AI agent endpoints `one-pager`, `investment-logic`, and `peer-comparison` require `securityCode` rather than a freeform `query`
- the valuation-analysis endpoint requires `indicator`
- `knowledge-resource-download` can return either raw `text/plain` content or a JSON object containing a `url`, depending on resource type/source
- some knowledge resources are permission-gated or unsupported and may return codes like `10011401`, `433007`, or `410004`

## How the CLI is organized

Top-level command groups currently implemented in `src/cli.ts`:
- `auth`
- `lookup`
- `insight`
- `quote`
- `ai`
- `raw`

When adding a command:
1. Add or update the endpoint in `src/core/endpoints.ts`
2. Wire the command in `src/cli.ts`
3. Reuse helpers from `src/core/args.ts`, `src/core/output.ts`, and `src/core/errors.ts`

## Config and auth

Supported env vars:
- `GANGTISE_BASE_URL`
- `GANGTISE_TIMEOUT_MS`
- `GANGTISE_ACCESS_KEY`
- `GANGTISE_SECRET_KEY`
- `GANGTISE_TOKEN`
- `GANGTISE_TOKEN_CACHE_PATH`

Defaults:
- base URL: `https://open.gangtise.com`
- timeout: `30000`
- token cache: `~/.config/gangtise/token.json`

Auth order:
1. use `GANGTISE_TOKEN` if present
2. else use cached token if still valid
3. else log in with access key + secret key and refresh cache

## Important repository behavior

- Lookup commands for research areas, broker orgs, meeting orgs, and industries use built-in static data instead of calling live endpoints.
- There is no `vitest.config.*` file yet; tests currently use Vitest defaults.
- For paginated list commands, `--size` means the total rows requested by the user, not the per-request batch size.
- When `--size` is omitted, the client auto-fetches all rows using the API `total` field.
- Per-request batch sizing is internal to `src/core/client.ts` and uses endpoint metadata in `src/core/endpoints.ts`.
- `src/core/output.ts` should only format the already-merged result.

## Working style for this repo

- Prefer small, direct changes.
- Do not invent new abstractions unless the existing command structure clearly needs them.
- Keep output formatting centralized in `src/core/output.ts`.
- Keep API error handling consistent with `src/core/errors.ts` and `src/cli.ts`.
- Before adding new tooling or commands, re-check `package.json` as the source of truth.
