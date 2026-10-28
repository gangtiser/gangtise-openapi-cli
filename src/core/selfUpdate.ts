/**
 * `gangtise update`: install the latest version over the global npm install this process
 * runs from, then bring the copies of the Agent Skill that the README has users make up to
 * the skill shipped in the package.
 */
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { isVersionNewer } from "./args.js"
import { PACKAGE_NAME, REGISTRY } from "./updateCheck.js"

/** The directories the README copies the skill into, one per agent (relative to home). */
export const SKILL_HOMES = [[".claude", "skills"], [".codex", "skills"], [".openclaw", "workspace", "skills"], [".hermes", "skills"]] as const
const SKILL_DIR = "gangtise-openapi"

type Npm = (args: string[], inherit: boolean) => { status: number | null; stdout: string }

const runNpm: Npm = (args, inherit) => {
  const options = { encoding: "utf8", stdio: inherit ? "inherit" : "pipe" } as const
  // npm is npm.cmd on Windows, which only a shell runs; the arguments go into its command line
  // (passed apart to a shell they are deprecated, DEP0190). None of them needs quoting.
  const result = process.platform === "win32" ? spawnSync(["npm", ...args].join(" "), { ...options, shell: true }) : spawnSync("npm", args, options)
  return { status: result.status, stdout: result.stdout ?? "" }
}

function isSymlink(file: string): boolean {
  try {
    return fs.lstatSync(file).isSymbolicLink()
  } catch {
    return false
  }
}

function samePath(a: string, b: string): boolean {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b)
  } catch {
    return false
  }
}

/** `npm install -g` `version` over `packageRoot`, then confirm it landed there. Refused unless
 * `packageRoot` is npm's own global install: from a clone, npx or a project dependency, npm
 * would put the new version somewhere this `gangtise` never reads. */
export function installVersion(version: string, packageRoot: string, npm: Npm = runNpm): void {
  // It goes into npm's command line, through a shell on Windows: a version and nothing else.
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`The registry answered an unexpected version (${JSON.stringify(version)}); nothing was installed.`)
  const root = npm(["root", "-g"], false)
  const globalRoot = root.status === 0 ? root.stdout.trim() : ""
  if (!globalRoot) throw new Error("Could not run npm, which gangtise update uses to install. Install Node.js with npm, or update gangtise the way it was installed.")
  const installed = path.join(globalRoot, PACKAGE_NAME)
  if (!samePath(installed, packageRoot)) {
    throw new Error(`This gangtise runs from ${packageRoot}, which is not npm's global install (${globalRoot}). Update it the way it was installed — in a clone: git pull && npm install && npm run build.`)
  }
  // `npm link` puts a symlink to a checkout there: npm would replace the link with a published
  // copy, and the checkout this process runs from would stay as it is.
  if (isSymlink(installed)) {
    throw new Error(`This gangtise is a checkout linked into npm's global install (${installed} → ${packageRoot}, npm link). Update the checkout instead: git pull && npm install && npm run build.`)
  }
  const spec = `${PACKAGE_NAME}@${version}`
  const install = npm(["install", "-g", spec, `--registry=${REGISTRY}`], true)
  if (install.status !== 0) {
    throw new Error(`npm install exited with ${install.status ?? "a signal"}. On a permission error (EACCES), run: sudo npm install -g ${spec} --registry=${REGISTRY} — then gangtise update again to refresh the Agent Skill copies.`)
  }
  const landed = (JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")) as { version?: string }).version
  if (landed !== version) throw new Error(`npm reported success, but ${packageRoot} still holds ${landed}.`)
}

function skillVersion(dir: string): string | undefined {
  try {
    return /^version:\s*["']?([^"'\n]+)/m.exec(fs.readFileSync(path.join(dir, "SKILL.md"), "utf8"))?.[1]
  } catch {
    return undefined
  }
}

/** Replace each copy of the skill under `home` (SKILL_HOMES) that is older than the one in
 * `packageRoot`; one line per copy replaced. A copy at the same or a newer version is left as
 * it is, local edits included, and so is a symlink — it is not a copy. The new copy is staged
 * beside the old one, so a failed copy leaves the old one in place; the staged copy does not
 * outlive a failure — it carries a SKILL.md of its own, which an agent would load as a second
 * skill. */
export function refreshSkillCopies(packageRoot: string, home: string): string[] {
  const source = path.join(packageRoot, SKILL_DIR)
  const version = skillVersion(source)
  if (!version) return []
  const replaced: string[] = []
  for (const parts of SKILL_HOMES) {
    const target = path.join(home, ...parts, SKILL_DIR)
    let stat: fs.Stats
    try {
      stat = fs.lstatSync(target)
    } catch {
      continue
    }
    if (!stat.isDirectory()) continue
    const current = skillVersion(target)
    if (current !== undefined && !isVersionNewer(version, current)) continue
    const staging = `${target}.update-${process.pid}`
    fs.rmSync(staging, { recursive: true, force: true })
    try {
      fs.cpSync(source, staging, { recursive: true })
      fs.rmSync(target, { recursive: true, force: true })
      fs.renameSync(staging, target)
    } catch (error) {
      fs.rmSync(staging, { recursive: true, force: true })
      throw new Error(`Could not replace the Agent Skill copy at ${target} (${(error as Error).message}). Copy ${source} there again.`)
    }
    replaced.push(`Agent Skill updated: ${target} (${current ?? "no version"} → ${version})`)
  }
  return replaced
}
