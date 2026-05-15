# gangtise-openapi-cli — Technical Architecture

**v0.13.0 · Node ≥20 · ESM**

---

## Flow Legend

| Line | Flow |
|------|------|
| `━━━` | **QUERY FLOW** (paginated JSON) |
| `╌╌╌` | **DOWNLOAD FLOW** (binary / redirect) |
| `┈┈┈` | **LOCAL LOOKUP** (short-circuit) |

---

## Layer 1 — User Entry

| CLI Binary | Dev Entry | AI Agent |
|:--|:--|:--|
| `gangtise` | `npm run dev` | Claude Code |
| dist/src/cli.js | tsx src/cli.ts | SKILL.md integration |

↓

## Layer 2 — CLI Framework

| Commander.js | Argument Parsers |
|:--|:--|
| `src/cli.ts` — ~650 lines | `src/core/args.ts` |
| All commands, options, action handlers | splitCsv / collectList / collectKeyValue / toTimestamp13 |

↓

## Layer 3 — Core Engine (`src/core/`)

### Infrastructure

| Configuration | Authentication | **Core Dispatcher** |
|:--|:--|:--|
| `config.ts` | `auth.ts` | **`client.ts` · GangtiseClient** |
| GANGTISE_BASE_URL / AK / SK / TIMEOUT | Token cache (0600) · AK/SK login · isTokenCacheValid() | **call() → requestPaginated / requestJson / download** |

### Processing

| Endpoint Registry | Error Hierarchy | Normalization | Output Renderer |
|:--|:--|:--|:--|
| `endpoints.ts` | `errors.ts` | `normalize.ts` | `output.ts` |
| 71 endpoints · O(1) lookup | CliError → Config / Validation / Download / Api | fieldList/list + chatRoomList → flat objects · preserves total/meta | table / json / jsonl / csv / markdown · CSV formula injection protection |

↓

## Layer 4 — Execution Flows

### QUERY FLOW `━━━`

1. `client.call(key, params)`
2. `ENDPOINT_REGISTRY` lookup
3. `kind="json"` + pagination
4. `requestPaginated()` loop · MAX_PAGES=1000 safety limit
5. HTTP 5xx check → `unwrapEnvelope()` → `.data`
6. `normalizeRows()` flatten fieldList/list + chatRoomList · preserves total/meta
7. `renderOutput()` → stdout · `Total: N, showing: M` → stderr

### DOWNLOAD FLOW `╌╌╌`

1. `client.call(key, undefined, query)`
2. `ENDPOINT_REGISTRY` lookup
3. `kind="download"`
4. `download()` via undici
5. Content-Type dispatch:
   - JSON → unwrapEnvelope → redirect URL or text
   - binary → Uint8Array
6. Smart filename (title cache)
7. `saveOutputIfNeeded()`

### ASYNC TASK FLOW `⏳`

1. `client.call(get-id endpoint, params)` → `{ dataId }`
2. Non-blocking: return dataId + hint
3. Blocking (`--wait`): shared `pollAsyncContent()` helper · poll every 15s × 12 attempts
4. Handle 410110 ("generating") as pending, continue retrying
5. On 410111 ("generation failed") — terminal state, report error
5. On success: `printData()` → stdout
6. On timeout: return dataId for manual `*-check` command

### LOCAL LOOKUP `┈┈┈`

1. `requestJson()` detects `/guide/`
2. Short-circuit: no HTTP call
3. Return `lookupData.ts` directly

**Static data:**
- 52 research areas
- 100+ broker orgs
- 100+ meeting orgs
- 31 industries / codes
- 19 regions / 80+ categories
- 8 theme IDs

↓

## Layer 5 — External Services & Storage

### Gangtise OpenAPI · `https://open.gangtise.com`

| Domain | Base Path | Endpoints |
|:--|:--|:--|
| **Auth** | `/application/auth/oauth/open/` | loginV2 |
| **Insight** | `/application/open-insight/` | chief-opinion / summary / roadshow / site-visit / strategy-meeting / forum / broker-report / foreign-report / announcement |
| **Quote** | `/application/open-quote/` | kline/daily / kline-hk/daily / index/kline/daily / kline/minute |
| **Fundamental** | `/application/open-fundamental/` | income-statement / income-statement-quarterly / balance-sheet / cash-flow / cash-flow-quarterly / main-business / valuation-analysis / earning-forecast / top-holders / income-statement-hk / balance-sheet-hk / cash-flow-hk |
| **AI** | `/application/open-ai/` | knowledge-batch / knowledge-resource / security-clue / one-pager / investment-logic / peer-comparison / earnings-review / theme-tracking / hot-topic / research-outline / management-discuss / viewpoint-debate |
| **Vault** | `/application/open-vault/` | drive / record / my-conference / wechatgroupmsg / stock-pool |
| **Alternative** | `/application/open-alternative/` | EDB/search / EDB/getData |

### Local Filesystem

| Path | Purpose |
|:--|:--|
| `~/.config/gangtise/token.json` | Cached OAuth token · expiresAt · 5min buffer · 0600 permissions |
| `~/.config/gangtise/title-cache.json` | Download filename resolution · 24h TTL · id → title |

---

## Token Resolution Chain

```
1. GANGTISE_TOKEN env  → miss →  2. Cached token (~/.config/...)  → expired →  3. Auto-login AK/SK → POST loginV2
```

Concurrent requests coalesce into a single in-flight refresh promise (no duplicate login calls).

---

## Design Patterns

| Pattern | Description |
|:--|:--|
| **Endpoint Registry** | Declarative · O(1) key lookup · type-safe via `satisfies` |
| **Auto Pagination** | Transparent multi-page · maxPageSize per endpoint · MAX_PAGES=1000 safety limit |
| **Envelope Unwrapping** | Detects `code` field → unwraps `{code, msg, data}` envelope; no `code` → pass-through |
| **Smart Title Cache** | Human-readable filenames · list-then-download |
| **Async Task Polling** | Shared `pollAsyncContent()` / `checkAsyncContent()` helpers · `--wait` flag · 410110/410111 handling |
| **Token Refresh Dedup** | Single in-flight refresh promise · concurrent calls coalesce |
| **Token Validation** | `isTokenCacheValid()` — single source of truth for cache/expiry check (client-time based) |

---

## Dependencies (Minimal)

**Runtime:**
- `commander` ^14.0.0
- `undici` ^7.16.0

**Dev:**
- `typescript` ^5.9.2
- `vitest` ^3.2.4
- `tsx` ^4.20.5
