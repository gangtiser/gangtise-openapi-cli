import fsSync, { writeFileSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { installVersion, refreshSkillCopies, SKILL_HOMES } from "../../src/core/selfUpdate.js"

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "gangtise-self-update-"))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

async function writeSkill(skillDir: string, version: string | undefined, extra = "body"): Promise<void> {
  await fs.mkdir(path.join(skillDir, "references"), { recursive: true })
  const frontmatter = version === undefined ? "---\nname: gangtise-openapi\n---\n" : `---\nname: gangtise-openapi\nversion: "${version}"\n---\n`
  await fs.writeFile(path.join(skillDir, "SKILL.md"), `${frontmatter}${extra}\n`)
  await fs.writeFile(path.join(skillDir, "references", "a.md"), extra)
}

describe("installVersion", () => {
  /** A global npm root holding the package, and an npm that "installs" by rewriting its version. */
  async function globalInstall(version: string) {
    const globalRoot = path.join(dir, "lib", "node_modules")
    const packageRoot = path.join(globalRoot, "gangtise-openapi-cli")
    await fs.mkdir(packageRoot, { recursive: true })
    await fs.writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name: "gangtise-openapi-cli", version }))
    return { globalRoot, packageRoot }
  }

  it("installs the version from the registry into npm's global root and confirms it landed", async () => {
    const { globalRoot, packageRoot } = await globalInstall("0.48.0")
    const npm = vi.fn((args: string[]) => {
      if (args[0] === "root") return { status: 0, stdout: `${globalRoot}\n` }
      writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ name: "gangtise-openapi-cli", version: "0.49.0" }))
      return { status: 0, stdout: "" }
    })
    installVersion("0.49.0", packageRoot, npm)
    expect(npm).toHaveBeenCalledWith(["install", "-g", "gangtise-openapi-cli@0.49.0", "--registry=https://registry.npmjs.org"], true)
  })

  it("refuses to install for a gangtise that is not npm's global install", async () => {
    const { globalRoot } = await globalInstall("0.48.0")
    const clone = path.join(dir, "clone")
    await fs.mkdir(clone)
    const npm = vi.fn(() => ({ status: 0, stdout: globalRoot }))
    expect(() => installVersion("0.49.0", clone, npm)).toThrow(/not npm's global install/)
    expect(npm).toHaveBeenCalledTimes(1)
  })

  it("refuses before installing when npm's global entry is a link to a checkout (npm link)", async () => {
    const globalRoot = path.join(dir, "lib", "node_modules")
    const checkout = path.join(dir, "checkout")
    await fs.mkdir(globalRoot, { recursive: true })
    await fs.mkdir(checkout)
    await fs.writeFile(path.join(checkout, "package.json"), JSON.stringify({ name: "gangtise-openapi-cli", version: "0.48.0" }))
    await fs.symlink(checkout, path.join(globalRoot, "gangtise-openapi-cli"))
    const npm = vi.fn((args: string[]) => args[0] === "root" ? { status: 0, stdout: globalRoot } : { status: 0, stdout: "" })
    expect(() => installVersion("0.49.0", checkout, npm)).toThrow(/linked into npm's global install.*npm link/)
    expect(npm.mock.calls.map((c) => c[0][0])).toEqual(["root"])
  })

  it("reports an npm that cannot run, a failed install, and an install that did not land", async () => {
    const { globalRoot, packageRoot } = await globalInstall("0.48.0")
    expect(() => installVersion("0.49.0", packageRoot, () => ({ status: null, stdout: "" }))).toThrow(/Could not run npm/)
    const failing = (args: string[]) => args[0] === "root" ? { status: 0, stdout: globalRoot } : { status: 243, stdout: "" }
    expect(() => installVersion("0.49.0", packageRoot, failing)).toThrow(/npm install exited with 243.*sudo npm install -g gangtise-openapi-cli@0\.49\.0/)
    const noop = (args: string[]) => args[0] === "root" ? { status: 0, stdout: globalRoot } : { status: 0, stdout: "" }
    expect(() => installVersion("0.49.0", packageRoot, noop)).toThrow(/still holds 0\.48\.0/)
  })

  it("installs nothing for a version that is not one", async () => {
    const { packageRoot } = await globalInstall("0.48.0")
    const npm = vi.fn(() => ({ status: 0, stdout: "" }))
    for (const version of ["1.0. 99", "1.0.0 && calc", "1.0.0\n"]) {
      expect(() => installVersion(version, packageRoot, npm)).toThrow(/unexpected version/)
    }
    expect(npm).not.toHaveBeenCalled()
  })
})

describe("refreshSkillCopies", () => {
  const packageRoot = () => path.join(dir, "pkg")
  const home = () => path.join(dir, "home")
  const copyAt = (index: number) => path.join(home(), ...SKILL_HOMES[index], "gangtise-openapi")

  beforeEach(async () => {
    await writeSkill(path.join(packageRoot(), "gangtise-openapi"), "0.49.0", "new")
  })

  it("replaces older copies and copies without a version, and reports each", async () => {
    await writeSkill(copyAt(0), "0.48.0", "old")
    await writeSkill(copyAt(2), undefined, "old")
    await fs.writeFile(path.join(copyAt(0), "stale.md"), "gone after the update")
    const lines = refreshSkillCopies(packageRoot(), home())
    expect(lines).toEqual([
      `Agent Skill updated: ${copyAt(0)} (0.48.0 → 0.49.0)`,
      `Agent Skill updated: ${copyAt(2)} (no version → 0.49.0)`,
    ])
    for (const index of [0, 2]) {
      expect(await fs.readFile(path.join(copyAt(index), "references", "a.md"), "utf8")).toBe("new")
    }
    await expect(fs.access(path.join(copyAt(0), "stale.md"))).rejects.toThrow()
    expect((await fs.readdir(path.dirname(copyAt(0)))).sort()).toEqual(["gangtise-openapi"])
  })

  it("leaves a copy at the same or a newer version as it is, local edits included", async () => {
    await writeSkill(copyAt(1), "0.49.0", "edited locally")
    await writeSkill(copyAt(3), "0.50.0", "ahead")
    expect(refreshSkillCopies(packageRoot(), home())).toEqual([])
    expect(await fs.readFile(path.join(copyAt(1), "references", "a.md"), "utf8")).toBe("edited locally")
    expect(await fs.readFile(path.join(copyAt(3), "references", "a.md"), "utf8")).toBe("ahead")
  })

  it("leaves a symlinked skill alone and creates no copy where there was none", async () => {
    const elsewhere = path.join(dir, "elsewhere")
    await writeSkill(elsewhere, "0.48.0", "linked")
    await fs.mkdir(path.dirname(copyAt(0)), { recursive: true })
    await fs.symlink(elsewhere, copyAt(0))
    expect(refreshSkillCopies(packageRoot(), home())).toEqual([])
    expect(await fs.readFile(path.join(elsewhere, "references", "a.md"), "utf8")).toBe("linked")
    for (const index of [1, 2, 3]) await expect(fs.access(copyAt(index))).rejects.toThrow()
  })

  it("leaves no staged copy in the skills directory when the old copy cannot be replaced", async () => {
    await writeSkill(copyAt(0), "0.48.0", "old")
    const rename = vi.spyOn(fsSync, "renameSync").mockImplementationOnce(() => { throw new Error("EBUSY: resource busy or locked") })
    try {
      expect(() => refreshSkillCopies(packageRoot(), home())).toThrow(/Could not replace the Agent Skill copy at .*gangtise-openapi \(EBUSY.*\)\. Copy .* there again/)
    } finally {
      rename.mockRestore()
    }
    expect(await fs.readdir(path.dirname(copyAt(0)))).toEqual([])
  })
})
