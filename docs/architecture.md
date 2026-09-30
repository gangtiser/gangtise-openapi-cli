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
| Program, group registration (the list and its order = `--help` order live in `commands/groups.ts`), a single-value option given twice is refused (Commander would keep the last), fatal / EPIPE handling (both remove this process's staging files), `--version` | One module per group (insight / quote / fundamental / bond / fund / reference / vault / ai / alternative / indicator / tool / raw / auth+lookup). `shared.ts`: client acquisition, print pipeline, downloads, and `query()` — a one-request command declared as a list of fields, each an option together with the request-body key it feeds; the body (and its local checks) is built before a client is created | splitCsv / collectList (codes, IDs, enum values: split on commas, 、, semicolons, whitespace; de-duplicated) / collectNames (names and specs: commas only) / collectKeyValue / parseTimestamp13 / parseEndTimestamp13 (a bare end date is the whole day) / parseIndicatorParams (date values checked like `--date`) |

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
| O(1) endpoint lookup · per-endpoint contract flags: `pagination` (with `maxWindow`, the offset window a list serves) / `retry` / `expects` / `destructive` (requires `--yes` on every entry point) / `itemFailures` (judge `failList` inside a `000000`) / `estimateBilledUnits` (prices a request with no upper bound on what it bills, from its body, before it is sent) / `rowId` (the field that identifies a row, for de-duplicating across pages; `rowIdUnverified` where it comes from the response description only, so a repeat with different content is not counted) / `billing` (unit, price, `maxUnits` per request — drives the no-replay line and the credit guard) | CliError → Config / Validation / Download / Api | fieldList/list + chatRoomList + constants → flat objects · preserves total/meta | table / json / jsonl / csv / markdown · one line generator (`outputLines`) for jsonl / csv in memory, to a file and to stdout, written in line batches · CSV formula injection protection (number-shaped values left alone) · `writeFileAtomic` for whole-content writes · `publishFile`: every rename-published file goes through it and its dev / inode is recorded |

### Request & Content Helpers

| Module | Responsibility |
|:--|:--|
| `transport.ts` | Shared `undici.Agent` (keep-alive pool of `max(16, page concurrency)` sockets; undici is loaded on the first request, so `--help` and local validation never pay for it) · `withRetry` exponential-backoff retry with per-endpoint policies (`no-replay` for replay-unsafe endpoints, `no-999999` for EDE); a replay with a recovered token (`markAuthReplay`) is counted apart from those retries · total request deadline as a multiple of the idle timeout (`JSON_TOTAL_FACTOR` / `TRANSFER_TOTAL_FACTOR`) · `runWithConcurrency` concurrency control (no new item after a failure) · `runInOrder` ordered fan-out: results are consumed in input order while later items are still in flight, bounded by a window (default = concurrency; auto-pagination passes 4×, since a page is small and a shard or per-security part is not) |
| `commandBodies.ts` | Request bodies that need more than a field-to-key mapping: kline, EDE cross-section / time-series / screener (query-date injection per indicator) |
| `quoteSharding.ts` | Full-market date-sharded concurrency — kline (`aShares` / `hkStocks` / `usStocks`; the deprecated HK / US endpoints still take `all`, the deprecated index endpoint takes codes only) & fund-flow (`aShares`), each market at its own shard size counted in weekdays (a shard spans its first to last weekday; weekends never get a request of their own) · truncation + partial-failure tolerance (`partial` / `failedShards` / `truncatedShards`) · shards wholly before the account's history window (110003) skipped without stopping the rest (`outOfWindowShards`, not partial) |
| `indicatorMatrix.ts` | EDE double-envelope unwrap (`unwrapIndicatorData`) · cross-section / screener / time-series `values` matrix flattened into a wide table |
| `printer.ts` | `printData`: normalize + render + title-cache writeback · stages the `<file>.meta.json` sidecar (row/column counts, completeness flags, `bytes` + `sha256` hashed while writing) · detects a file replaced by a concurrent export (exit 4): the recorded dev / inode still at the path passes without a read-back, anything else is compared by content |
| `titleCache.ts` | Download filename cache (list writes / download reads) · per-endpoint cap + 24h TTL |
| `updateCheck.ts` | `--version` at a terminal: latest published version from the npm registry, the answer cached for 24h (`~/.config/gangtise/update-check.json`); a failed lookup is not cached |
| `asyncContent.ts` | Async polling (`pollAsyncContent` / `checkAsyncContent`) on the shared `pollUntilDone` loop (attempt budget, backoff between attempts and none after the last, transient errors wait on, anything else aborts) · pending / terminal codes in `PENDING_CODES` / `FAILED_CODES` (current and legacy codes side by side) · both the ready and pending results go through `printData`, so `--output` / `--format` hold either way |
| `fileParse.ts` | `tool file-parse`: pre-upload validation (PDF / non-empty / ≤100MB) · multipart submit → taskId · poll through `pollUntilDone` + stream the result ZIP (140001 = still generating) |
| `driveUpload.ts` | `vault drive-upload`: pre-upload validation (non-empty / ≤100MB / name ≤200 UTF-16 units) · multipart upload with `spaceType` / `folderId` / `title` form fields |
| `perSecurity.ts` | Splits one command into requests of one or several securities — one each where the endpoint accepts a single code (minute-kline), groups sized to the row cap where many codes × a long range would not fit one request (day-kline) — then merges in the caller's order (the server sorts a multi-security answer by code, so each group is put back in input order). Stricter than date sharding: the caller named every security, so any shard with a mismatched `fieldList` fails the whole command |
| `rowSink.ts` | `ExportSink`: ordered batched writes to disk for large `jsonl` / `csv` exports (1000-row threshold · written in 1000-row chunks, hashed as written · staging file + `publishFile` · csv goes through a temp row file in two passes) · `watchEarliest` keeps a date column's earliest value for checks that run after the rows have gone to disk |
| `exitStatus.ts` | The one place that sets the process exit code: `1` failed > `3` incomplete > `4` output replaced; a lighter verdict never overwrites a heavier one. A closed stdout (`\| head`) leaves with the verdict reached so far, not 0. SIGINT / SIGTERM / SIGHUP (`cli.ts`): the staging files this process named (`output.ts` `stagingPath`) are removed, then the process dies of the same signal, so a calling shell stops its script |
| `opinionDetail.ts` | Opinion `detail`: de-duplicated IDs fetched 20 per request; IDs with no body → `missingIds`, IDs after a failed batch → `unfetchedIds` (both exit 3); a first-batch failure fails the command |
| `calendarType.ts` | `resolveCalendarType`: picks the time-series date axis when `--calendar-type` is absent. Probes each distinct indicator's `parameterList` via the free `indicator search`; asks for `TD` only when every indicator is trading-day typed, and falls back to the server's `ND` on anything else — an unknown code, an empty `parameterList`, a failed probe. The asymmetry is deliberate: a wrong `ND` costs cells, a wrong `TD` silently empties report-period rows |

↓

## Layer 4 — Execution Flows

### QUERY FLOW `━━━`

1. `client.call(key, params)`
2. `ENDPOINT_REGISTRY` lookup
3. `kind="json"` + pagination
4. An endpoint with `estimateBilledUnits` is priced from the request body first, and refused past the credit guard unless `--yes` (a body it cannot read is refused too)
5. `requestPaginated()` total-driven fan-out · MAX_PAGES=1000 safety limit · a `total: 0` page with `list: null` read as empty · per-row billed list without `--size`, or with one large enough to pass the guard by itself: total read from the first page, or from a one-row probe when a full page costs over 50 credits (the probe is the result when it holds every row, or when its shape is unexpected), and min(size, total) refused past the credit guard unless `--yes` · rows repeated across pages dropped by `rowId` (`duplicateRows`); an id back on a later page with different content kept twice (`changedRows`) · `total` checked against a server-side cap by probing one row past it, or against the declared offset window (`totalCapped`)
6. HTTP 5xx check → `unwrapEnvelope()` → `.data`
7. `normalizeRows()` flatten fieldList/list + chatRoomList + constants · preserves total/meta
8. `renderOutput()` → stdout (jsonl / csv in line batches) · `Total: N, showing: M` → stderr

### DOWNLOAD FLOW `╌╌╌`

1. `client.call(key, undefined, query)`
2. `ENDPOINT_REGISTRY` lookup
3. `kind="download"`
4. `download()` via undici
5. Content-Type dispatch:
   - JSON → unwrapEnvelope → a signed URL (followed, the file named with the URL's extension) or text
   - binary → streamed to `--output`, or to a temporary name when none is given
6. Smart filename (title cache) · the temporary file renamed to it (removed if no free name is left)

### ASYNC TASK FLOW `⏳`

1. `client.call(get-id endpoint, params)` → `{ dataId }`
2. Non-blocking: return dataId + hint
3. Blocking (`--wait`): shared `pollAsyncContent()` helper · exponential backoff 5s→30s · up to 14 attempts (~316s budget)
4. A pending code (`PENDING_CODES`, "generating") → keep polling
5. A terminal code (`FAILED_CODES`, "generation failed") → report the error
6. On success: `printData()` → stdout
7. On timeout: return dataId for manual `*-check` command

### LOCAL LOOKUP `┈┈┈`

1. `lookup … list` reads the bundled table (`getLookupData`) — no client, no HTTP
2. `raw call lookup.*` goes through the client, whose `requestJson()` short-circuits `/guide/` paths to the same tables

**Static data:**
- 100+ broker orgs
- 100+ meeting orgs

(industries / regions / announcement categories / research areas / theme IDs / Shenwan industry codes come from the `reference constant-*` / `concept-search` / `sector-*` APIs)

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
| **Fund** | `/application/open-fundamental/fund/` · NAV → `/application/open-quote/fund/nav` | basic-info / fee-rate / manager-info / manager-history / asset-size / holder-structure / top10-holders / asset-allocation / stock-portfolio / industry-allocation / bond-portfolio / bond-type-allocation / fund-portfolio / fund-type-allocation / etf-pcf-header / etf-pcf-components / etf-share-change (all `{list}`, no paging) |
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

**Recovery** when the server rejects a token (`AUTH_RETRY_CODES`): a token someone else already obtained is used first — one in memory that another request refreshed, or one another process wrote to the cache file. A token that did not come from this process's own login is unproven, so each request replays with such a token at most once, and a failure after that logs in; a token this process's login minted that fails too ends the recovery. These replays do not count against `withRetry`'s transient retries.

Step 2 compares the cache's `issuedFor` fingerprint against the configured `accessKey` + `baseUrl`; a cache belonging to another account — or one written before the field existed — is treated as a miss rather than reused. When no `accessKey` is configured there is nothing to compare and any unexpired cache is accepted, which keeps the token-cache-only setup working.

`auth login` reports the identity requests will actually use rather than always minting a new token: with `GANGTISE_TOKEN` set it returns that token and contacts nothing (`source: "env-token"`), because that token wins for every other command.

---

## Design Patterns

| Pattern | Description |
|:--|:--|
| **Endpoint Registry** | Declarative · O(1) key lookup · keys derived from `ENDPOINT_DEFS` record keys via `Object.fromEntries` (key drift impossible) |
| **Auto Pagination** | Transparent multi-page · maxPageSize per endpoint · MAX_PAGES=1000 safety limit |
| **Partial-Result Tolerance** | Pagination (`requestPaginated`) and sharding (`quoteSharding`) return already-fetched rows + `partial` / `failedPages` / `failedShards` / `truncatedShards` / `duplicateRows` / `changedRows` / `totalCapped` markers on a non-retryable error and stop, instead of discarding everything · process exit code 3 |
| **Envelope Unwrapping** | Detects `code` field → unwraps `{code, msg, data}` envelope; no `code` → pass-through |
| **EDE Double-Envelope + Matrix Flatten** | Indicator endpoints double-wrap (`unwrapIndicatorData` peels the inner envelope); `values` matrices flattened by `indicatorMatrix` into wide rows — `{security, name, indicator:value}` for cross-section / screener (`values` is `[security][indicator]`), `{date, series:value}` for time-series |
| **Smart Title Cache** | Human-readable filenames · list-then-download |
| **Async Task Polling** | One `pollUntilDone()` loop behind AI async content and file-parse · `checkAsyncContent()` for a single check · `--wait` flag · pending / terminal codes, legacy and current |
| **Response-Shape Contract** | An endpoint declares the layout it must return (`expects: "list"` / `"array"`); the client checks it once for every command and fails with a structural error carrying the traceId, instead of each command guessing |
| **Billing-Derived Guards** | The registry's `billing` feeds the checks: per-call / per-page billed endpoints are `no-replay`; so is a per-row / per-document endpoint whose single request can bill past `NO_REPLAY_ABOVE_CREDITS` (`worstRequestCredits`); a per-row list fetched without `--size`, or with a large one, is priced from its total and refused past `COSTLY_FETCH_CREDITS`; an endpoint with no upper bound per request (`maxUnits: Infinity`) must declare `estimateBilledUnits`, and is priced from its body before it is sent — on every entry point |
| **Token Refresh Dedup** | Single in-flight refresh promise · concurrent calls coalesce · recovery prefers a token already refreshed elsewhere (see Token Resolution Chain) |
| **Token Validation** | `isTokenCacheValid()` — single source of truth for cache/expiry check (client-time based) |

---

## Dependencies (Minimal)

**Runtime:**
- `commander` ^14.0.0
- `undici` ^7.29.1

**Dev:**
- `typescript` ^5.9.2
- `vitest` ^3.2.6
- `@types/node` ^20.19.43
- `tsx` ^4.20.5
