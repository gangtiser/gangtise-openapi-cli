#!/usr/bin/env node
// Stand-in for `dist/src/cli.js`, driven by scripts/contract-probe.mjs through
// GANGTISE_CONTRACT_CLI. Answers the six probes with canned shapes. FAKE_MODE:
//   ok       — the reference shapes
//   reorder  — identical contract, every row list reversed (must NOT trip the probe)
//   fail     — every command exits 1 (must never end up in a written snapshot)
//   drift    — a genuine contract change: realtime rows grow an extra column
const mode = process.env.FAKE_MODE ?? "ok"
if (mode === "fail") {
  process.stderr.write("API error (999999): boom\n")
  process.exit(1)
}
const args = process.argv.slice(2)
const values = (flag) => args.flatMap((a, i) => (a === flag ? [args[i + 1]] : []))
const order = (list) => (mode === "reorder" ? [...list].reverse() : list)
const isGlobalIndex = (code) => code.endsWith(".SPI")
const [group, command] = args
let out
if (group === "quote" && command === "realtime") {
  out = { total: 0, list: order(values("--security").map((code) => ({ securityCode: code, latestPrice: 1, volume: isGlobalIndex(code) ? null : 1, amount: isGlobalIndex(code) || code.endsWith(".O") ? null : 1, ...(mode === "drift" ? { tradeStatus: null } : {}) }))) }
} else if (group === "quote" && command === "day-kline") {
  // Two dates per security; the later one carries the null pattern the probe records,
  // so a probe that naively took "the last row seen" breaks under reorder.
  out = { total: 0, list: order(values("--security").flatMap((code) => [
    { securityCode: code, tradeDate: "2026-09-03", close: 1, amount: 1 },
    { securityCode: code, tradeDate: "2026-09-04", close: 1, amount: isGlobalIndex(code) ? null : 1 },
  ])) }
} else if (group === "quote" && command === "minute-kline") {
  const code = values("--security")[0]
  out = { total: 0, list: order([
    { securityCode: code, tradeTime: "2026-09-04 09:31:00", close: 1, volume: isGlobalIndex(code) ? null : 1 },
    { securityCode: code, tradeTime: "2026-09-04 09:32:00", close: 1, volume: 1 },
  ]) }
} else if (group === "quote" && command === "fund-flow") {
  out = { total: 1, list: [{ securityCode: "600519.SH", tradeDate: "2026-09-04", mainNetInflow: 1 }] }
} else if (group === "indicator" && command === "search") {
  const codes = { 复权因子: "qte_adj_factor", 收盘价: "qte_close", 营业收入: "is_op_rev", 市盈率: "finc_pe_ttm", 总市值: "qte_mkt_cptl" }
  const hit = { indicatorCode: codes[values("--keyword")[0]], parameterList: [{ paramKey: "tradeDate", required: true }], scopeList: [{ market: "A股", securityType: "股票" }] }
  out = order([hit, { indicatorCode: "unrelated_code", parameterList: [], scopeList: [] }])
} else if (group === "reference" && command === "constant-category") {
  out = { list: order([{ category: "a" }, { category: "b" }]) }
} else {
  process.stderr.write(`fake-gangtise: unhandled ${args.join(" ")}\n`)
  process.exit(2)
}
process.stdout.write(`${JSON.stringify(out)}\n`)
