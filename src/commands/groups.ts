import { ai } from "./ai.js"
import { alternative } from "./alternative.js"
import { auth, lookup } from "./auth.js"
import { bond } from "./bond.js"
import { fund } from "./fund.js"
import { fundamental } from "./fundamental.js"
import { indicator } from "./indicator.js"
import { insight } from "./insight.js"
import { quote } from "./quote.js"
import { raw } from "./raw.js"
import { reference } from "./reference.js"
import { tool } from "./tool.js"
import { vault } from "./vault.js"

/** Every command group, in the order `gangtise --help` lists them. The one list: cli.ts
 * registers these and the docs guards walk them, so a new group cannot reach one and not
 * the other. */
export const COMMAND_GROUPS = [auth, lookup, insight, quote, fundamental, bond, fund, reference, vault, ai, alternative, indicator, tool, raw]
