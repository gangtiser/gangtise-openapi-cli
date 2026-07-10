# gangtise-openapi-cli — Technical Architecture

**Node ≥20.18.1 · ESM**

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
| `src/cli.ts` | `src/core/args.ts` |
| All commands, options, action handlers | splitCsv / collectList / collectKeyValue / parseTimestamp13 / parseIndicatorParams |

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
| O(1) endpoint lookup | CliError → Config / Validation / Download / Api | fieldList/list + chatRoomList + constants → flat objects · preserves total/meta | table / json / jsonl / csv / markdown · CSV formula injection protection |

### Request & Content Helpers

| Module | Responsibility |
|:--|:--|
| `transport.ts` | Shared `undici.Agent` (keep-alive pool) · `withRetry` exponential-backoff retry · `runWithConcurrency` concurrency control |
| `commandBodies.ts` | Complex command body construction (kline / stock-pool / wechat group) |
| `quoteSharding.ts` | Full-market date-sharded concurrency — kline (`--security all`) & fund-flow (`--security aShares`) · truncation + partial-failure tolerance (`partial` / `failedShards`) |
| `indicatorMatrix.ts` | EDE double-envelope unwrap (`unwrapIndicatorData`) · cross-section / time-series `values` matrix flattened into a wide table |
| `printer.ts` | `printData`: normalize + render + title-cache writeback |
| `titleCache.ts` | Download filename cache (list writes / download reads) · per-endpoint cap + 24h TTL |
| `asyncContent.ts` | Async polling (`pollAsyncContent` / `checkAsyncContent`) · 410110 pending / 410111 failed |

↓

## Layer 4 — Execution Flows

### QUERY FLOW `━━━`

1. `client.call(key, params)`
2. `ENDPOINT_REGISTRY` lookup
3. `kind="json"` + pagination
4. `requestPaginated()` total-driven fan-out · MAX_PAGES=1000 safety limit
5. HTTP 5xx check → `unwrapEnvelope()` → `.data`
6. `normalizeRows()` flatten fieldList/list + chatRoomList + constants · preserves total/meta
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
3. Blocking (`--wait`): shared `pollAsyncContent()` helper · exponential backoff 5s→30s · up to 14 attempts (~316s budget)
4. Handle 410110 ("generating") as pending, continue retrying
5. On 410111 ("generation failed") — terminal state, report error
5. On success: `printData()` → stdout
6. On timeout: return dataId for manual `*-check` command

### LOCAL LOOKUP `┈┈┈`

1. `requestJson()` detects `/guide/`
2. Short-circuit: no HTTP call
3. Return `lookupData.ts` directly

**Static data:**
- 100+ broker orgs
- 100+ meeting orgs

(industries / regions / announcement categories / research areas / theme IDs / Shenwan industry codes moved to the `reference constant-*` / `concept-search` / `sector-*` APIs in v0.16.0)

↓

## Layer 5 — External Services & Storage

### Gangtise OpenAPI · `https://openapi.gangtise.com`

| Domain | Base Path | Endpoints |
|:--|:--|:--|
| **Auth** | `/application/auth/oauth/open/` | loginV2 |
| **Insight** | `/application/open-insight/` | chief-opinion / summary / roadshow / site-visit / strategy-meeting / forum / broker-report / foreign-report / announcement / announcement-hk / announcement-us / foreign-opinion / independent-opinion / official-account |
| **Reference** | `/application/open-reference/` | securities/search / chiefs/search / constants/category / constants/getList / concepts/search / sectors/search / sectors/constituents |
| **Quote** | `/application/open-quote/` | kline/daily / kline-hk/daily / kline-us/daily / index/kline/daily / kline/minute / quote/realtime |
| **Fundamental** | `/application/open-fundamental/` | income-statement / income-statement-quarterly / balance-sheet / cash-flow / cash-flow-quarterly / income-statement-hk / balance-sheet-hk / cash-flow-hk / income-statement-us / balance-sheet-us / cash-flow-us / main-business / valuation-analysis / top-holders / earning-forecast |
| **Indicator** | `/application/open-indicator/` | EDE/search / EDE/cross-section / EDE/time-series |
| **AI** | `/application/open-ai/` · knowledge-* → `/application/open-data/ai/` | stock-summary / knowledge-batch / knowledge-resource / security-clue / hot-topic / one-pager / investment-logic / peer-comparison / earnings-review / viewpoint-debate / theme-tracking / research-outline / management-discuss |
| **Vault** | `/application/open-vault/` | drive / record / my-conference / wechatgroupmsg / stock-pool |
| **Alternative** | `/application/open-alternative/` | EDB/search / EDB/getData / concept/info / concept/securities |

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
| **Endpoint Registry** | Declarative · O(1) key lookup · keys derived from `ENDPOINT_DEFS` record keys via `Object.fromEntries` (key drift impossible) |
| **Auto Pagination** | Transparent multi-page · maxPageSize per endpoint · MAX_PAGES=1000 safety limit |
| **Partial-Result Tolerance** | Pagination (`requestPaginated`) and sharding (`quoteSharding`) return already-fetched rows + `partial` / `failedPages` / `failedShards` markers on a non-retryable error and stop, instead of discarding everything · process exit code 3 |
| **Envelope Unwrapping** | Detects `code` field → unwraps `{code, msg, data}` envelope; no `code` → pass-through |
| **EDE Double-Envelope + Matrix Flatten** | Indicator endpoints double-wrap (`unwrapIndicatorData` peels the inner envelope); cross-section / time-series `values` matrices flattened by `indicatorMatrix` into `{date, security, name, indicator:value}` wide rows |
| **Smart Title Cache** | Human-readable filenames · list-then-download |
| **Async Task Polling** | Shared `pollAsyncContent()` / `checkAsyncContent()` helpers · `--wait` flag · 410110/410111 handling |
| **Token Refresh Dedup** | Single in-flight refresh promise · concurrent calls coalesce |
| **Token Validation** | `isTokenCacheValid()` — single source of truth for cache/expiry check (client-time based) |

---

## Dependencies (Minimal)

**Runtime:**
- `commander` ^14.0.0
- `undici` ^7.28.0

**Dev:**
- `typescript` ^5.9.2
- `vitest` ^3.2.6
- `tsx` ^4.20.5
