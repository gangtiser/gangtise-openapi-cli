import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"

import { ApiError, ValidationError } from "../../src/core/errors.js"
import { fetchFileParseResult, submitFileParse } from "../../src/core/fileParse.js"

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
})
