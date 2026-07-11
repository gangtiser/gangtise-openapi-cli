const f = require("fs")
const p = JSON.parse(f.readFileSync("package.json", "utf8"))

// 1. Release-notes guard — BEFORE any writes, so a failed check leaves nothing
// half-synced. Shipping with a stale README/CHANGELOG has happened twice
// (v0.18.0 missed README, v0.25.0 nearly shipped a wrong pagination list);
// README is the npmjs.org landing page — fail the build instead.
for (const doc of ["README.md", "CHANGELOG.md"]) {
  if (!f.readFileSync(doc, "utf8").includes(`### v${p.version} `)) {
    throw new Error(`${doc}: no "### v${p.version}" changelog entry — add it before building this version`)
  }
}

// 2. Generate src/version.ts
f.writeFileSync("src/version.ts", `// Auto-generated — DO NOT EDIT\nexport const CLI_VERSION = "${p.version}"\n`)

// 3. Update version in gangtise-openapi/SKILL.md frontmatter. Fail loudly if the
// frontmatter line is missing: a silent no-op here would publish a release whose
// skill still carries the previous version number.
const skillPath = "gangtise-openapi/SKILL.md"
const content = f.readFileSync(skillPath, "utf8")
const versionLine = /^(version:\s*["']?)[^"'\n]+/m
if (!versionLine.test(content)) {
  throw new Error(`${skillPath}: no "version:" line found in frontmatter — cannot sync version ${p.version}`)
}
f.writeFileSync(skillPath, content.replace(versionLine, `$1${p.version}`))
