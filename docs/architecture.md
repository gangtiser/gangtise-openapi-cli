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

| Entry | Command groups | Argument Parsers |
|:--|:--|:--|
| `src/cli.ts` | `src/commands/<group>.ts` | `src/core/args.ts` |
| Program, group registration order (= `--help` order), fatal / EPIPE handling, `--version` | One module per group (insight / quote / fundamental / bond / reference / vault / ai / alternative / indicator / tool / raw / auth+lookup). `shared.ts`: client acquisition, print pipeline, downloads, and `query()` — a one-request command declared as a list of fields, each an option together with the request-body key it feeds | splitCsv / collectList / collectKeyValue / parseTimestamp13 / parseIndicatorParams |

`tests/unit/cliSurface.test.ts` pins the whole command surface: every node's help text, and for every leaf one bare and one fully-optioned invocation against a local stub (exit code, request bodies, output). A structural change must leave it unchanged; an intended change to a command updates it with `-u` and a reviewed diff.

↓

## Layer 3 — Core Engine (`src/core/`)

### Infrastructure

| Configuration | Authentication | **Core Dispatcher** |
|:--|:--|:--|
| `config.ts` | `auth.ts` | **`client.ts` · GangtiseClient** |
| GANGTISE_BASE_URL / AK / SK / TIMEOUT | Token cache (0600) · AK/SK login · `isTokenCacheValid()` gated on a credential fingerprint (`accessKey` + `baseUrl`, hashed) so a cache minted for other credentials is a miss | **call() → requestPaginated / requestJson / download / uploadFile** |

### Processing

| Endpoint Registry | Error Hierarchy | Normalization | Output Renderer |
|:--|:--|:--|:--|
| `endpoints.ts` | `errors.ts` | `normalize.ts` | `output.ts` |
| O(1) endpoint lookup · per-endpoint contract flags: `pagination` / `retry` / `expects` / `destructive` (requires `--yes` on every entry point) / `itemFailures` (judge `failList` inside a `000000`) | CliError → Config / Validation / Download / Api | fieldList/list + chatRoomList + constants → flat objects · preserves total/meta | table / json / jsonl / csv / markdown · CSV formula injection protection |

### Request & Content Helpers

| Module | Responsibility |
|:--|:--|
| `transport.ts` | Shared `undici.Agent` (keep-alive pool) · `withRetry` exponential-backoff retry with per-endpoint policies (`no-replay` for replay-unsafe endpoints, `no-999999` for EDE) · `runWithConcurrency` concurrency control |
| `commandBodies.ts` | Complex command body construction (kline / stock-pool / wechat group) |
| `quoteSharding.ts` | Full-market date-sharded concurrency — kline (`aShares` / `hkStocks` / `usStocks`; the retired HK / US endpoints still take `all`, the retired index endpoint takes codes only) & fund-flow (`aShares`), each market at its own shard size · truncation + partial-failure tolerance (`partial` / `failedShards` / `truncatedShards`) |
| `indicatorMatrix.ts` | EDE double-envelope unwrap (`unwrapIndicatorData`) · cross-section / screener / time-series `values` matrix flattened into a wide table |
| `printer.ts` | `printData`: normalize + render + title-cache writeback · stages the `<file>.meta.json` sidecar (row/column counts, completeness flags, `bytes` + `sha256`) and re-reads the published path to detect a file replaced by a concurrent export (exit 4) |
| `titleCache.ts` | Download filename cache (list writes / download reads) · per-endpoint cap + 24h TTL |
| `asyncContent.ts` | Async polling (`pollAsyncContent` / `checkAsyncContent`) · pending 140001 (legacy 410110) / terminal 140002 (legacy 410111) · both the ready and pending results go through `printData`, so `--output` / `--format` hold either way |
| `fileParse.ts` | `tool file-parse`: pre-upload validation (PDF / non-empty / ≤100MB) · multipart submit → taskId · poll + stream the result ZIP (140001 = still generating) |
| `driveUpload.ts` | `vault drive-upload`: pre-upload validation (non-empty / ≤100MB / name ≤200 UTF-16 units) · multipart upload with `spaceType` / `folderId` / `title` form fields |
| `perSecurity.ts` | Splits one command into per-security requests — endpoints that accept a single code (minute-kline), or many codes × a long range that would hit the row cap — then merges in request order. Stricter than date sharding: the caller named every security, so any shard with a mismatched `fieldList` fails the whole command |
| `rowSink.ts` | `ExportSink`: ordered batched writes to disk for large `jsonl` / `csv` exports (1000-row threshold · staging file + rename · csv goes through a temp row file in two passes) |
| `calendarType.ts` | `resolveCalendarType`: picks the time-series date axis when `--calendar-type` is absent. Probes each distinct indicator's `parameterList` via the free `indicator search`; asks for `TD` only when every indicator is trading-day typed, and falls back to the server's `ND` on anything else — an unknown code, an empty `parameterList`, a failed probe. The asymmetry is deliberate: a wrong `ND` costs cells, a wrong `TD` silently empties report-period rows |

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
| **Insight** | `/application/open-insight/` | chief-opinion (v2 list + getDetail; v1 list for `--with-content`) / summary/highlight / summary / roadshow / site-visit / strategy-meeting / forum / broker-report / foreign-report / announcement / announcement-hk / announcement-us / foreign-opinion / independent-opinion / official-account / Q&A-data / report-image |
| **Reference** | `/application/open-reference/` | securities/search / chiefs/search / institutions/search / officialAccount/search / constants/category / constants/getList / concepts/search / sectors/search / sectors/constituents |
| **Quote** | `/application/open-quote/` | kline/daily / kline-hk/daily / kline-us/daily / index/kline/daily / kline/minute / quote/realtime / fund-flow/daily |
| **Fundamental** | `/application/open-fundamental/` | income-statement / income-statement-quarterly / balance-sheet / cash-flow / cash-flow-quarterly / income-statement-hk / balance-sheet-hk / cash-flow-hk / income-statement-us / balance-sheet-us / cash-flow-us / main-business / valuation-analysis / top-holders / earning-forecast |
| **Bond** | `/application/open-fundamental/bond/` · daily quote → `/application/open-quote/bond/` | basic-info / issuer-info / daily-quote-exchange-cfets / valuation-shclearing / cash-flow / announcement / issuance-detail / rating-overview / rating-change / issuer-rating-change / issuance-plan / exercise-notice (all columnar `{fieldList, list}`) |
| **Indicator** | `/application/open-indicator/` | EDE/search / EDE/cross-section / EDE/time-series / screener |
| **AI** | `/application/open-ai/` · knowledge-* → `/application/open-data/ai/` | stock-summary / knowledge-batch / knowledge-resource / security-clue / hot-topic / one-pager / investment-logic / peer-comparison / earnings-review / viewpoint-debate / theme-tracking / research-outline / management-discuss |
| **Vault** | `/application/open-vault/` | drive (list / download / getFolderList / uploadFile / createFolder / rename / moveFile / moveFolder / copy (files only) / deleteFile / deleteFolder) / record / my-conference / wechatgroupmsg / stock-pool |
| **Alternative** | `/application/open-alternative/` | EDB/search / EDB/getData / concept/v2/info / concept/v2/securities (v1 paths for `--full`) |
| **Tool** | `/application/open-tool/` | file-parse/submit / file-parse/result / web-search/search |

### Local Filesystem

| Path | Purpose |
|:--|:--|
| `~/.config/gangtise/token.json` | Cached OAuth token · expiresAt · 5min buffer · 0600 permissions |
| `~/.config/gangtise/title-cache.json` | Download filename resolution · 24h TTL · id → title |

---

## Token Resolution Chain

```
1. GANGTISE_TOKEN env  → miss →  2. Cached token (~/.config/...)  → expired OR issued for other credentials →  3. Auto-login AK/SK → POST loginV2
```

Concurrent requests coalesce into a single in-flight refresh promise (no duplicate login calls).

Step 2 compares the cache's `issuedFor` fingerprint against the configured `accessKey` + `baseUrl`; a cache belonging to another account — or one written before the field existed — is treated as a miss rather than reused. When no `accessKey` is configured there is nothing to compare and any unexpired cache is accepted, which keeps the token-cache-only setup working.

`auth login` reports the identity requests will actually use rather than always minting a new token: with `GANGTISE_TOKEN` set it returns that token and contacts nothing (`source: "env-token"`), because that token wins for every other command.

---

## Design Patterns

| Pattern | Description |
|:--|:--|
| **Endpoint Registry** | Declarative · O(1) key lookup · keys derived from `ENDPOINT_DEFS` record keys via `Object.fromEntries` (key drift impossible) |
| **Auto Pagination** | Transparent multi-page · maxPageSize per endpoint · MAX_PAGES=1000 safety limit |
| **Partial-Result Tolerance** | Pagination (`requestPaginated`) and sharding (`quoteSharding`) return already-fetched rows + `partial` / `failedPages` / `failedShards` / `truncatedShards` markers on a non-retryable error and stop, instead of discarding everything · process exit code 3 |
| **Envelope Unwrapping** | Detects `code` field → unwraps `{code, msg, data}` envelope; no `code` → pass-through |
| **EDE Double-Envelope + Matrix Flatten** | Indicator endpoints double-wrap (`unwrapIndicatorData` peels the inner envelope); `values` matrices flattened by `indicatorMatrix` into wide rows — `{security, name, indicator:value}` for cross-section / screener (`values` is `[security][indicator]`), `{date, series:value}` for time-series |
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
