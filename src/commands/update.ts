import os from "node:os"

import { Command } from "commander"

import { isVersionNewer } from "../core/args.js"
import { installVersion, refreshSkillCopies } from "../core/selfUpdate.js"
import { latestVersion, PACKAGE_NAME, REGISTRY } from "../core/updateCheck.js"
import { CLI_VERSION, PACKAGE_ROOT } from "../version.js"

export const update = new Command("update")
  .description("Update to the latest published version (npm install -g), then refresh older copies of the Agent Skill installed for Claude Code / Codex / OpenClaw / Hermes")
  .option("--check", "Only report whether a newer version is published; install nothing")
  .option("--no-skill", "Leave the Agent Skill copies as they are")
  .action(async (options: { check?: boolean; skill: boolean }) => {
    // Always the registry's current answer: the one kept for the daily notice can be a day old.
    const latest = await latestVersion(undefined, 15_000, Date.now(), true)
    if (!latest) throw new Error(`Could not reach ${REGISTRY} to look up the latest version. Check the network and retry, or install directly: npm install -g ${PACKAGE_NAME}@latest --registry=${REGISTRY}`)
    const outdated = isVersionNewer(latest, CLI_VERSION)
    if (options.check) {
      process.stdout.write(outdated ? `Update available: ${CLI_VERSION} → ${latest}. Run: gangtise update\n` : `gangtise ${CLI_VERSION} is the latest version.\n`)
      return
    }
    if (outdated) {
      installVersion(latest, PACKAGE_ROOT)
      process.stdout.write(`Updated gangtise ${CLI_VERSION} → ${latest}.\n`)
    } else {
      process.stdout.write(`gangtise ${CLI_VERSION} is the latest version.\n`)
    }
    if (options.skill) for (const line of refreshSkillCopies(PACKAGE_ROOT, os.homedir())) process.stdout.write(`${line}\n`)
  })
