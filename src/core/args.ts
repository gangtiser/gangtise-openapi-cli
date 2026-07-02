import { ValidationError } from "./errors.js"

interface NumberOptionConfig {
  integer?: boolean
  min?: number
}

export function splitCsv(value: string): string[] {
  // Also split on full-width "，": voice-input IMEs produce it, and an unsplit
  // "600519，000858" goes to the API as one bogus code with no local hint.
  return value
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function collectList(value: string, previous: string[] = []): string[] {
  return [...previous, ...splitCsv(value)]
}

export function parseNumberOption(value: string | number | undefined, optionName: string, config: NumberOptionConfig = {}): number {
  if (value === undefined || String(value).trim() === "") {
    throw new ValidationError(`Invalid ${optionName}: expected a number`)
  }

  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    throw new ValidationError(`Invalid ${optionName}: expected a finite number`)
  }
  if (config.integer && !Number.isInteger(parsed)) {
    throw new ValidationError(`Invalid ${optionName}: expected an integer`)
  }
  if (config.min !== undefined && parsed < config.min) {
    throw new ValidationError(`Invalid ${optionName}: expected a number >= ${config.min}`)
  }

  return parsed
}

export function parseOptionalNumberOption(value: string | number | undefined, optionName: string, config: NumberOptionConfig = {}): number | undefined {
  return value === undefined ? undefined : parseNumberOption(value, optionName, config)
}

export function parseFrom(value: string | number | undefined): number {
  return parseNumberOption(value ?? "0", "--from", { integer: true, min: 0 })
}

export function parseSize(value: string | number | undefined): number | undefined {
  return parseOptionalNumberOption(value, "--size", { integer: true, min: 1 })
}

export function collectNumberList(value: string, previous: number[] = []): number[] {
  return [
    ...previous,
    ...splitCsv(value).map((item) => parseNumberOption(item, "number list item")),
  ]
}

export function collectKeyValue(value: string, previous: Record<string, string> = {}): Record<string, string> {
  const index = value.indexOf("=")
  if (index === -1) {
    throw new ValidationError(`Invalid key=value pair: ${value}`)
  }

  const key = value.slice(0, index).trim()
  const rawValue = value.slice(index + 1).trim()

  if (!key) {
    throw new ValidationError(`Invalid key=value pair: ${value}`)
  }

  return {
    ...previous,
    [key]: rawValue,
  }
}

export function maybeArray<T>(value: T[]): T[] | undefined {
  return value.length > 0 ? value : undefined
}

export function toTimestamp13(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const num = Number(value)
  if (!Number.isNaN(num) && num > 1e12) return num
  if (!Number.isNaN(num) && num > 1e9) return num * 1000
  // `new Date("yyyy-MM-dd")` parses as UTC midnight while `new Date("yyyy-MM-dd HH:mm:ss")`
  // parses as local time — for CST users the two forms would differ by 8 hours and
  // silently shift the query window. Anchor date-only input to local midnight so both
  // forms mean the same wall-clock day.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (dateOnly) {
    const d = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    const valid = d.getMonth() === Number(dateOnly[2]) - 1 && d.getDate() === Number(dateOnly[3])
    return valid ? d.getTime() : undefined
  }
  const ms = new Date(value).getTime()
  if (Number.isNaN(ms)) return undefined
  return ms
}

export function parseTimestamp13(value: string | undefined, optionName: string): number | undefined {
  if (value === undefined) return undefined
  const parsed = toTimestamp13(value)
  if (parsed === undefined) {
    throw new ValidationError(`Invalid ${optionName}: expected a Unix timestamp or date string`)
  }
  return parsed
}

export interface IndicatorParamGroup {
  indicatorCode: string
  parameters: { paramKey: string; paramValue: string }[]
}

// Parse repeatable `--indicator-param "code:key=value"` specs into the nested
// indicatorParamList the EDE cross-section / time-series endpoints expect.
// Multiple specs for the same code accumulate into one group, first-seen order.
export function parseIndicatorParams(specs: string[]): IndicatorParamGroup[] | undefined {
  if (specs.length === 0) return undefined
  const groups = new Map<string, IndicatorParamGroup>()
  for (const spec of specs) {
    const colon = spec.indexOf(":")
    const rest = colon === -1 ? "" : spec.slice(colon + 1)
    const eq = rest.indexOf("=")
    const code = colon === -1 ? "" : spec.slice(0, colon).trim()
    const paramKey = eq === -1 ? "" : rest.slice(0, eq).trim()
    const paramValue = eq === -1 ? "" : rest.slice(eq + 1).trim()
    if (!code || !paramKey) {
      throw new ValidationError(`Invalid --indicator-param: expected "code:key=value", got "${spec}"`)
    }
    let group = groups.get(code)
    if (!group) {
      group = { indicatorCode: code, parameters: [] }
      groups.set(code, group)
    }
    group.parameters.push({ paramKey, paramValue })
  }
  return [...groups.values()]
}
