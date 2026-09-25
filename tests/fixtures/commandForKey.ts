/** The CLI command that calls a paginated endpoint. Keys map to command strings; the few
 * commands whose name doesn't follow the `group.name.list` → "group name list" rule are
 * special-cased. Shared by the README and option consistency tests. */
export const SPECIAL_COMMANDS: Record<string, string> = {
  "ai.security-clue.list": "ai security-clue",
  "ai.hot-topic": "ai hot-topic",
  // The v1 lists back `--with-content` on the same command as the v2 ones.
  "insight.opinion.list-with-content": "insight opinion list",
  "insight.foreign-opinion.list-with-content": "insight foreign-opinion list",
}

export function commandForKey(key: string): string {
  if (SPECIAL_COMMANDS[key]) return SPECIAL_COMMANDS[key]
  const parts = key.split(".")
  // vault list commands are single hyphenated names ("vault drive-list"),
  // insight ones are `<name> list` subcommands ("insight qa list").
  if (parts.length === 3 && parts[2] === "list" && parts[0] === "vault") return `vault ${parts[1]}-list`
  if (parts.length === 3 && parts[2] === "list") return `${parts[0]} ${parts[1]} list`
  throw new Error(`No README command mapping for paginated endpoint "${key}" — add it to SPECIAL_COMMANDS`)
}

