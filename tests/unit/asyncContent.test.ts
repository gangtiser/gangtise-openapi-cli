import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"

import { checkAsyncContent, pollAsyncContent } from "../../src/core/asyncContent.js"
import { ApiError } from "../../src/core/errors.js"

describe("asyncContent", () => {
  let outSpy: MockInstance<typeof process.stdout.write>
  let errSpy: MockInstance<typeof process.stderr.write>
  let savedExitCode: typeof process.exitCode

  beforeEach(() => {
    outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    savedExitCode = process.exitCode
  })

  afterEach(() => {
    outSpy.mockRestore()
    errSpy.mockRestore()
    process.exitCode = savedExitCode
    vi.useRealTimers()
  })

  const stdout = () => outSpy.mock.calls.map((c) => String(c[0])).join("")
  const stderr = () => errSpy.mock.calls.map((c) => String(c[0])).join("")

  describe("pollAsyncContent", () => {
    it("prints content and returns true on the first successful attempt", async () => {
      const client = { call: vi.fn().mockResolvedValue({ content: "the report" }) }
      const outcome = await pollAsyncContent(client, "ep", "d1", "json")
      expect(outcome).toBe("ok")
      expect(client.call).toHaveBeenCalledTimes(1)
      expect(stdout()).toContain("the report")
    })

    it("returns \"failed\" immediately on a terminal 410111 failure", async () => {
      const client = { call: vi.fn().mockRejectedValue(new ApiError("failed", "410111")) }
      const outcome = await pollAsyncContent(client, "ep", "d1", "json")
      expect(outcome).toBe("failed")
      expect(client.call).toHaveBeenCalledTimes(1)
      expect(stderr()).toContain("terminal")
    })

    it("reports the terminal failure's code, msg and traceId — this line is their only record", async () => {
      // The error is swallowed here rather than rethrown, so cli.ts's global handler
      // never sees it. Losing the traceId makes the failure unreportable to support.
      const envelope = { code: "410111", msg: "生成失败", traceId: "830945265733750784" }
      const client = { call: vi.fn().mockRejectedValue(new ApiError("生成失败", "410111", 400, envelope)) }
      expect(await pollAsyncContent(client, "ep", "d1", "json")).toBe("failed")
      const out = stderr()
      expect(out).toContain("410111")
      expect(out).toContain("生成失败")
      expect(out).toContain("830945265733750784")
    })

    it("says resubmitting bills again, not that re-checking does", async () => {
      // *-check is a free lookup; only resubmitting the generation task re-bills.
      const client = { call: vi.fn().mockRejectedValue(new ApiError("生成失败", "410111", 400)) }
      await pollAsyncContent(client, "ep", "d1", "json")
      expect(stderr()).toMatch(/[Rr]esubmitting the generation task bills again/)
    })

    it("rethrows a non-transient error instead of polling", async () => {
      // 999995 积分不足 is terminal for this request — burning the remaining
      // 5-minute poll budget on it would be pointless.
      const client = { call: vi.fn().mockRejectedValue(new ApiError("no credits", "999995", 200)) }
      await expect(pollAsyncContent(client, "ep", "d1", "json")).rejects.toMatchObject({ code: "999995" })
      expect(client.call).toHaveBeenCalledTimes(1)
    })

    it("tolerates a transient 5xx blip mid-poll instead of abandoning the whole wait", async () => {
      // AI generation windows are exactly when the server is busiest: a single
      // 5xx (after the client's own retries) used to void minutes of waiting even
      // though the dataId was still valid. Transient errors consume an attempt
      // and polling continues.
      vi.useFakeTimers()
      const client = {
        call: vi.fn()
          .mockRejectedValueOnce(new ApiError("系统内部错误", "999999", 500))
          .mockResolvedValue({ content: "the report" }),
      }
      const p = pollAsyncContent(client, "ep", "d1", "json")
      await vi.runAllTimersAsync()
      expect(await p).toBe("ok")
      expect(client.call).toHaveBeenCalledTimes(2)
      expect(stderr()).toContain("transient")
    })

    it("retries on 410110 (generating) and succeeds on a later attempt", async () => {
      vi.useFakeTimers()
      const client = {
        call: vi.fn()
          .mockRejectedValueOnce(new ApiError("generating", "410110"))
          .mockResolvedValueOnce({ content: "ready now" }),
      }
      const p = pollAsyncContent(client, "ep", "d1", "json")
      await vi.runAllTimersAsync()
      expect(await p).toBe("ok")
      expect(client.call).toHaveBeenCalledTimes(2)
      expect(stdout()).toContain("ready now")
    })

    it("treats the renumbered 140001 (409) as generating, not as a hard error", async () => {
      // 2026-07-17 renumbering: 410110 → 140001 RESULT_GENERATING on HTTP 409.
      // 409 is not in the retryable-status set, so a miss here would rethrow and
      // abandon a wait the user already paid for.
      vi.useFakeTimers()
      const client = {
        call: vi.fn()
          .mockRejectedValueOnce(new ApiError("生成中", "140001", 409))
          .mockResolvedValueOnce({ content: "ready now" }),
      }
      const p = pollAsyncContent(client, "ep", "d1", "json")
      await vi.runAllTimersAsync()
      expect(await p).toBe("ok")
      expect(client.call).toHaveBeenCalledTimes(2)
    })

    it("returns \"failed\" on the renumbered 140002 instead of waiting out its HTTP 500", async () => {
      // 140002 PROCESSING_FAILED is terminal but ships on HTTP 500 — the transient
      // branch would otherwise burn all 14 attempts on a verdict already final.
      const client = { call: vi.fn().mockRejectedValue(new ApiError("处理失败", "140002", 500)) }
      const outcome = await pollAsyncContent(client, "ep", "d1", "json")
      expect(outcome).toBe("failed")
      expect(client.call).toHaveBeenCalledTimes(1)
      expect(stderr()).toContain("terminal")
    })

    it("stops after 14 attempts and returns \"timeout\" when content never becomes ready", async () => {
      // Regression guard for the poll budget: a loop-bound slip here turns --wait
      // into an indefinite hang instead of a ~316s give-up.
      vi.useFakeTimers()
      const client = { call: vi.fn().mockRejectedValue(new ApiError("generating", "410110")) }
      const p = pollAsyncContent(client, "ep", "d1", "json")
      await vi.runAllTimersAsync()
      expect(await p).toBe("timeout")
      expect(client.call).toHaveBeenCalledTimes(14)
    })
  })

  describe("checkAsyncContent", () => {
    it("prints content on success", async () => {
      const client = { call: vi.fn().mockResolvedValue({ content: "done" }) }
      await checkAsyncContent(client, "ep", "d1", "json")
      expect(stdout()).toContain("done")
    })

    it("reports a pending status when the content is still generating (410110)", async () => {
      const client = { call: vi.fn().mockRejectedValue(new ApiError("generating", "410110")) }
      await checkAsyncContent(client, "ep", "d1", "json")
      expect(stdout()).toContain("pending")
    })

    it("sets exit code 1 on a terminal 410111 failure", async () => {
      process.exitCode = 0
      const client = { call: vi.fn().mockRejectedValue(new ApiError("failed", "410111")) }
      await checkAsyncContent(client, "ep", "d1", "json")
      expect(process.exitCode).toBe(1)
      expect(stderr()).toContain("terminal")
    })

    it("reports pending on the renumbered 140001 and exits 1 on the renumbered 140002", async () => {
      const generating = { call: vi.fn().mockRejectedValue(new ApiError("生成中", "140001", 409)) }
      await checkAsyncContent(generating, "ep", "d1", "json")
      expect(stdout()).toContain("pending")

      process.exitCode = 0
      const failed = { call: vi.fn().mockRejectedValue(new ApiError("处理失败", "140002", 500)) }
      await checkAsyncContent(failed, "ep", "d1", "json")
      expect(process.exitCode).toBe(1)
      expect(stderr()).toContain("terminal")
    })

    it("rethrows a non-async error", async () => {
      const client = { call: vi.fn().mockRejectedValue(new ApiError("boom", "999999", 500)) }
      await expect(checkAsyncContent(client, "ep", "d1", "json")).rejects.toMatchObject({ code: "999999" })
    })
  })
})
