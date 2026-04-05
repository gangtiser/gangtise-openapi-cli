export function normalizeRows(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value
  }

  if (Array.isArray(value)) {
    return value
  }

  const record = value as Record<string, unknown>

  if (Array.isArray(record.fieldList) && Array.isArray(record.list)) {
    return record.list.map((row) => {
      if (!Array.isArray(row)) return row
      return (record.fieldList as unknown[]).reduce<Record<string, unknown>>((acc, field, index) => {
        acc[String(field)] = row[index]
        return acc
      }, {})
    })
  }

  if (Array.isArray(record.list)) {
    return record.list
  }

  return value
}
