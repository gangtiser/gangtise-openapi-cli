import { describe, expect, it } from "vitest"

import { ApiError, attachEnvelopeTraceId, ConfigError, DownloadError, ValidationError } from "../../src/core/errors.js"

describe("ApiError", () => {
  it("stores code, statusCode, and details", () => {
    const err = new ApiError("fail", "123", 400, { extra: true })
    expect(err.message).toBe("fail")
    expect(err.code).toBe("123")
    expect(err.statusCode).toBe(400)
    expect(err.details).toEqual({ extra: true })
  })

  it("provides hint for known error codes", () => {
    const err = new ApiError("access key error", "8000014")
    expect(err.hint).toContain("ACCESS_KEY")
  })

  it("hints 100003 to read the server msg first — it usually does name the field", () => {
    // Probed 2026-07-20: msg carries the field or range ("请求体字段类型不匹配: size
    // 期望类型 Integer", "limit 最小为 1，最大为 10000"). The old hint claimed the
    // opposite and contradicted the msg it was printed after.
    const hint = new ApiError("请求体字段类型不匹配: size 期望类型 Integer", "100003").hint
    expect(hint).toContain("msg")
    expect(hint).toContain("枚举")
    expect(hint).not.toContain("不会指明")
  })

  it("names the --indicator-param fix when 100003 says a report-period indicator wants reportDate", () => {
    // 100003 is the catch-all for every EDE input error, so its per-code hint can only
    // be generic. This one message identifies a specific cause the server names but
    // does not tell you how to fix from the CLI: the caller is told "缺少必填参数
    // reportDate" and still has to work out it needs --indicator-param, not --date.
    const hint = new ApiError("指标 is_op_rev 不支持参数 tradeDate; 指标 is_op_rev 缺少必填参数 reportDate", "100003").hint
    expect(hint).toContain("--indicator-param")
    expect(hint).toContain("reportDate")
  })

  it("fires the same reportDate hint under 100001, which carries the identical message", async () => {
    // The server sends this sentence under either code: `is_op_rev` answers 100003,
    // `div_cash_yld` answers 100001 (both probed 2026-08-15). Keying the rule on one
    // code alone would let the other fall back to a generic hint with no warning.
    const hint = new ApiError("指标 div_cash_yld 缺少必填参数 reportDate", "100001").hint
    expect(hint).toContain("--indicator-param")
  })

  it("does not claim the affected indicators can be identified by code prefix", async () => {
    // 170-indicator survey (2026-08-15): 7 `finc_*` and 3 `div_*` want reportDate,
    // while 8 `is_*` and 4 `cf_*` want tradeDate — a prefix rule is wrong in BOTH
    // directions, and this text ships to customers in dist/.
    const hint = new ApiError("指标 x 缺少必填参数 reportDate", "100003").hint ?? ""
    expect(hint).toContain("parameterList")
    expect(hint).not.toMatch(/`is_\*`.*只吃|行情 \/ 估值类（qte_\* \/ finc_\*）不受影响/)
  })

  it("does not assert reportDate when the server only says tradeDate was refused", () => {
    // 半句 vs 拼接句. "不支持参数 tradeDate" alone proves nothing about what the
    // indicator DOES want: `scr_exchg_mkt` declares an empty parameterList and refuses
    // reportDate too, `div_cash_paid_ratio` wants fiscalYear. Through v0.34.1 one regex
    // OR-ed this with the concatenated form, so both got the assertive reportDate text
    // and following it landed on "不支持参数 reportDate" — a shape with no rule at all.
    const hint = new ApiError("指标 scr_exchg_mkt 不支持参数 tradeDate", "100003").hint ?? ""
    expect(hint).not.toMatch(/要的是 reportDate/)
    expect(hint).toContain("parameterList")
    // Must name the fix that actually works from cross-section. It used to send the
    // caller to `indicator time-series`; once the `"<code>:"` opt-out landed that was
    // no longer true, and the hint contradicted the help text on the same flag.
    expect(hint).toContain('"<指标code>:"')
  })

  it("keeps the assertive reportDate hint on the concatenated message", () => {
    // The other half of the split above: when the server DOES name reportDate as the
    // missing key, the hint may and should assert it. Pins the discriminator (presence
    // of the 缺少必填参数 half) rather than the order of the rule array.
    const hint = new ApiError("指标 is_op_rev 不支持参数 tradeDate; 指标 is_op_rev 缺少必填参数 reportDate", "100003").hint ?? ""
    expect(hint).toContain("要的是 reportDate")
    expect(hint).not.toContain("没说该换成哪个")
  })

  it("hints the reportDate-refused shape the old single regex never matched", () => {
    // What a user got by following the old hint on scr_exchg_mkt: they add reportDate,
    // the server refuses that too, and 100003's generic "对照 --help 检查枚举" leaves
    // them stuck. Probed live 2026-08-15.
    const hint = new ApiError("指标 scr_exchg_mkt 不支持参数 reportDate", "100003").hint ?? ""
    expect(hint).toContain("parameterList")
    expect(hint).toContain('"<指标code>:"')
  })

  it("tells the caller to SWAP when the server names both halves the other way round", () => {
    // Mirror of the concatenated reportDate shape. Writing the keys backwards
    // (`qte_close:reportDate=...`) yields "不支持参数 reportDate; 缺少必填参数
    // tradeDate". Before 2026-08-16 this fell to the non-assertive rule, which claimed
    // "服务端没说该换成哪个" — false, it named both — and prescribed the `"<code>:"`
    // opt-out, which is a DEAD END here (`100001 缺少必填参数 tradeDate`). Probed live.
    const hint = new ApiError("指标 qte_close 不支持参数 reportDate; 指标 qte_close 缺少必填参数 tradeDate", "100003").hint ?? ""
    expect(hint).not.toContain("没说该换成哪个")
    expect(hint).toContain("tradeDate=")
    // Must actively warn AGAINST the opt-out here: the server said it wants a date.
    expect(hint).toMatch(/别在这一步用|⚠️/)
  })

  it("still routes the mirror-image concatenated shape to the reportDate rule", () => {
    // Guards the new swap rule from swallowing the original ① shape, which has richer
    // CLI-specific advice. Both halves present, but the missing key is reportDate.
    const hint = new ApiError("指标 is_op_rev 不支持参数 tradeDate; 指标 is_op_rev 缺少必填参数 reportDate", "100003").hint ?? ""
    expect(hint).toContain("要的是 reportDate")
  })

  it("hints the both-dates-required second wall (缺少必填参数 tradeDate)", () => {
    // K13: supplying reportDate suppresses CLI's tradeDate injection, so div_cash_yld
    // (both required) fails on the second date. Previously fell to 100001's generic
    // "对照命令 --help 检查必填项", which does not say --indicator-param.
    const hint = new ApiError("指标 div_cash_yld 缺少必填参数 tradeDate", "100001").hint ?? ""
    expect(hint).toContain("--indicator-param")
    expect(hint).toContain("tradeDate=")
    // Two paths now suppress the injection (a caller-supplied reportDate, or the
    // `"<code>:"` opt-out), so the hint must not assert which one the caller took —
    // it said "你已经给了 reportDate" to someone who had only used the opt-out.
    expect(hint).not.toMatch(/你已经给了 reportDate/)
  })

  it("does not give a singular assertive hint when the server named several indicators", () => {
    // `cross-section` is a BATCH endpoint: one 100003 routinely carries clauses for
    // several indicators with different causes. Probed 2026-08-16 — mixing pty_* with
    // is_* is one of the most natural calls there is:
    //   指标 pty_cn_name 不支持参数 tradeDate; 指标 is_op_rev 不支持参数 tradeDate;
    //   指标 is_op_rev 缺少必填参数 reportDate
    // "这个指标要的是 reportDate" is right about is_op_rev and WRONG about pty_cn_name
    // (which refuses reportDate too — the dead end this whole thread has been chasing).
    const hint = new ApiError("指标 pty_cn_name 不支持参数 tradeDate; 指标 is_op_rev 不支持参数 tradeDate; 指标 is_op_rev 缺少必填参数 reportDate", "100003").hint ?? ""
    expect(hint).not.toMatch(/这个指标要的是 reportDate/)
    expect(hint).toContain("涉及多个指标")
    // Must still be actionable: name all three shapes, not just "go read the docs".
    expect(hint).toContain('"<该指标code>:"')
  })

  it("does not carry the swap rule's anti-opt-out warning into a batch message", () => {
    // The sharper half of the same defect, introduced by the swap rule itself: its
    // "⚠️ 别在这一步用空冒号" is correct for qte_close and exactly BACKWARDS for
    // pty_cn_name in the same message, which needs precisely the opt-out.
    const hint = new ApiError("指标 qte_close 不支持参数 reportDate; 指标 qte_close 缺少必填参数 tradeDate; 指标 pty_cn_name 不支持参数 tradeDate", "100003").hint ?? ""
    expect(hint).not.toMatch(/别在这一步用/)
    expect(hint).toContain("涉及多个指标")
  })

  it("keeps the specific hint when several indicators failed the SAME way", () => {
    // Gating on distinct INDICATOR count over-corrected: a batch of report-period
    // indicators — the most common batch failure on cross-section — all say the same
    // thing, so one sentence covers them and generic triage is a downgrade. The gate
    // counts distinct FAILURE SHAPES instead. (Cross-session review R4-1, 2026-08-16.)
    const hint = new ApiError("指标 is_op_rev 不支持参数 tradeDate; 指标 is_op_rev 缺少必填参数 reportDate; 指标 is_dnrpnp 不支持参数 tradeDate; 指标 is_dnrpnp 缺少必填参数 reportDate", "100003").hint ?? ""
    expect(hint).toContain("reportDate")
    expect(hint).not.toContain("失败的方式不同")
  })

  it("keeps the opt-out hint when several parameterless indicators failed the same way", () => {
    // The half-sentence twin of the above. This shape is also what proved rule ④'s
    // routing was held by array order rather than a guard — no test covered it, so the
    // N2b mutation came back green and was misread as "the guards are load-bearing".
    const hint = new ApiError("指标 pty_cn_name 不支持参数 tradeDate; 指标 scr_code 不支持参数 tradeDate", "100003").hint ?? ""
    expect(hint).toContain('"<指标code>:"')
    expect(hint).not.toContain("失败的方式不同")
  })

  it("routes an all-half-clause batch with DIFFERENT refused keys to triage", () => {
    // The one shape that exercises rule ④'s own guard: several indicators, every clause
    // a lone 不支持参数 (so ④'s notMatch does not block it), but the refused keys differ.
    // Probed live: `--indicator pty_cn_name --indicator scr_code --indicator-param
    // "scr_code:reportDate=..."` → 指标 scr_code 不支持参数 reportDate; 指标
    // pty_cn_name 不支持参数 tradeDate.
    //
    // Without this test the P2 mutation (drop ④'s guard + move the batch rule last)
    // came back GREEN and was misread as "the guard is redundant" — the same
    // green-mutation-means-no-coverage trap recorded in bug/closed.md K1.
    const hint = new ApiError("指标 scr_code 不支持参数 reportDate; 指标 pty_cn_name 不支持参数 tradeDate", "100003").hint ?? ""
    expect(hint).toContain("失败的方式不同")
  })

  it("still gives the singular hint when the same indicator is named several times", () => {
    // The gate counts DISTINCT codes, not clauses — a two-clause message about one
    // indicator is still unambiguous and should keep the specific advice.
    const hint = new ApiError("指标 qte_close 不支持参数 reportDate; 指标 qte_close 缺少必填参数 tradeDate", "100003").hint ?? ""
    expect(hint).toContain("tradeDate=")
    expect(hint).not.toContain("涉及多个指标")
  })

  it("does not fire the reportDate hint on other 100003 causes", () => {
    // Guards the regex from widening into every EDE input error and burying the
    // generic advice under an irrelevant report-period lecture.
    const hint = new ApiError("指标 qte_close 不支持参数 bogusKey", "100003").hint
    expect(hint).not.toContain("--indicator-param")
    expect(hint).toContain("枚举")
  })

  it("provides hints for codes documented in the skill error table", () => {
    expect(new ApiError("quote range", "430007").hint).toContain("日期范围")
    expect(new ApiError("download", "430004").hint).toContain("file-type")
  })

  it("hints the 2026-07-17 codes that replaced legacy ones (probed live 2026-07-20)", () => {
    expect(new ApiError("开发账号凭证无效", "999011").hint).toContain("GANGTISE_ACCESS_KEY")
    expect(new ApiError("数据未找到", "130001").hint).toContain("未开通该指标")
    expect(new ApiError("资源不存在", "130002").hint).toContain("ID 有效")
    expect(new ApiError("接口地址不存在", "999010").hint).toContain("raw list")
    expect(new ApiError("积分不足", "999005").hint).toContain("客户经理")
  })

  it("hints carry the action, not a restatement of the server msg", () => {
    // The hint is printed right after the msg; repeating it produces
    // "资源不存在 资源不存在，确认 ID 有效" — noise where advice should be.
    const cases: [string, string][] = [
      ["资源不存在", "130002"],
      ["积分不足", "999005"],
      ["缺少必填参数", "100001"],
      ["系统内部错误", "999999"],
      ["开发账号凭证无效（ak/sk 匹配失败）", "999011"],
      // The legacy codes the rollout left live are printed after the same server
      // msg and were the ones actually stuttering: "今日调用次数已达上限 今日调用
      // 次数已达上限。" Probed msgs, not invented ones.
      ["指标无权限", "130001"],
      ["数据未找到", "410004"],
      ["今日调用次数已达上限", "903301"],
      ["积分不足", "999995"],
      ["未开通接口权限", "999997"],
      ["开发账号状态异常", "8000016"],
      ["开发账号已到期", "8000018"],
      ["请求参数为空", "900001"],
      ["正在生成中", "410110"],
      ["生成失败", "410111"],
    ]
    for (const [msg, code] of cases) {
      expect(new ApiError(msg, code).hint, `hint for ${code} restates its msg`).not.toContain(msg)
    }
  })

  it("hints the EDE-only legacy codes the 2026-07-17 renumbering never covered", () => {
    // indicator.md lists these as the primary EDE failures, but the code table was
    // reorganized around the 41 new codes and left both without guidance.
    expect(new ApiError("参数错误", "410001").hint).toContain("cross-section")
    expect(new ApiError("必填参数 periodNum 不能为空", "410106").hint).toContain("indicator-param")
  })

  it("keeps hints for legacy codes the gateway still emits", () => {
    expect(new ApiError("token", "0000001008").hint).toContain("Token 已失效")
    expect(new ApiError("no bearer", "0000001007").hint).toContain("token")
  })

  it("corrects 900002 — the server uses it for a wrong HTTP method, not a missing uid", () => {
    const hint = new ApiError("请求类型有误", "900002").hint
    expect(hint).toContain("请求方法")
    expect(hint).not.toContain("uid")
  })

  it("110002 hint names both the date and time range pairs", () => {
    // Insight list commands order by --start-time/--end-time; the old hint named
    // only --start-date/--end-date and so pointed at flags those commands lack.
    const hint = new ApiError("日期区间非法（起>止）", "110002").hint
    expect(hint).toContain("--start-date")
    expect(hint).toContain("--start-time")
  })

  it("999006 hint scopes retries correctly (429 all endpoints, 5xx default-policy only)", () => {
    // no-replay endpoints still retry 429 (transport.test locks it), so the hint must
    // not read as if no-replay opts out of everything — and must not claim 429-only.
    const hint = new ApiError("限流", "999006").hint
    expect(hint).toContain("429")
    expect(hint).toContain("所有端点")
    expect(hint).toContain("普通端点")
  })

  it("matches numeric codes once the envelope normalizes them to strings", () => {
    // The new codes arrive as JSON numbers; unwrapEnvelope runs them through String().
    expect(new ApiError("系统内部错误", String(999999)).hint).toContain("重试")
    expect(new ApiError("参数值非法", String(100003)).hint).toContain("枚举")
  })

  it("exposes traceId off the envelope details for support tickets", () => {
    const envelope = { code: 999999, errorType: "SYSTEM_ERROR", msg: "系统内部错误", traceId: "830970928370642944" }
    expect(new ApiError("系统内部错误", "999999", 500, envelope).traceId).toBe("830970928370642944")
  })

  it("stringifies a numeric traceId and stays undefined when absent or unusable", () => {
    expect(new ApiError("x", "999999", 500, { traceId: 12345 }).traceId).toBe("12345")
    expect(new ApiError("x", "999999", 500, { msg: "no trace here" }).traceId).toBeUndefined()
    expect(new ApiError("x", "999999", 500, "not an object").traceId).toBeUndefined()
    expect(new ApiError("x", "999999").traceId).toBeUndefined()
  })

  it("falls back to the traceId attached to a double-wrapped payload", () => {
    // Probed 2026-07-20: EDE puts traceId on the OUTER envelope only. The client
    // hands it over on the payload, since it discards the envelope before the inner
    // failure is raised.
    const inner = attachEnvelopeTraceId({ code: "130001", status: false, msg: "指标无权限" }, "830886132209999872")
    expect(new ApiError("指标无权限", "130001", undefined, inner).traceId).toBe("830886132209999872")
  })

  it("prefers an own traceId over the attached one", () => {
    const envelope = attachEnvelopeTraceId({ traceId: "own" }, "outer")
    expect(new ApiError("x", "999999", 500, envelope).traceId).toBe("own")
  })

  it("covers all 41 codes published 2026-07-17 (the count the changelog claims)", () => {
    const unified = ["999001", "999002", "999003", "999004", "999005", "999006", "999007", "999008",
      "999009", "999010", "999011", "999012", "999013", "999014", "999015", "999016", "999999"]
    const common = ["100001", "100002", "100003", "100004", "100005", "100006",
      "110001", "110002", "110003", "120001",
      "130001", "130002", "130003", "130004", "130005", "140001", "140002"]
    const specific = ["210001", "220001", "230001", "240001", "240002", "240003", "250001"]
    expect(unified).toHaveLength(17)
    expect(common).toHaveLength(17)
    expect(specific).toHaveLength(7)

    const missing = [...unified, ...common, ...specific].filter(code => new ApiError("x", code).hint === undefined)
    expect(missing, "codes the changelog claims coverage for but have no hint").toEqual([])
  })

  it("hints 230002 (wechat account not bound), which vault wechat-* can hit", () => {
    // Added by the 2026-08-07 server release. It sits in the 私域 module, and
    // `vault wechat-message-list` / `wechat-chatroom-list` are exactly that
    // module — they require the group-message assistant to be bound and active,
    // so the code is reachable from this CLI and must not be left hint-less.
    const hint = new ApiError("微信账号未绑定", "230002").hint ?? ""
    expect(hint).toContain("绑定")
  })

  it("does not tell a 110003 caller to shorten the window", () => {
    // 110003 is "outside the account's data-permission range", not "window too
    // wide" — probed 2026-08-08: `fundamental --fiscal-year 2015` returns it no
    // matter how narrow the range gets, because the whole span is below the
    // account's floor. The old hint said 缩短查询窗口后重试, which sends the caller
    // in a circle. The coverage test above only asserts a hint EXISTS, so pin the
    // substance here.
    const hint = new ApiError("超出时间范围限制", "110003").hint ?? ""
    expect(hint).not.toContain("缩短查询窗口")
    expect(hint).toContain("数据权限")
  })

  it("has no hint for unknown error codes", () => {
    const err = new ApiError("unknown", "999999999")
    expect(err.hint).toBeUndefined()
  })

  it("has no hint when code is omitted", () => {
    const err = new ApiError("generic")
    expect(err.hint).toBeUndefined()
  })
})

describe("attachEnvelopeTraceId", () => {
  it("stays out of serialized output so it cannot leak into json/csv rows", () => {
    const payload = attachEnvelopeTraceId({ a: 1 }, "830886132209999872")
    expect(JSON.stringify(payload)).toBe('{"a":1}')
    expect(Object.keys(payload)).toEqual(["a"])
  })

  it("is a no-op for non-object payloads and absent ids", () => {
    expect(attachEnvelopeTraceId(null, "830886132209999872")).toBeNull()
    expect(attachEnvelopeTraceId("plain", "830886132209999872")).toBe("plain")
    expect(new ApiError("m", "999999", 500, attachEnvelopeTraceId({ a: 1 }, undefined)).traceId).toBeUndefined()
  })
})

describe("ConfigError", () => {
  it("is instanceof CliError and Error", () => {
    const err = new ConfigError("bad config")
    expect(err).toBeInstanceOf(ConfigError)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe("bad config")
  })
})

describe("ValidationError", () => {
  it("is instanceof CliError", () => {
    const err = new ValidationError("invalid input")
    expect(err).toBeInstanceOf(ValidationError)
  })
})

describe("DownloadError", () => {
  it("is instanceof CliError", () => {
    const err = new DownloadError("download failed")
    expect(err).toBeInstanceOf(DownloadError)
  })
})

describe("error hierarchy", () => {
  it("all custom errors are distinct classes", () => {
    expect(ConfigError).not.toBe(ValidationError)
    expect(ValidationError).not.toBe(DownloadError)
    expect(DownloadError).not.toBe(ApiError)
  })
})