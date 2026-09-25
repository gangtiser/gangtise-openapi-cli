import { afterEach, describe, expect, it } from "vitest"

import { decidedExitCode, EXIT_FAILED, EXIT_INCOMPLETE, EXIT_SUPERSEDED, markFailed, markIncomplete, markSuperseded } from "../../src/core/exitStatus.js"

afterEach(() => { process.exitCode = undefined })

describe("exit status precedence", () => {
  it("starts at 0 and records each signal on its own", () => {
    expect(decidedExitCode()).toBe(0)
    markSuperseded()
    expect(decidedExitCode()).toBe(EXIT_SUPERSEDED)
    process.exitCode = undefined
    markIncomplete()
    expect(decidedExitCode()).toBe(EXIT_INCOMPLETE)
  })

  it("never lets a lighter signal soften a heavier one: 1 over 3 over 4", () => {
    markIncomplete()
    markSuperseded()
    expect(decidedExitCode()).toBe(EXIT_INCOMPLETE)

    markFailed()
    markIncomplete()
    markSuperseded()
    expect(decidedExitCode()).toBe(EXIT_FAILED)
  })

  it("lets a heavier signal replace a lighter one", () => {
    markSuperseded()
    markIncomplete()
    expect(decidedExitCode()).toBe(EXIT_INCOMPLETE)
    markFailed()
    expect(decidedExitCode()).toBe(EXIT_FAILED)
  })
})
