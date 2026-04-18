const f = require("fs")
const p = JSON.parse(f.readFileSync("package.json", "utf8"))

// 1. Generate src/version.ts
f.writeFileSync("src/version.ts", `// Auto-generated — DO NOT EDIT\nexport const CLI_VERSION = "${p.version}"\n`)

// 2. Update version in gangtise-openapi/SKILL.md frontmatter
const skillPath = "gangtise-openapi/SKILL.md"
const content = f.readFileSync(skillPath, "utf8")
f.writeFileSync(skillPath, content.replace(/^(version:\s*["']?)[^"'\n]+/m, `$1${p.version}`))