import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"

// The `update` command's wiring: which of its steps each option runs. The steps themselves
// are covered in selfUpdate.test.ts / updateCheck.test.ts; here they are stand-ins, so the
// test neither reaches the registry nor runs npm.
const steps = vi.hoisted(() => ({
  latestVersion: vi.fn(),
  installVersion: vi.fn(),
  refreshSkillCopies: vi.fn(() => ["Agent Skill updated: /h/.claude/skills/gangtise-openapi (0.1.0 → 9.9.9)"]),
}))
vi.mock("../../src/core/updateCheck.js", async (importOriginal) => ({ ...await importOriginal<object>(), latestVersion: steps.latestVersion }))
vi.mock("../../src/core/selfUpdate.js", async (importOriginal) => ({ ...await importOriginal<object>(), installVersion: steps.installVersion, refreshSkillCopies: steps.refreshSkillCopies }))

const { update } = await import("../../src/commands/update.js")
const { CLI_VERSION, PACKAGE_ROOT } = await import("../../src/version.js")

let out: MockInstance<typeof process.stdout.write>

beforeEach(() => {
  steps.latestVersion.mockReset()
  steps.installVersion.mockReset()
  steps.refreshSkillCopies.mockClear()
  out = vi.spyOn(process.stdout, "write").mockReturnValue(true)
})

afterEach(() => out.mockRestore())

const run = (...args: string[]) => update.parseAsync(args, { from: "user" })
const printed = () => out.mock.calls.map((call) => String(call[0])).join("")

describe("gangtise update", () => {
  it("asks the registry for a current answer, installs a newer version, then refreshes the skill copies", async () => {
    steps.latestVersion.mockResolvedValue("9.9.9")
    await run()
    expect(steps.latestVersion.mock.calls[0][3]).toBe(true)
    expect(steps.installVersion).toHaveBeenCalledWith("9.9.9", PACKAGE_ROOT)
    expect(steps.refreshSkillCopies).toHaveBeenCalledWith(PACKAGE_ROOT, expect.any(String))
    expect(printed()).toBe(`Updated gangtise ${CLI_VERSION} → 9.9.9.\nAgent Skill updated: /h/.claude/skills/gangtise-openapi (0.1.0 → 9.9.9)\n`)
  })

  it("installs nothing when already on the latest version, and still refreshes older skill copies", async () => {
    steps.latestVersion.mockResolvedValue(CLI_VERSION)
    await run()
    expect(steps.installVersion).not.toHaveBeenCalled()
    expect(steps.refreshSkillCopies).toHaveBeenCalled()
    expect(printed()).toContain(`gangtise ${CLI_VERSION} is the latest version.`)
  })

  it("--no-skill leaves the skill copies alone", async () => {
    steps.latestVersion.mockResolvedValue("9.9.9")
    await run("--no-skill")
    expect(steps.installVersion).toHaveBeenCalled()
    expect(steps.refreshSkillCopies).not.toHaveBeenCalled()
  })

  it("--check reports and changes nothing", async () => {
    steps.latestVersion.mockResolvedValue("9.9.9")
    await run("--check")
    expect(printed()).toBe(`Update available: ${CLI_VERSION} → 9.9.9. Run: gangtise update\n`)
    expect(steps.installVersion).not.toHaveBeenCalled()
    expect(steps.refreshSkillCopies).not.toHaveBeenCalled()
  })

  it("fails without installing when the registry does not answer", async () => {
    steps.latestVersion.mockResolvedValue(undefined)
    await expect(run()).rejects.toThrow(/Could not reach https:\/\/registry\.npmjs\.org/)
    expect(steps.installVersion).not.toHaveBeenCalled()
    expect(steps.refreshSkillCopies).not.toHaveBeenCalled()
  })
})
