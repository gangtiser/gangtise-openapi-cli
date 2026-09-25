import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"

import { ApiError, ValidationError } from "../../src/core/errors.js"
import { nextPollDelayMs, POLL_MAX_ATTEMPTS } from "../../src/core/asyncContent.js"
import { fetchFileParseResult, pollFileParseResult, submitFileParse } from "../../src/core/fileParse.js"

describe("fileParse", () => {
  let dir: string
  let pdfPath: string
  let outSpy: MockInstance<typeof process.stdout.write>

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "gangtise-file-parse-"))
    pdfPath = path.join(dir, "sample.pdf")
    await fs.writeFile(pdfPath, "%PDF-1.4 test\n")
  })

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  beforeEach(() => {
    outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
  })

  afterEach(() => {
    outSpy.mockRestore()
  })

  describe("submitFileParse", () => {
    it("uploads the file and returns its taskId", async () => {
      const client = { uploadFile: vi.fn().mockResolvedValue({ taskId: "123" }), call: vi.fn() }
      expect(await submitFileParse(client, pdfPath)).toBe("123")
      expect(client.uploadFile).toHaveBeenCalledWith("tool.file-parse.submit", expect.objectContaining({
        filename: "sample.pdf",
        contentType: "application/pdf",
      }))
    })

    it("stringifies a numeric taskId (JSON numbers lose precision as ids)", async () => {
      const client = { uploadFile: vi.fn().mockResolvedValue({ taskId: 829081108954501120 }), call: vi.fn() }
      expect(typeof await submitFileParse(client, pdfPath)).toBe("string")
    })

    // Submitting is billed per page, so every rejection has to happen before the upload.
    it.each([
      ["a missing file", () => path.join(dir, "nope.pdf")],
      ["a non-PDF file", () => path.join(dir, "notes.txt")],
      ["an empty file", () => path.join(dir, "empty.pdf")],
    ])("rejects %s without calling the API", async (_label, resolvePath) => {
      await fs.writeFile(path.join(dir, "notes.txt"), "plain text")
      await fs.writeFile(path.join(dir, "empty.pdf"), "")
      const client = { uploadFile: vi.fn(), call: vi.fn() }
      await expect(submitFileParse(client, resolvePath())).rejects.toBeInstanceOf(ValidationError)
      expect(client.uploadFile).not.toHaveBeenCalled()
    })

    it("fails loudly when the response carries no taskId", async () => {
      const client = { uploadFile: vi.fn().mockResolvedValue({}), call: vi.fn() }
      await expect(submitFileParse(client, pdfPath)).rejects.toBeInstanceOf(ApiError)
    })
  })

  describe("fetchFileParseResult", () => {
    it("returns \"pending\" on the generating code instead of throwing", async () => {
      for (const code of ["140001", "410110"]) {
        const client = { uploadFile: vi.fn(), call: vi.fn().mockRejectedValue(new ApiError("结果生成中", code, 409)) }
        expect(await fetchFileParseResult(client, "t1")).toBe("pending")
      }
    })

    it("rethrows any other error (a bad taskId must not look like 'still waiting')", async () => {
      const client = { uploadFile: vi.fn(), call: vi.fn().mockRejectedValue(new ApiError("资源不存在", "130002", 400)) }
      await expect(fetchFileParseResult(client, "t1")).rejects.toBeInstanceOf(ApiError)
    })

    it("saves the ZIP and prints its path when the result is ready", async () => {
      const output = path.join(dir, "result.zip")
      const client = { uploadFile: vi.fn(), call: vi.fn().mockResolvedValue({ savedPath: output }) }
      expect(await fetchFileParseResult(client, "t1", output)).toBe("ok")
      expect(client.call).toHaveBeenCalledWith("tool.file-parse.result", { taskId: "t1" }, undefined, { streamTo: output })
      expect(outSpy.mock.calls.map((c) => String(c[0])).join("")).toContain(output)
    })
  })

  describe("pollFileParseResult", () => {
    // The parse is billed at submit, so the wait must survive a pending answer and a
    // transient fault alike, and give up only on an error that will not change.
    let errSpy: MockInstance<typeof process.stderr.write>
    beforeEach(() => { errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true) })
    afterEach(() => {
      errSpy.mockRestore()
      vi.useRealTimers()
    })
    const pending = () => new ApiError("结果生成中", "140001", 409)
    const ready = (output: string) => ({ savedPath: output })

    it("waits through pending answers and a transient fault, then saves the ZIP", async () => {
      vi.useFakeTimers()
      const output = path.join(dir, "polled.zip")
      const client = {
        uploadFile: vi.fn(),
        call: vi.fn()
          .mockRejectedValueOnce(pending())
          .mockRejectedValueOnce(new ApiError("系统内部错误", "999999", 500))
          .mockResolvedValueOnce(ready(output)),
      }
      const outcome = pollFileParseResult(client, "t1", output)
      await vi.runAllTimersAsync()
      expect(await outcome).toBe("ok")
      expect(client.call).toHaveBeenCalledTimes(3)
      const stderr = errSpy.mock.calls.map((c) => String(c[0])).join("")
      expect(stderr).toContain("parse result not ready")
      expect(stderr).toContain("transient")
    })

    it("aborts on an error that will not change, without waiting", async () => {
      const client = { uploadFile: vi.fn(), call: vi.fn().mockRejectedValue(new ApiError("资源不存在", "130002", 400)) }
      await expect(pollFileParseResult(client, "t1")).rejects.toBeInstanceOf(ApiError)
      expect(client.call).toHaveBeenCalledTimes(1)
    })

    it("gives up with \"timeout\" after the attempt budget, the task still pending", async () => {
      vi.useFakeTimers()
      const t0 = Date.now()
      const client = { uploadFile: vi.fn(), call: vi.fn().mockRejectedValue(pending()) }
      const outcome = pollFileParseResult(client, "t1")
      await vi.runAllTimersAsync()
      expect(await outcome).toBe("timeout")
      expect(client.call).toHaveBeenCalledTimes(POLL_MAX_ATTEMPTS)
      const waits = Array.from({ length: POLL_MAX_ATTEMPTS - 1 }, (_, i) => nextPollDelayMs(i + 1))
      expect(Date.now() - t0).toBe(waits.reduce((a, b) => a + b, 0))
    })
  })
})
