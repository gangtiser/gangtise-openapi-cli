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