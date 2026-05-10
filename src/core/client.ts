import { createWriteStream } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { pipeline } from "node:stream/promises"

import { request } from "undici"

import type { CliConfig } from "./config.js"
import { isTokenCacheValid, normalizeToken, readTokenCache, requireAccessCredentials, writeTokenCache, type TokenCache } from "./auth.js"
import { ApiError, ValidationError } from "./errors.js"
import { ENDPOINTS, type EndpointDefinition } from "./endpoints.js"
import { getLookupData } from "./lookupData/index.js"
import { getDispatcher, isVerbose, logTiming, markRetryable, runWithConcurrency, withRetry } from "./transport.js"

interface Envelope<T> {
  code?: string | number
  msg?: string
  status?: boolean
  success?: boolean
  data?: T
}

const PAGINATION_CONCURRENCY = Number(process.env.GANGTISE_PAGE_CONCURRENCY ?? 5) || 5
const AUTH_RETRY_CODES = new Set(["8000014", "8000015"])

export interface DownloadResponse {
  data?: Uint8Array
  text?: string
  url?: string
  contentType?: string
  filename?: string
  /** When set, the response body has been streamed directly to this path (no in-memory buffer). */
  savedPath?: string
}

export class GangtiseClient {
  private refreshPromise: Promise<string> | null = null
  private memoCache: TokenCache | null = null

  constructor(private readonly config: CliConfig) {}

  private async getAuthorizationHeader(forceRefresh = false): Promise<string> {
    if (this.config.token && !forceRefresh) {
      return normalizeToken(this.config.token)
    }

    if (!forceRefresh) {
      if (isTokenCacheValid(this.memoCache)) {
        return normalizeToken(this.memoCache!.accessToken)
      }
      const cache = await readTokenCache(this.config.tokenCachePath)
      if (isTokenCacheValid(cache)) {
        this.memoCache = cache
        return normalizeToken(cache!.accessToken)
      }
    }

    if (!this.refreshPromise) {
      this.refreshPromise = this.doTokenRefresh().finally(() => { this.refreshPromise = null })
    }
    return this.refreshPromise
  }

  private async doTokenRefresh(): Promise<string> {
    const credentials = requireAccessCredentials(this.config.accessKey, this.config.secretKey)

    const envelope = await this.requestJson<{
      accessToken: string
      expiresIn: number
      uid?: number
      userName?: string
      tenantId?: number
      time: number
    }>(ENDPOINTS["auth.login"], {
      accessKey: credentials.accessKey,
      secretKey: credentials.secretKey,
    }, false)

    const accessToken = normalizeToken(envelope.accessToken)
    const expiresAt = Math.floor(Date.now() / 1000) + envelope.expiresIn

    const cache: TokenCache = { ...envelope, accessToken, expiresAt }
    this.memoCache = cache
    await writeTokenCache(this.config.tokenCachePath, cache)

    return accessToken
  }

  private isEnvelope<T>(parsed: unknown): parsed is Envelope<T> {
    if (!parsed || typeof parsed !== 'object') return false
    const obj = parsed as Record<string, unknown>
    if (!('code' in obj)) return false
    return 'msg' in obj || 'data' in obj || 'success' in obj || 'status' in obj
  }

  private throwHttpError(parsed: unknown, statusCode: number): never {
    if (this.isEnvelope(parsed)) {
      const code = parsed.code === undefined ? undefined : String(parsed.code)
      throw new ApiError(parsed.msg || `API request failed (HTTP ${statusCode})`, code, statusCode, parsed)
    }

    throw new ApiError(`API request failed (HTTP ${statusCode})`, undefined, statusCode, parsed)
  }

  private unwrapEnvelope<T>(parsed: Envelope<T>, statusCode?: number): T {
    if (!this.isEnvelope<T>(parsed)) {
      return parsed as T
    }

    const code = parsed.code === undefined ? undefined : String(parsed.code)
    const ok = parsed.status === true || parsed.success === true || code === "000000" || code === "0"

    if (!ok) {
      throw new ApiError(parsed.msg || "API request failed", code, statusCode, parsed)
    }

    if ('data' in parsed) {
      return parsed.data as T
    }

    return parsed as T
  }

  private async readLocalLookup(endpoint: EndpointDefinition) {
    const keyMapping: Record<string, Parameters<typeof getLookupData>[0]> = {
      "lookup.research-areas.list": "research-areas",
      "lookup.broker-orgs.list": "broker-orgs",
      "lookup.meeting-orgs.list": "meeting-orgs",
      "lookup.industries.list": "industries",
      "lookup.regions.list": "regions",
      "lookup.announcement-categories.list": "announcement-categories",
      "lookup.industry-codes.list": "industry-codes",
      "lookup.theme-ids.list": "theme-ids",
    }

    const lookupKey = keyMapping[endpoint.key]
    if (lookupKey) {
      return getLookupData(lookupKey)
    }

    throw new ApiError(`Unsupported local lookup endpoint: ${endpoint.key}`)
  }

  private isPaginatedListResponse(value: unknown): value is Record<string, unknown> & { total: number; list: unknown[] } {
    return Boolean(
      value
      && typeof value === 'object'
      && typeof (value as { total?: unknown }).total === 'number'
      && Array.isArray((value as { list?: unknown[] }).list),
    )
  }

  private async requestPaginated(endpoint: EndpointDefinition, body?: unknown) {
    const initialBody = body && typeof body === 'object' ? { ...(body as Record<string, unknown>) } : {}

    if ('from' in initialBody && (typeof initialBody.from !== 'number' || !Number.isFinite(initialBody.from) || initialBody.from < 0)) {
      throw new ValidationError('Invalid from: expected a non-negative number')
    }
    if ('size' in initialBody && initialBody.size !== undefined && (typeof initialBody.size !== 'number' || !Number.isFinite(initialBody.size) || initialBody.size <= 0)) {
      throw new ValidationError('Invalid size: expected a positive number')
    }

    const startFrom = typeof initialBody.from === 'number' && Number.isFinite(initialBody.from) ? initialBody.from : 0
    const requestedSize = typeof initialBody.size === 'number' && Number.isFinite(initialBody.size) ? initialBody.size : undefined
    const maxPageSize = endpoint.pagination?.maxPageSize ?? requestedSize ?? 20

    // First page: serial — we need total before deciding how many more requests to fan out.
    const firstPageSize = requestedSize === undefined ? maxPageSize : Math.min(maxPageSize, requestedSize)
    const firstPage = await this.requestJson<Record<string, unknown>>(endpoint, {
      ...initialBody,
      from: startFrom,
      size: firstPageSize,
    })

    if (!this.isPaginatedListResponse(firstPage)) return firstPage

    const total = firstPage.total
    const collected: unknown[] = [...firstPage.list]

    // Last page reached on first request
    if (firstPage.list.length < firstPageSize) {
      return {
        ...firstPage,
        total,
        list: requestedSize === undefined ? collected : collected.slice(0, requestedSize),
      }
    }

    const available = Math.max(total - startFrom, 0)
    const target = requestedSize === undefined ? available : Math.min(requestedSize, available)

    if (collected.length >= target) {
      return {
        ...firstPage,
        total,
        list: requestedSize === undefined ? collected : collected.slice(0, requestedSize),
      }
    }

    // Build remaining page requests
    type PageReq = { from: number; size: number }
    const pageRequests: PageReq[] = []
    let nextFrom = startFrom + firstPage.list.length
    const endFrom = startFrom + target
    while (nextFrom < endFrom) {
      const remaining = endFrom - nextFrom
      const size = Math.min(maxPageSize, remaining)
      pageRequests.push({ from: nextFrom, size })
      nextFrom += size
    }

    const MAX_PAGES = 1000
    if (pageRequests.length + 1 > MAX_PAGES) {
      pageRequests.length = MAX_PAGES - 1
    }

    let unexpectedShape = false
    let totalDrift = false
    const pages = await runWithConcurrency(pageRequests, PAGINATION_CONCURRENCY, async (req) => {
      const page = await this.requestJson<Record<string, unknown>>(endpoint, {
        ...initialBody,
        from: req.from,
        size: req.size,
      })
      if (!this.isPaginatedListResponse(page)) {
        unexpectedShape = true
        return [] as unknown[]
      }
      if (page.total !== total) totalDrift = true
      return page.list
    })

    for (const list of pages) {
      if (list.length === 0) continue
      collected.push(...list)
    }

    if (unexpectedShape && isVerbose()) {
      process.stderr.write(`[gangtise] warning: a page response had unexpected shape; results may be incomplete\n`)
    }
    if (totalDrift && isVerbose()) {
      process.stderr.write(`[gangtise] warning: 'total' changed across pages (data shifted during fetch)\n`)
    }

    return {
      ...firstPage,
      total,
      list: requestedSize === undefined ? collected : collected.slice(0, requestedSize),
    }
  }

  async login() {
    const authorization = await this.getAuthorizationHeader()
    const cache = await readTokenCache(this.config.tokenCachePath)
    return {
      authorization,
      cache,
    }
  }

  async requestJson<T>(endpoint: EndpointDefinition, body?: unknown, useAuth = true): Promise<T> {
    if (endpoint.path.startsWith('/guide/')) {
      return this.readLocalLookup(endpoint) as Promise<T>
    }

    const dispatcher = getDispatcher()
    const url = new URL(endpoint.path, this.config.baseUrl)
    let authRetried = false

    return withRetry(async () => {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      }
      if (useAuth) {
        headers.Authorization = await this.getAuthorizationHeader()
      }

      const startedAt = Date.now()
      const response = await request(url, {
        method: endpoint.method,
        headers,
        body: endpoint.method === 'GET' ? undefined : JSON.stringify(body ?? {}),
        headersTimeout: this.config.timeoutMs,
        bodyTimeout: this.config.timeoutMs,
        dispatcher,
      })
      const text = await response.body.text()
      logTiming(`${endpoint.method} ${endpoint.path}`, Date.now() - startedAt, `${response.statusCode}, ${text.length}B`)

      let parsed: Envelope<T>
      try {
        parsed = JSON.parse(text) as Envelope<T>
      } catch {
        const message = response.statusCode >= 400
          ? `API request failed (HTTP ${response.statusCode})`
          : 'Failed to parse API response'
        throw new ApiError(message, undefined, response.statusCode, text.slice(0, 500))
      }

      if (response.statusCode >= 400) {
        this.throwHttpError(parsed, response.statusCode)
      }

      try {
        return this.unwrapEnvelope(parsed, response.statusCode)
      } catch (error) {
        // Auto-recover from auth errors by forcing a token refresh once.
        if (
          useAuth
          && !authRetried
          && error instanceof ApiError
          && error.code
          && AUTH_RETRY_CODES.has(error.code)
          && (this.config.accessKey && this.config.secretKey)
        ) {
          authRetried = true
          this.memoCache = null
          await this.getAuthorizationHeader(true)
          throw markRetryable(new ApiError(error.message, error.code, error.statusCode, error.details))
        }
        throw error
      }
    }, {
      onRetry: (attempt, error, delay) => {
        if (!isVerbose()) return
        const msg = error instanceof Error ? error.message : String(error)
        process.stderr.write(`[gangtise] retry ${attempt} after ${delay.toFixed(0)}ms: ${msg.slice(0, 120)}\n`)
      },
    })
  }

  async download(endpoint: EndpointDefinition, query: Record<string, string | number>, options?: { streamTo?: string }): Promise<DownloadResponse> {
    const dispatcher = getDispatcher()
    const url = new URL(endpoint.path, this.config.baseUrl)
    Object.entries(query).forEach(([key, value]) => {
      url.searchParams.set(key, String(value))
    })

    return withRetry(async () => {
      const authorization = await this.getAuthorizationHeader()
      const startedAt = Date.now()
      const response = await request(url, {
        method: endpoint.method,
        headers: { Authorization: authorization },
        headersTimeout: this.config.timeoutMs,
        bodyTimeout: this.config.timeoutMs,
        dispatcher,
      })

      const contentType = Array.isArray(response.headers['content-type']) ? response.headers['content-type'][0] : response.headers['content-type']

      if (contentType?.includes('application/json')) {
        const text = await response.body.text()
        logTiming(`GET ${endpoint.path} (json)`, Date.now() - startedAt, `${response.statusCode}, ${text.length}B`)
        let parsed: unknown
        try {
          parsed = JSON.parse(text)
        } catch {
          if (response.statusCode >= 400) {
            throw new ApiError('Download failed', undefined, response.statusCode, text)
          }
          return { text, contentType }
        }

        if (response.statusCode >= 400) {
          this.throwHttpError(parsed, response.statusCode)
        }

        const data = this.unwrapEnvelope(parsed as Envelope<unknown>, response.statusCode)
        if (data && typeof data === 'object' && 'url' in (data as Record<string, unknown>) && typeof (data as Record<string, unknown>).url === 'string') {
          return { url: String((data as Record<string, unknown>).url), contentType }
        }
        return { text: JSON.stringify(data, null, 2), contentType }
      }

      if (contentType?.includes('text/plain') || contentType?.includes('text/html')) {
        const text = await response.body.text()
        logTiming(`GET ${endpoint.path} (text)`, Date.now() - startedAt, `${response.statusCode}, ${text.length}B`)
        if (response.statusCode >= 400) {
          throw new ApiError('Download failed', undefined, response.statusCode, text)
        }
        return { text, contentType }
      }

      if (response.statusCode >= 400) {
        const text = await response.body.text()
        throw new ApiError('Download failed', undefined, response.statusCode, text)
      }

      const contentDisposition = response.headers['content-disposition']
      const filenameMatch = Array.isArray(contentDisposition)
        ? contentDisposition[0]?.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i)
        : contentDisposition?.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i)
      const filename = filenameMatch ? decodeURIComponent(filenameMatch[1] || filenameMatch[2]) : undefined

      // Stream directly to disk when caller already knows the destination
      if (options?.streamTo) {
        await fs.mkdir(path.dirname(options.streamTo), { recursive: true })
        await pipeline(response.body, createWriteStream(options.streamTo))
        logTiming(`GET ${endpoint.path} (stream)`, Date.now() - startedAt, `${response.statusCode}`)
        return { contentType, filename, savedPath: options.streamTo }
      }

      const buffer = await response.body.arrayBuffer()
      logTiming(`GET ${endpoint.path} (binary)`, Date.now() - startedAt, `${response.statusCode}, ${buffer.byteLength}B`)
      return {
        data: new Uint8Array(buffer),
        contentType,
        filename,
      }
    }, {
      onRetry: (attempt, error, delay) => {
        if (!isVerbose()) return
        const msg = error instanceof Error ? error.message : String(error)
        process.stderr.write(`[gangtise] download retry ${attempt} after ${delay.toFixed(0)}ms: ${msg.slice(0, 120)}\n`)
      },
    })
  }

  async call(endpointKey: string, body?: unknown, query?: Record<string, string | number>, options?: { streamTo?: string }) {
    const endpoint = ENDPOINTS[endpointKey]
    if (!endpoint) {
      throw new ApiError(`Unknown endpoint key: ${endpointKey}`)
    }

    if (endpoint.kind === 'download') {
      return this.download(endpoint, query ?? {}, options)
    }

    if (endpoint.kind === 'json' && endpoint.pagination?.enabled) {
      return this.requestPaginated(endpoint, body)
    }

    return this.requestJson(endpoint, body)
  }
}
