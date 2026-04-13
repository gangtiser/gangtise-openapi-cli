# gangtise-openapi-cli — Technical Architecture

**v0.7.0 · Node ≥20 · ESM**

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
| `src/cli.ts` — ~460 lines | `src/core/args.ts` |
| All commands, options, action handlers | splitCsv / collectList / collectKeyValue / toTimestamp13 |

↓

## Layer 3 — Core Engine (`src/core/`)

### Infrastructure

| Configuration | Authentication | **Core Dispatcher** |
|:--|:--|:--|
| `config.ts` | `auth.ts` | **`client.ts` · GangtiseClient** |
| GANGTISE_BASE_URL / AK / SK / TIMEOUT | Token cache · AK/SK login · Expiry check | **call() → requestPaginated / requestJson / download** |

### Processing

| Endpoint Registry | Error Hierarchy | Normalization | Output Renderer |
|:--|:--|:--|:--|
| `endpoints.ts` | `errors.ts` | `normalize.ts` | `output.ts` |
| 41 endpoints · O(1) lookup | CliError → Config / Validation / Download / Api | fieldList+list → flat objects | table / json / jsonl / csv / markdown |

↓

## Layer 4 — Execution Flows

### QUERY FLOW `━━━`

1. `client.call(key, params)`
2. `ENDPOINT_REGISTRY` lookup
3. `kind="json"` + pagination
4. `requestPaginated()` loop
5. `unwrapEnvelope()` → `.data`
6. `normalizeRows()` flatten
7. `renderOutput()` → stdout

### DOWNLOAD FLOW `╌╌╌`

1. `client.call(key, undefined, query)`
2. `ENDPOINT_REGISTRY` lookup
3. `kind="download"`
4. `download()` via undici
5. Content-Type dispatch:
   - JSON → unwrap → redirect URL
   - binary → Uint8Array
6. Smart filename (title cache)
7. `saveOutputIfNeeded()`

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

↓

## Layer 5 — External Services & Storage

### Gangtise OpenAPI · `https://open.gangtise.com`

| Domain | Base Path | Endpoints |
|:--|:--|:--|
| **Auth** | `/application/auth/oauth/open/` | loginV2 |
| **Insight** | `/application/open-insight/` | chief-opinion / summary / roadshow / site-visit / strategy-meeting / forum / broker-report / foreign-report / announcement |
| **Quote** | `/application/open-quote/` | kline/daily / kline-hk/daily |
| **Fundamental** | `/application/open-fundamental/` | income-statement / balance-sheet / cash-flow / main-business / valuation-analysis |
| **AI** | `/application/open-data/ai/` & `/application/open-ai/` | knowledge search / security-clue / one-pager / investment-logic / peer-comparison / earnings-review / theme-tracking / research-outline |
| **Vault** | `/application/open-vault/` | drive |

### Local Filesystem

| Path | Purpose |
|:--|:--|
| `~/.config/gangtise/token.json` | Cached OAuth token · expiresAt · 5min buffer |
| `~/.config/gangtise/title-cache.json` | Download filename resolution · 24h TTL · id → title |

---

## Token Resolution Chain

```
1. GANGTISE_TOKEN env  → miss →  2. Cached token (~/.config/...)  → expired →  3. Auto-login AK/SK → POST loginV2
```

---

## Design Patterns

| Pattern | Description |
|:--|:--|
| **Endpoint Registry** | Declarative · O(1) key lookup · type-safe via `satisfies` |
| **Auto Pagination** | Transparent multi-page · maxPageSize per endpoint |
| **Envelope Unwrapping** | Standard `{code, msg, success, data}` handling |
| **Smart Title Cache** | Human-readable filenames · list-then-download |

---

## Dependencies (Minimal)

**Runtime:**
- `commander` ^14.0.0
- `undici` ^7.16.0

**Dev:**
- `typescript` ^5.9.2
- `vitest` ^3.2.4
- `tsx` ^4.20.5