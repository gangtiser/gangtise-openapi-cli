import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { checkAsyncContent, pollAsyncContent } from "../../src/core/asyncContent.js"
import { ApiError } from "../../src/core/errors.js"

describe("asyncContent", () => {
  let outSpy: ReturnType<typeof vi.spyOn>
  let errSpy: ReturnType<typeof vi.spyOn>
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

    it("rethrows a non-async error instead of polling", async () => {
      const client = { call: vi.fn().mockRejectedValue(new ApiError("boom", "999999", 500)) }
      await expect(pollAsyncContent(client, "ep", "d1", "json")).rejects.toMatchObject({ code: "999999" })
      expect(client.call).toHaveBeenCalledTimes(1)
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

    it("rethrows a non-async error", async () => {
      const client = { call: vi.fn().mockRejectedValue(new ApiError("boom", "999999", 500)) }
      await expect(checkAsyncContent(client, "ep", "d1", "json")).rejects.toMatchObject({ code: "999999" })
    })
  })
})
