import { ValidationError } from "./errors.js"

interface NumberOptionConfig {
  integer?: boolean
  min?: number
}

export function splitCsv(value: string): string[] {
  return value
    .split(",")
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
    throw new Error(`Invalid key=value pair: ${value}`)
  }

  const key = value.slice(0, index).trim()
  const rawValue = value.slice(index + 1).trim()

  if (!key) {
    throw new Error(`Invalid key=value pair: ${value}`)
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
