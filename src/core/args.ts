export function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

export function collectList(value: string, previous: string[] = []): string[] {
  return [...previous, ...splitCsv(value)]
}

export function collectNumberList(value: string, previous: number[] = []): number[] {
  return [
    ...previous,
    ...splitCsv(value).map((item) => Number(item)).filter((item) => !Number.isNaN(item)),
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
