import { Command } from "commander"

import { collectList, dateArg, datetimeArg, maybeArray, parseOptionalNumberOption } from "../core/args.js"
import { buildQuoteKlineBody } from "../core/commandBodies.js"
import { callPerSecurity, estimateTradingDays } from "../core/perSecurity.js"
import { callKlineWithSharding, isFullMarket } from "../core/quoteSharding.js"
import { ValidationError } from "../core/errors.js"
import { flagMissingFields } from "../core/normalize.js"
import { parseOutputFormat } from "../core/output.js"
import { printData } from "../core/printer.js"
import { rowCount } from "../core/rowSink.js"
import { emit, withClient, DEFAULT_QUOTE_LIMIT, MAX_QUOTE_LIMIT, flagIfLimitTruncated, noteLateStart } from "./shared.js"

export const quote = new Command("quote").description("Quote APIs")

/** Whole-market keywords an endpoint accepts, mapped to weekdays per shard. A shard holds
 * (rows per trading day x shardDays) and must stay under the 10K-row API cap. A-shares
 * and US each list several thousand securities per day, so they take one weekday per
 * shard; HK is roughly half that and takes two.
 *
 * These universes grow with listings, and the counts are not pinned here on purpose —
 * they drift. What to watch is the product: when a market's rows per trading day
 * approach 10K / shardDays, cut shardDays. The measured per-market counts, each with
 * the date it was taken, are in the `bug/` ledger.
 *
 * The unified `day-kline` dropped the old `all` keyword on 2026-08-14 in favour of the
 * three market keywords, which must each be sent alone. Of the menu-retired per-market
 * endpoints, the HK and US ones still take `all`; the index one answers `all` with
 * `000000` and an empty list (probed 2026-09-24 over four windows back to 2024, three
 * samples each, while explicit index codes return rows), so it takes no keyword here and
 * `all` is refused before anything is sent. */
type MarketShardDays = Record<string, number>
const KLINE_MARKETS: MarketShardDays = { aShares: 1, hkStocks: 2, usStocks: 1 }
const LEGACY_ALL_MARKET = (shardDays: number): MarketShardDays => ({ all: shardDays })
/** Realtime takes the same keywords but returns one snapshot per security, so there is
 * nothing to shard and it only needs the accepted-keyword list. */
const REALTIME_MARKETS = ["aShares", "hkStocks", "usStocks"]
/** fund-flow is A-share only, so `aShares` is its sole whole-market keyword. */
const FUND_FLOW_MARKETS = ["aShares"]

/** Every keyword the quote APIs have ever taken, including ones a given command no
 * longer accepts. What an unrecognised keyword does depends on the endpoint, and BOTH
 * outcomes are worth a local error: the unified `day-kline` / `realtime` / `fund-flow`
 * answer `120001` "invalid security code" (which sends the user hunting for a typo in a
 * code that is fine), while the menu-retired per-market endpoints answer `code=000000`
 * with `total: 0` — a silent empty result indistinguishable from "no data".
 *
 * Compared lower-cased, and 🔴 **that folding is load-bearing, not tidiness** — the API's
 * own case handling used to differ BY ENDPOINT. Re-probed 2026-08-24 (curl direct, all six):
 *
 *   folds case:      ALL SIX, including fund-flow — `aShares` / `ashares` / `ASHARES` /
 *                    `AShares` / `aSHARES` all return the same rows.
 *
 * Until 2026-08-21 `fund-flow` was the lone exception: only the literal `aShares` worked
 * and every other casing came back as `120001 非有效A股`. That is fixed server-side now,
 * so canonicalising is no longer load-bearing for correctness anywhere — on every endpoint
 * it merely keeps our shard lookup in step with the server (drop it and a case variant
 * degrades to an unsharded 6000-row request).
 *
 * Keep it anyway: it normalises rather than rejects, so it can only be more forgiving than
 * the server, and it costs nothing. The fund-flow case test stays as a regression pin —
 * but note it now pins OUR normalisation, not a server-side quirk.
 *
 * ⚠️ `all` collides with a real ticker root (`ALL` is Allstate on the NYSE), so a bare
 * `--security ALL` fetches the whole US market instead of that stock. That resolution
 * happens on the SERVER (`ALL` / `All` / `all` are equivalent to it on the two retired
 * per-market endpoints that still take it), so matching case-sensitively here would not prevent it — it would only stop
 * us from sharding a request the server treats as whole-market anyway, turning a complete
 * result into a 6000-row truncation. The fix for that user is the suffixed `ALL.N`.
 *
 * Unknown keywords are deliberately NOT rejected — this is a known-keyword list, so a
 * future server-side addition degrades to "unsharded" rather than being refused outright
 * (fail-open, no enum drift). */
const MARKET_KEYWORDS = new Set(["all", "ashares", "hkstocks", "usstocks"])
const matchesMarketKeyword = (value: string, keyword: string): boolean =>
  value.toLowerCase() === keyword.toLowerCase()
export const checkMarketKeywords = (securities: string[], accepted: readonly string[], command: string, noKeywordReason?: string): void => {
  const used = securities.filter((s) => MARKET_KEYWORDS.has(s.toLowerCase()))
  if (used.length === 0) return
  // Report an unsupported keyword before the alone-ness rule: when both are wrong, the
  // keyword itself is the thing the user has to change.
  const unsupported = used.filter((k) => !accepted.some((a) => matchesMarketKeyword(k, a)))
  if (unsupported.length > 0) {
    throw new ValidationError(accepted.length > 0
      ? `${command}: '${unsupported[0]}' is not a whole-market keyword for this command — use ${accepted.join(" / ")}`
      : `${command}: this command takes explicit security codes only — '${unsupported[0]}' and other whole-market keywords are not supported${noKeywordReason ? `: ${noKeywordReason}` : ""}`)
  }
  // The API rejects a keyword sent alongside security codes or a second keyword, again
  // as a bare 120001 that points at the codes rather than at the combination. On
  // `fund-flow` it is worse than a rejection: the keyword is silently dropped and only
  // the explicit codes come back, exit 0.
  if (securities.length > 1) {
    throw new ValidationError(`${command}: a market keyword must be passed alone, got '${securities.join(", ")}' — the API rejects it mixed with security codes or another keyword`)
  }
}

/** Fold a user-typed keyword back to the spelling the sharding lookup expects, so a case
 * variant reaches the same code path as the canonical form. Non-keywords pass through
 * untouched. */
const canonicalizeMarketKeywords = (securities: string[], accepted: readonly string[]): string[] =>
  securities.map((s) => accepted.find((a) => matchesMarketKeyword(s, a)) ?? s)

/** `--field` plus the columns a row needs to be told apart. The quote endpoints return ONLY
 * the requested columns (fund-flow excepted), so `--field close` over several securities
 * answers bare closes that cannot be tied to a security or a date — and their order
 * differs between a single request (sorted by code) and a per-security merge (input
 * order), so position does not help either. Adds the missing ones in front and says so.
 * Callers pass none for a single security: its rows cannot be mixed up with another
 * security's, and adding a date column would change what single-security scripts get —
 * one that needs the dates names them in --field. */
function withIdentityFields(fieldList: string[] | undefined, identity: string[], label: string): string[] | undefined {
  if (!fieldList) return fieldList
  const missing = identity.filter((field) => !fieldList.includes(field))
  if (missing.length === 0) return fieldList
  const says = [missing.includes("securityCode") ? "security" : "", missing.some((f) => f !== "securityCode") ? "time" : ""].filter(Boolean).join(" and ")
  process.stderr.write(`[gangtise] note: ${label} adds ${missing.join(", ")} to --field so each row says which ${says} it belongs to.\n`)
  return [...missing, ...fieldList]
}

const addKlineCommand = (name: string, endpointKey: string, securityHelp: string, markets: MarketShardDays, noKeywordReason?: string) =>
  quote.command(name)
    .option("--security <code>", securityHelp, collectList, [])
    .option("--start-date <date>", "Start date (default: 1 year before end-date)", dateArg("--start-date"))
    .option("--end-date <date>", "End date (default: latest)", dateArg("--end-date"))
    .option("--limit <number>", `Max rows per request (default: ${DEFAULT_QUOTE_LIMIT}, max: ${MAX_QUOTE_LIMIT}). With several securities it also sizes the groups they are fetched in, so a small value fetches one security per request`)
    .option("--field <field>", "Field", collectList, [])
    .option("--format <format>", "Output format", "table")
    .option("--output <path>")
    .action((options) => {
      // Validate BEFORE withClient: createClient() logs in when no token is cached, so a
      // check inside the callback would spend a request to then fail locally anyway.
      checkMarketKeywords(options.security, Object.keys(markets), `quote ${name}`, noKeywordReason)
      options.security = canonicalizeMarketKeywords(options.security, Object.keys(markets))
      // A whole-market keyword is date-sharded, and the server answers an unbounded
      // whole-market request with 100003 查询规模过大 rather than a truncated page (probed
      // 2026-09-25) — so require the range here, before any login or request, the way
      // fund-flow already does.
      const fullMarketKeyword = Object.keys(markets).find((k) => (options.security as string[]).includes(k))
      if (fullMarketKeyword && (!options.startDate || !options.endDate)) {
        throw new ValidationError(`quote ${name} --security ${fullMarketKeyword} requires both --start-date and --end-date (the full market is fetched via date shards; an unbounded whole-market request is rejected by the server)`)
      }
      return withClient(options, async (client) => {
      const format = parseOutputFormat(options.format)
      // A streamed export keeps no rows in memory; the sink notes the earliest date for noteLateStart.
      client.rowSink?.watchEarliest("tradeDate")
      const body = buildQuoteKlineBody(options)
      const severalSecurities = (body.securityList?.length ?? 0) > 1 || fullMarketKeyword !== undefined
      body.fieldList = withIdentityFields(body.fieldList, severalSecurities ? ["securityCode", "tradeDate"] : [], `quote ${name}`)
      // Each market shards at its own granularity, so resolve which keyword was asked
      // for before picking shardDays — a whole-market HK pull tolerates 2-weekday windows
      // where A-share and US pulls need one weekday each.
      const keyword = Object.keys(markets).find((k) => isFullMarket(body, k))
      if (keyword) {
        // A whole-market query is date-sharded: callKlineWithSharding lifts the limit to
        // the API max and owns completeness (partial / failedShards), so leave `limit`
        // unset and skip the single-request truncation guard.
        // A null answer never reaches here: the endpoint's `expects: "list"` fails it
        // inside the client, envelope traceId attached (endpoints.ts).
        const data = await callKlineWithSharding(client, endpointKey, body, { shardDays: markets[keyword], fullMarketValue: keyword })
        flagMissingFields(data, body.fieldList, `quote ${name}`)
        noteLateStart(data, body.startDate, "tradeDate", `quote ${name}`)
        await printData(data, format, options.output)
        return
      }
      // Explicit securities: pin the limit to the known default so the sent limit and the
      // truncation cap are the same number by construction.
      const limit = body.limit ?? DEFAULT_QUOTE_LIMIT
      const securities = body.securityList ?? []
      const tradingDays = estimateTradingDays(body.startDate, body.endDate)
      // Several securities over a range that would not fit one request go out in groups,
      // each sized to fit one request, merged in input order. One request would come back
      // capped at `limit` with the tail securities missing (partial + exit 3). A request
      // is only ever planned to BELOW its cap: a full answer that lands exactly on the cap
      // reads as truncated. Without --limit a group uses the endpoint's row ceiling; with
      // it, every request keeps the limit given, so a security longer than the limit still
      // goes alone and is flagged as before.
      if (securities.length > 1 && securities.length * tradingDays >= limit) {
        const cap = body.limit ?? MAX_QUOTE_LIMIT
        const groupSize = Math.max(1, Math.floor((cap - 1) / tradingDays))
        const data = await callPerSecurity(client, endpointKey, securities, (codes) => ({ ...body, securityList: codes, limit: cap }), cap, `quote ${name}`, groupSize)
        flagMissingFields(data, body.fieldList, `quote ${name}`)
        noteLateStart(data, body.startDate, "tradeDate", `quote ${name}`)
        await printData(data, format, options.output)
        return
      }
      const data = await client.call(endpointKey, { ...body, limit })
      flagIfLimitTruncated(data, limit, name)
      flagMissingFields(data, body.fieldList, `quote ${name}`)
      noteLateStart(data, body.startDate, "tradeDate", `quote ${name}`)
      await printData(data, format, options.output)
      })
    })
addKlineCommand("day-kline", "quote.day-kline", "Security code — A-share .SH/.SZ/.BJ, ETF .SH/.SZ (e.g. 512800.SH), HK .HK, US .O/.N/.A, exchange index .SH/.SZ/.BJ, concept index .GT, industry index .CI/.SWI, global index (e.g. SPX.SPI / N225.NKI / HSI.HI); or one market keyword: aShares / hkStocks / usStocks (auto-sharded by date, must be passed alone; keywords cover stocks only — ETFs and indices must be listed by code)", KLINE_MARKETS)
addKlineCommand("day-kline-hk", "quote.day-kline-hk", "[deprecated: use 'day-kline'] Security code (HK stock: .HK, or 'all' for full market)", LEGACY_ALL_MARKET(2))
addKlineCommand("day-kline-us", "quote.day-kline-us", "[deprecated: use 'day-kline'] Security code (US stock: e.g. AAPL.O, or 'all' for full market)", LEGACY_ALL_MARKET(1))
addKlineCommand("index-day-kline", "quote.index-day-kline", "[deprecated: use 'day-kline'] Index code (.SH/.SZ/.BJ), repeat for several; no whole-market keyword — 'all' is refused because the endpoint answers it with an empty result", {}, "the endpoint answers 'all' with an empty result. List the index codes one by one — quote day-kline takes the same codes")
quote.command("minute-kline")
  .option("--security <code>", "Security code — A-share .SH/.SZ (SH/SZ only), ETF .SH/.SZ (e.g. 512800.SH), exchange index .SH/.SZ, concept index .GT, industry index .CI/.SWI, global index (e.g. SPX.SPI / N225.NKI / HSI.HI); repeat for several — one request each, run concurrently and merged; no whole-market keyword", collectList, [])
  .option("--start-time <datetime>", "Start time (yyyy-MM-dd HH:mm:ss)", datetimeArg("--start-time"))
  .option("--end-time <datetime>", "End time (yyyy-MM-dd HH:mm:ss)", datetimeArg("--end-time"))
  .option("--limit <number>", `Max rows per request (default: ${DEFAULT_QUOTE_LIMIT}, max: ${MAX_QUOTE_LIMIT})`)
  .option("--field <field>", "Field", collectList, [])
  .option("--format <format>", "Output format", "table")
  .option("--output <path>")
  .action((options) => withClient(options, async (client) => {
  const format = parseOutputFormat(options.format)
  client.rowSink?.watchEarliest("tradeTime")
  const limit = parseOptionalNumberOption(options.limit, "--limit", { integer: true, min: 1, max: MAX_QUOTE_LIMIT }) ?? DEFAULT_QUOTE_LIMIT
  const securities = options.security as string[]
  if (securities.length === 0) throw new ValidationError("--security is required (repeat it for several securities)")
  const fieldList = withIdentityFields(maybeArray<string>(options.field), securities.length > 1 ? ["securityCode", "tradeTime"] : [], "quote minute-kline")
  const makeBody = (code: string) => ({ securityCode: code, startTime: options.startTime, endTime: options.endTime, limit, fieldList })
  // The API takes ONE securityCode per request; several go out concurrently and merge in
  // input order (callPerSecurity owns the per-security truncation flag).
  const data = securities.length === 1
    ? await client.call("quote.minute-kline", makeBody(securities[0]))
    : await callPerSecurity(client, "quote.minute-kline", securities, ([code]) => makeBody(code), limit, "quote minute-kline")
  if (securities.length === 1) flagIfLimitTruncated(data, limit, "minute-kline", "--start-time/--end-time")
  flagMissingFields(data, fieldList, "quote minute-kline")
  noteLateStart(data, options.startTime, "tradeTime", "quote minute-kline")
  // Minute bars keep a far shorter history than daily bars, and a range entirely before
  // it comes back as an empty success, not the 110003 a daily range there gets (probed
  // 2026-09-25) — so an empty answer says nothing about whether trading happened.
  if (rowCount(data) === 0 && (options.startTime || options.endTime)) {
    process.stderr.write(`[gangtise] note: no minute bars came back. Minute bars cover a much shorter history than daily bars, and a range entirely before it returns nothing rather than an error — try a recent range to check.\n`)
  }
  await printData(data, format, options.output)
}))
quote.command("realtime")
  .description("Realtime quote snapshot (A-share / HK / US stocks, ETFs, and indices incl. global indices)")
  .option("--security <code>", "Security code — stock .SH/.SZ/.BJ/.HK/.O/.N/.A, ETF .SH/.SZ (e.g. 512800.SH), exchange index .SH/.SZ/.BJ, concept index .GT, industry index .CI/.SWI, global index (e.g. SPX.SPI / N225.NKI / HSI.HI); or one market keyword: aShares / hkStocks / usStocks (must be passed alone; keywords cover stocks only — ETFs and indices have no whole-market keyword)", collectList, [])
  .option("--field <field>", "Field", collectList, [])
  .option("--format <format>", "Output format", "table")
  .option("--output <path>")
  .action((options) => {
  // Realtime takes the same market keywords as day-kline but never shards (one snapshot
  // per security), so it only needs the "alone, and a keyword this API knows" check.
  checkMarketKeywords(options.security, REALTIME_MARKETS, "quote realtime")
  return emit(options, async (client) => {
    const securities = options.security as string[]
    const severalSecurities = securities.length > 1 || securities.some((s) => REALTIME_MARKETS.some((keyword) => matchesMarketKeyword(s, keyword)))
    const fieldList = withIdentityFields(maybeArray<string>(options.field), severalSecurities ? ["securityCode"] : [], "quote realtime")
    const data = await client.call("quote.realtime", { securityList: maybeArray(options.security), fieldList })
    flagMissingFields(data, fieldList, "quote realtime")
    return data
  })
})
quote.command("fund-flow")
  .description("A-share daily fund flow (SH/SZ/BJ)")
  .option("--security <code>", "Security code (e.g. 600519.SH / 920982.BJ), or 'aShares' for full A-share market — auto-sharded by day (repeat)", collectList, [])
  .option("--start-date <date>", "Start date yyyy-MM-dd (default: endDate minus 1 year)", dateArg("--start-date"))
  .option("--end-date <date>", "End date yyyy-MM-dd (default: latest trading day)", dateArg("--end-date"))
  .option("--limit <number>", `Max rows per request (default: ${DEFAULT_QUOTE_LIMIT}, max: ${MAX_QUOTE_LIMIT}; single-security cap — aShares auto-shards by day)`)
  .option("--field <field>", "Field, e.g. mainNetInflow/largeInflow/xlargeOutflow (repeat); omit for all", collectList, [])
  .option("--format <format>", "Output format", "table")
  .option("--output <path>")
  .action((options) => {
  // fund-flow needs this guard MORE than the kline commands, not less: mixing the keyword
  // with codes doesn't even fail here. The server silently drops `aShares` and answers
  // with just the explicit codes — one row, exit 0, no warning — so "whole market plus
  // this one" quietly becomes "only this one". Validate before withClient so no login
  // request is spent on a query that fails locally.
  checkMarketKeywords(options.security, FUND_FLOW_MARKETS, "quote fund-flow")
  options.security = canonicalizeMarketKeywords(options.security, FUND_FLOW_MARKETS)
  return withClient(options, async (client) => {
  const format = parseOutputFormat(options.format)
  client.rowSink?.watchEarliest("tradeDate")
  const body = {
    securityList: maybeArray<string>(options.security),
    startDate: options.startDate,
    endDate: options.endDate,
    limit: parseOptionalNumberOption(options.limit, "--limit", { integer: true, min: 1, max: MAX_QUOTE_LIMIT }),
    fieldList: maybeArray<string>(options.field),
  }
  if (isFullMarket(body, "aShares")) {
    // Full-market fund-flow: the server errors (430012/430013) instead of truncating when
    // a single request exceeds the row cap, so date-shard by day (~5.4k A-share rows/day,
    // under the lifted API cap) and merge — same mechanism as `--security all` kline.
    // Sharding needs an explicit range; without both dates it would fall back to one
    // doomed full-market request, so require the range up front with a clear message.
    if (!body.startDate || !body.endDate) {
      throw new ValidationError("quote fund-flow --security aShares requires both --start-date and --end-date (the full market is fetched via per-day shards)")
    }
    const data = await callKlineWithSharding(client, "quote.fund-flow", body, { shardDays: 1, fullMarketValue: "aShares" })
    flagMissingFields(data, body.fieldList, "quote fund-flow")
    noteLateStart(data, body.startDate, "tradeDate", "quote fund-flow")
    await printData(data, format, options.output)
    return
  }
  const limit = body.limit ?? DEFAULT_QUOTE_LIMIT
  const data = await client.call("quote.fund-flow", { ...body, limit })
  flagIfLimitTruncated(data, limit, "fund-flow")
  flagMissingFields(data, body.fieldList, "quote fund-flow")
  noteLateStart(data, body.startDate, "tradeDate", "quote fund-flow")
  await printData(data, format, options.output)
  })
})
