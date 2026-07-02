const f = require("fs")
const p = JSON.parse(f.readFileSync("package.json", "utf8"))

// 1. Generate src/version.ts
f.writeFileSync("src/version.ts", `// Auto-generated — DO NOT EDIT\nexport const CLI_VERSION = "${p.version}"\n`)

// 2. Update version in gangtise-openapi/SKILL.md frontmatter. Fail loudly if the
// frontmatter line is missing: a silent no-op here would publish a release whose
// skill still carries the previous version number.
const skillPath = "gangtise-openapi/SKILL.md"
const content = f.readFileSync(skillPath, "utf8")
const versionLine = /^(version:\s*["']?)[^"'\n]+/m
if (!versionLine.test(content)) {
  throw new Error(`${skillPath}: no "version:" line found in frontmatter — cannot sync version ${p.version}`)
}
f.writeFileSync(skillPath, content.replace(versionLine, `$1${p.version}`))