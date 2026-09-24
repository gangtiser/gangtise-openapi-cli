import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"

import { DRIVE_NAME_MAX, uploadDriveFile } from "../../src/core/driveUpload.js"
import { ApiError, ValidationError } from "../../src/core/errors.js"

describe("uploadDriveFile", () => {
  let dir: string
  let filePath: string
  let errSpy: MockInstance<typeof process.stderr.write>

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "gangtise-drive-upload-"))
    filePath = path.join(dir, "纪要.docx")
    await fs.writeFile(filePath, "content")
  })

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  beforeEach(() => {
    errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
  })

  afterEach(() => {
    errSpy.mockRestore()
  })

  it("uploads under the local file name and passes the target as form fields", async () => {
    const client = { uploadFile: vi.fn().mockResolvedValue({ fileId: "50001" }) }
    expect(await uploadDriveFile(client, filePath, { spaceType: 2, folderId: "101", title: "新名字.docx" })).toEqual({ fileId: "50001" })
    expect(client.uploadFile).toHaveBeenCalledWith("vault.drive.upload", expect.objectContaining({ filename: "纪要.docx" }), { spaceType: 2, folderId: "101", title: "新名字.docx" })
  })

  it("rejects a missing, empty or directory path before any request", async () => {
    const client = { uploadFile: vi.fn() }
    const empty = path.join(dir, "empty.pdf")
    await fs.writeFile(empty, "")
    await expect(uploadDriveFile(client, path.join(dir, "nope.pdf"), { spaceType: 1 })).rejects.toBeInstanceOf(ValidationError)
    await expect(uploadDriveFile(client, empty, { spaceType: 1 })).rejects.toThrow(/empty/)
    await expect(uploadDriveFile(client, dir, { spaceType: 1 })).rejects.toThrow(/Not a file/)
    expect(client.uploadFile).not.toHaveBeenCalled()
  })

  it("counts the name cap in UTF-16 units, as the server does (an emoji is 2)", async () => {
    const client = { uploadFile: vi.fn().mockResolvedValue({}) }
    // 199 CJK characters + one emoji = 201 units: over the cap though it is 200 characters.
    await expect(uploadDriveFile(client, filePath, { spaceType: 1, title: `${"字".repeat(DRIVE_NAME_MAX - 1)}😀` })).rejects.toThrow(/at most 200/)
    await uploadDriveFile(client, filePath, { spaceType: 1, title: "字".repeat(DRIVE_NAME_MAX) })
    expect(client.uploadFile).toHaveBeenCalledTimes(1)
  })

  it("passes a failed request through unchanged", async () => {
    const failure = new ApiError("业务处理失败", "140002", 500)
    const client = { uploadFile: vi.fn().mockRejectedValue(failure) }
    await expect(uploadDriveFile(client, filePath, { spaceType: 1, folderId: "101" })).rejects.toBe(failure)
    expect(errSpy).not.toHaveBeenCalled()
  })
})
