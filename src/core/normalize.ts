export function normalizeRows(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value
  }

  if (Array.isArray(value)) {
    return value
  }

  const record = value as Record<string, unknown>

  if (Array.isArray(record.fieldList) && Array.isArray(record.list)) {
    const normalizedList = record.list.map((row) => {
      if (!Array.isArray(row)) return row
      return (record.fieldList as unknown[]).reduce<Record<string, unknown>>((acc, field, index) => {
        acc[String(field)] = row[index]
        return acc
      }, {})
    })
    const { fieldList, list, ...meta } = record
    const hasMeta = Object.keys(meta).length > 0
    return hasMeta ? { ...meta, list: normalizedList } : normalizedList
  }

  if (Array.isArray(record.list)) {
    const { list, ...meta } = record
    const hasMeta = Object.keys(meta).length > 0
    return hasMeta ? { ...meta, list } : list
  }

  if (Array.isArray(record.chatRoomList)) {
    const { chatRoomList, ...meta } = record
    const hasMeta = Object.keys(meta).length > 0
    return hasMeta ? { ...meta, list: chatRoomList } : chatRoomList
  }

  return value
}
