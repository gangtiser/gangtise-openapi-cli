#!/usr/bin/env node
// Live contract probe. Runs a fixed set of FREE endpoints against the real API through
// the built CLI and records the shape the docs describe — column names per endpoint,
// which columns are null for which instrument class, an indicator's parameter keys and
// scope — into contracts/api-contract.json. `npm run contract` diffs the live shape
// against that snapshot; `npm run contract -- --update` rewrites it.
//
// Why: the docs consistency tests can only check the CLI against itself. What actually
// drifts is the server: the realtime column set changed twice in two months with no
// error anywhere, and both times the docs stayed wrong until someone noticed by hand.
// A diff here is a doc / skill update waiting to happen, not (necessarily) a bug.
//
// Needs credentials (GANGTISE_ACCESS_KEY / GANGTISE_SECRET_KEY, or GANGTISE_TOKEN).
// Every probe is free of credits. Values are NOT compared — only names and null-ness —
// so a normal trading day and a holiday produce the same snapshot. Row order is not part
// of the contract either: everything keyed by security is sorted before comparison.
//
// GANGTISE_CONTRACT_CLI / GANGTISE_CONTRACT_SNAPSHOT override the CLI script and the
// snapshot path — the test suite drives this file against a stand-in CLI through them.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const CLI = process.env.GANGTISE_CONTRACT_CLI ?? path.join(ROOT, "dist/src/cli.js")
const SNAPSHOT = process.env.GANGTISE_CONTRACT_SNAPSHOT ?? path.join(ROOT, "contracts/api-contract.json")

function cli(args) {
  // Exit 3 (partial) still carries rows — a --limit-capped minute-kline probe is partial
  // by design. Anything else is a real failure and must surface.
  const r = spawnSync(process.execPath, [CLI, ...args, "--format", "json"], { encoding: "utf8" })
  if (r.status !== 0 && r.status !== 3) throw new Error(`gangtise ${args.join(" ")} exited ${r.status}\n${r.stderr}`)
  return JSON.parse(r.stdout)
}
const rows = (data) => (Array.isArray(data) ? data : data.list)
const columns = (list) => [...new Set(list.flatMap((r) => Object.keys(r)))].sort()
const nullFields = (row) => Object.keys(row).filter((k) => row[k] === null).sort()
const iso = (d) => d.toISOString().slice(0, 10)
const repeat = (flag, values) => values.flatMap((v) => [flag, v])
/** Object with keys in sorted order, so JSON comparison never depends on row order. */
const sortedObject = (entries) => Object.fromEntries([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
/** One row per security: the one with the largest `key` (a date / time string). */
function latestBy(list, key) {
  const best = new Map()
  for (const r of list) {
    const prev = best.get(r.securityCode)
    if (!prev || String(r[key]) > String(prev[key])) best.set(r.securityCode, r)
  }
  return best
}

const today = new Date()
const END = iso(today)
const START = iso(new Date(today.getTime() - 14 * 86_400_000))
// One representative per instrument class the quote docs make claims about.
const QUOTE_UNIVERSE = ["600519.SH", "00700.HK", "AAPL.O", "512800.SH", "000001.SH", "880134.GT", "801010.SWI", "SPX.SPI"]
// Indicators the docs cite by code: adjust factor (ETF scope), a daily price, a
// report-period income item, a TTM valuation and market cap. Found by name because
// `indicator search` takes a keyword, then pinned by code.
const INDICATORS = [["复权因子", "qte_adj_factor"], ["收盘价", "qte_close"], ["营业收入", "is_op_rev"], ["市盈率", "finc_pe_ttm"], ["总市值", "qte_mkt_cptl"]]

const probes = {
  "quote.realtime": () => {
    const list = rows(cli(["quote", "realtime", ...repeat("--security", QUOTE_UNIVERSE)]))
    return { columns: columns(list), nullFields: sortedObject(list.map((r) => [r.securityCode, nullFields(r)])) }
  },
  "quote.day-kline": () => {
    const list = rows(cli(["quote", "day-kline", ...repeat("--security", QUOTE_UNIVERSE), "--start-date", START, "--end-date", END]))
    return { columns: columns(list), nullFields: sortedObject([...latestBy(list, "tradeDate")].map(([code, r]) => [code, nullFields(r)])) }
  },
  "quote.minute-kline": () => {
    const out = []
    for (const code of ["600519.SH", "512800.SH", "000001.SH", "SPX.SPI"]) {
      const list = rows(cli(["quote", "minute-kline", "--security", code, "--start-time", START, "--end-time", END, "--limit", "5"]))
      const first = [...list].sort((a, b) => (String(a.tradeTime) < String(b.tradeTime) ? -1 : 1))[0]
      out.push([code, { columns: columns(list), nullFields: first ? nullFields(first) : ["<no rows>"] }])
    }
    return sortedObject(out)
  },
  "quote.fund-flow": () => {
    const list = rows(cli(["quote", "fund-flow", "--security", "600519.SH", "--start-date", START, "--end-date", END]))
    return { columns: columns(list) }
  },
  "indicator.search": () => {
    const out = []
    for (const [keyword, code] of INDICATORS) {
      const hit = cli(["indicator", "search", "--keyword", keyword, "--limit", "50"]).find((r) => r.indicatorCode === code)
      out.push([code, hit
        ? {
            parameters: (hit.parameterList ?? []).map((p) => `${p.paramKey}${p.required ? "!" : ""}`).sort(),
            scope: (hit.scopeList ?? []).map((s) => `${s.market}/${s.securityType}`).sort(),
          }
        : "<not found>"])
    }
    return sortedObject(out)
  },
  "reference.constant-category": () => {
    const list = rows(cli(["reference", "constant-category"]))
    return { columns: columns(list), count: list.length }
  },
}

const update = process.argv.includes("--update")
const previous = existsSync(SNAPSHOT) ? JSON.parse(readFileSync(SNAPSHOT, "utf8")) : {}
const current = {}
// Two different outcomes, kept apart: a probe that RAN and came back different is a
// contract change (what --update exists to record); a probe that FAILED to run says
// nothing about the contract, and must never be written into the baseline as if it had.
const changed = []
const errored = []
for (const [name, probe] of Object.entries(probes)) {
  try {
    current[name] = probe()
  } catch (error) {
    errored.push(name)
    current[name] = previous[name]
    process.stderr.write(`✗ ${name}: ${error instanceof Error ? error.message : String(error)}\n`)
    continue
  }
  const before = JSON.stringify(previous[name] ?? null, null, 2)
  const after = JSON.stringify(current[name], null, 2)
  if (before === after) {
    process.stderr.write(`✓ ${name}\n`)
  } else {
    changed.push(name)
    process.stderr.write(`≠ ${name}\n--- snapshot\n${before}\n+++ live\n${after}\n`)
  }
}

if (update) {
  if (errored.length > 0) {
    process.stderr.write(`${errored.length} probe(s) failed to run (${errored.join(", ")}); the snapshot was NOT updated — a baseline must only record shapes that were actually observed.\n`)
    process.exit(1)
  }
  mkdirSync(path.dirname(SNAPSHOT), { recursive: true })
  writeFileSync(SNAPSHOT, `${JSON.stringify(current, null, 2)}\n`)
  process.stderr.write(`snapshot written: ${path.relative(ROOT, SNAPSHOT)}\n`)
  process.exit(0)
}
if (errored.length > 0 || changed.length > 0) {
  const parts = []
  if (changed.length > 0) parts.push(`${changed.length} probe(s) differ from the snapshot — update the docs/skill for what changed, then re-run with --update`)
  if (errored.length > 0) parts.push(`${errored.length} probe(s) failed to run`)
  process.stderr.write(`${parts.join("; ")}.\n`)
  process.exit(1)
}
