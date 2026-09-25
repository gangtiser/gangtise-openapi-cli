// Loaded with `node --import`: reports on stderr whenever anything resolves `undici`, so a
// test can tell whether a command path loaded the HTTP stack at all.
import { registerHooks } from "node:module"

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "undici" || specifier.startsWith("undici/")) process.stderr.write("UNDICI_LOADED\n")
    return next(specifier, context)
  },
})
