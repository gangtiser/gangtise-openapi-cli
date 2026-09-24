import fs from "node:fs/promises"
import path from "node:path"

import { ValidationError } from "./errors.js"

/** Server-side cap per file (spec: ≤100MB). Checked locally so a doomed upload fails
 * instantly instead of after a long transfer. */
export const DRIVE_UPLOAD_MAX_BYTES = 100 * 1024 * 1024

/** Name cap (spec: 200), counted in UTF-16 code units — what the server counts (Java
 * `String.length()`) and exactly what JS `.length` counts, so an emoji is 2. */
export const DRIVE_NAME_MAX = 200

interface DriveUploadClient {
  uploadFile<T>(endpointKey: string, file: { filename: string; data: Uint8Array; contentType?: string }, fields?: Record<string, string | number | undefined>): Promise<T>
}

/** Upload one file to the AI drive. Every reason to reject the file is checked before
 * the request goes out. */
export async function uploadDriveFile(client: DriveUploadClient, filePath: string, options: { spaceType: number; folderId?: string; title?: string }): Promise<unknown> {
  const resolved = path.resolve(filePath)
  let stat
  try {
    stat = await fs.stat(resolved)
  } catch {
    throw new ValidationError(`File not found: ${filePath}`)
  }
  if (!stat.isFile()) throw new ValidationError(`Not a file: ${filePath}`)
  if (stat.size === 0) throw new ValidationError(`File is empty: ${filePath}`)
  if (stat.size > DRIVE_UPLOAD_MAX_BYTES) {
    throw new ValidationError(`File is ${(stat.size / 1024 / 1024).toFixed(1)}MB — the drive accepts at most 100MB per file`)
  }
  const filename = path.basename(resolved)
  const name = options.title ?? filename
  if (name.length > DRIVE_NAME_MAX) {
    throw new ValidationError(`File name is ${name.length} characters — the drive accepts at most ${DRIVE_NAME_MAX} (an emoji counts as 2); pass a shorter --title`)
  }

  // Buffered like the file-parse upload: undici's FormData needs a Blob.
  const data = await fs.readFile(resolved)
  return client.uploadFile("vault.drive.upload", { filename, data }, { spaceType: options.spaceType, folderId: options.folderId, title: options.title })
}
