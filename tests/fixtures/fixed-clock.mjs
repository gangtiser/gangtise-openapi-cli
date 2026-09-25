// Loaded with `node --import`: pins "now" to GANGTISE_TEST_NOW (an ISO instant), so a test can
// check a default date against a chosen clock — e.g. an instant where the UTC day and
// Beijing's differ.
const fixed = Date.parse(process.env.GANGTISE_TEST_NOW ?? "")
if (!Number.isNaN(fixed)) {
  const RealDate = Date
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length > 0 ? args : [fixed]))
    }

    static now() {
      return fixed
    }
  }
}
