import { request } from "undici"
import fs from "node:fs/promises"

import type { CliConfig } from "./config.js"
import { normalizeToken, readTokenCache, requireAccessCredentials, writeTokenCache } from "./auth.js"
import { ApiError } from "./errors.js"
import { ENDPOINTS, ENDPOINT_REGISTRY, type EndpointDefinition } from "./endpoints.js"

interface Envelope<T> {
  code?: string | number
  msg?: string
  status?: boolean
  success?: boolean
  data?: T
}

export class GangtiseClient {
  constructor(private readonly config: CliConfig) {}

  private async getAuthorizationHeader(): Promise<string> {
    if (this.config.token) {
      return normalizeToken(this.config.token)
    }

    const cache = await readTokenCache(this.config.tokenCachePath)
    if (cache?.accessToken && cache.expiresAt - 300 > Math.floor(Date.now() / 1000)) {
      return normalizeToken(cache.accessToken)
    }

    const credentials = requireAccessCredentials(this.config.accessKey, this.config.secretKey)

    const envelope = await this.requestJson<{
      accessToken: string
      expiresIn: number
      uid?: number
      userName?: string
      tenantId?: number
      time: number
    }>(ENDPOINTS.authLogin, {
      accessKey: credentials.accessKey,
      secretKey: credentials.secretKey,
    }, false)

    const accessToken = normalizeToken(envelope.accessToken)
    const issuedAt = envelope.time ?? Math.floor(Date.now() / 1000)
    const expiresAt = issuedAt + envelope.expiresIn

    await writeTokenCache(this.config.tokenCachePath, {
      ...envelope,
      accessToken,
      expiresAt,
    })

    return accessToken
  }

  private unwrapEnvelope<T>(parsed: Envelope<T>, statusCode?: number): T {
    const hasEnvelopeFields = parsed && typeof parsed === 'object' && ('code' in parsed || 'status' in parsed || 'success' in parsed || 'data' in parsed)

    if (!hasEnvelopeFields) {
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
    const base = process.cwd()
    const resolve = async (relativePath: string) => {
      const content = await fs.readFile(`${base}/${relativePath}`, "utf8")
      return content
    }

    if (endpoint.key === "lookup.research-areas.list") {
      const html = await resolve('.claude/researchArea.html')
      const matches = [...html.matchAll(/<tr><td>([^<]+)<\/td><td>([^<]+)<\/td><\/tr>/g)]
      return matches.map(([, id, name]) => ({ id, name }))
    }

    if (endpoint.key === "lookup.broker-orgs.list") {
      const html = await resolve('.claude/brokerReportOrg.html')
      const matches = [...html.matchAll(/<tr><td>(C[^<]+)<\/td><td>([^<]+)<\/td><\/tr>/g)]
      return matches.map(([, id, name]) => ({ id, name }))
    }

    if (endpoint.key === "lookup.meeting-orgs.list") {
      const html = await resolve('.claude/meetingOrg.html')
      const matches = [...html.matchAll(/<tr><td>(C[^<]+)<\/td><td>([^<]+)<\/td><\/tr>/g)]
      return matches.map(([, id, name]) => ({ id, name }))
    }

    if (endpoint.key === "lookup.industries.list") {
      const html = await resolve('.claude/industryEnum.html')
      const sw = html.match(/<h3 id="申万行业分类"[\s\S]*?<table>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/)
      const matches = sw ? [...sw[1].matchAll(/<tr><td>([^<]+)<\/td><td>([^<]+)<\/td><\/tr>/g)] : []
      return matches.map(([, name, id]) => ({ id, name, taxonomy: 'sw' }))
    }

    throw new ApiError(`Unsupported local lookup endpoint: ${endpoint.key}`)
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

    const headers: Record<string, string> = {
      'content-type': 'application/json',
    }

    if (useAuth) {
      headers.Authorization = await this.getAuthorizationHeader()
    }

    const response = await request(new URL(endpoint.path, this.config.baseUrl), {
      method: endpoint.method,
      headers,
      body: endpoint.method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      headersTimeout: this.config.timeoutMs,
      bodyTimeout: this.config.timeoutMs,
    })

    const text = await response.body.text()
    let parsed: Envelope<T>

    try {
      parsed = JSON.parse(text) as Envelope<T>
    } catch {
      throw new ApiError('Failed to parse API response', undefined, response.statusCode, text)
    }

    return this.unwrapEnvelope(parsed, response.statusCode)
  }

  async download(endpoint: EndpointDefinition, query: Record<string, string | number>): Promise<{ data?: Uint8Array; text?: string; url?: string; contentType?: string; filename?: string }> {
    const authorization = await this.getAuthorizationHeader()
    const url = new URL(endpoint.path, this.config.baseUrl)

    Object.entries(query).forEach(([key, value]) => {
      url.searchParams.set(key, String(value))
    })

    const response = await request(url, {
      method: endpoint.method,
      headers: {
        Authorization: authorization,
      },
      headersTimeout: this.config.timeoutMs,
      bodyTimeout: this.config.timeoutMs,
    })

    const contentType = Array.isArray(response.headers['content-type']) ? response.headers['content-type'][0] : response.headers['content-type']

    if (contentType?.includes('application/json')) {
      const text = await response.body.text()
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        if (response.statusCode >= 400) {
          throw new ApiError('Download failed', undefined, response.statusCode, text)
        }
        return { text, contentType }
      }

      const hasEnvelopeFields = parsed && typeof parsed === 'object' && ('code' in (parsed as Record<string, unknown>) || 'status' in (parsed as Record<string, unknown>) || 'success' in (parsed as Record<string, unknown>) || 'data' in (parsed as Record<string, unknown>))
      if (hasEnvelopeFields) {
        const data = this.unwrapEnvelope(parsed as Envelope<unknown>, response.statusCode)
        if (data && typeof data === 'object' && 'url' in (data as Record<string, unknown>) && typeof (data as Record<string, unknown>).url === 'string') {
          return { url: String((data as Record<string, unknown>).url), contentType }
        }
        return { text: JSON.stringify(data, null, 2), contentType }
      }

      if (parsed && typeof parsed === 'object' && 'url' in (parsed as Record<string, unknown>) && typeof (parsed as Record<string, unknown>).url === 'string') {
        return { url: String((parsed as Record<string, unknown>).url), contentType }
      }

      return { text: JSON.stringify(parsed, null, 2), contentType }
    }

    if (contentType?.includes('text/plain') || contentType?.includes('text/html')) {
      const text = await response.body.text()
      if (response.statusCode >= 400) {
        throw new ApiError('Download failed', undefined, response.statusCode, text)
      }
      return { text, contentType }
    }

    if (response.statusCode >= 400) {
      const text = await response.body.text()
      throw new ApiError('Download failed', undefined, response.statusCode, text)
    }

    const buffer = await response.body.arrayBuffer()
    const contentDisposition = response.headers['content-disposition']
    const filenameMatch = Array.isArray(contentDisposition)
      ? contentDisposition[0]?.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i)
      : contentDisposition?.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i)

    return {
      data: new Uint8Array(buffer),
      contentType,
      filename: filenameMatch ? decodeURIComponent(filenameMatch[1] || filenameMatch[2]) : undefined,
    }
  }

  async call(endpointKey: string, body?: unknown, query?: Record<string, string | number>) {
    const endpoint = ENDPOINT_REGISTRY[endpointKey]
    if (!endpoint) {
      throw new ApiError(`Unknown endpoint key: ${endpointKey}`)
    }

    if (endpoint.kind === 'download') {
      return this.download(endpoint, query ?? {})
    }

    return this.requestJson(endpoint, body)
  }
}
