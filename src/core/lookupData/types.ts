export interface LookupItem {
  id: string
  name: string
}

export interface IndustryLookupItem extends LookupItem {
  taxonomy: "sw"
}

export interface AnnouncementCategoryItem {
  id: string
  name: string
  level: number
  parentId: string
}

export interface IndustryCodeItem {
  name: string
  code: string
}
