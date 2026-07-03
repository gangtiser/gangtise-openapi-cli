export class CliError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

export class ConfigError extends CliError {}
export class ValidationError extends CliError {}
export class DownloadError extends CliError {}

const ERROR_HINTS: Record<string, string> = {
  "999999": "Gangtise 系统错误，请稍后重试。",
  "999997": "当前账号未开通该接口权限。",
  "999995": "当前账号积分不足。",
  "900002": "请求缺少 uid。",
  "900001": "请求参数为空或缺少必填项。",
  "0000001008": "Token 已失效（多为他处登录挤掉本会话）；有 AK/SK 时 CLI 会自动重新登录重试一次，否则请重新登录。",
  "8000014": "GANGTISE_ACCESS_KEY 错误。",
  "8000015": "GANGTISE_SECRET_KEY 错误。",
  "8000016": "开发账号状态异常。",
  "8000018": "开发账号已到期。",
  "903301": "今日调用次数已达上限。",
  "410110": "异步内容生成中，稍后用对应 *-check 命令查询。",
  "410111": "异步内容生成失败（终态），请更换参数后重新提交。",
  "410004": "数据未找到或无指标权限，请检查查询条件与指标权限。",
  "430004": "下载失败（官方未文档化错误码），请确认 reportId 有效或更换 --file-type 重试。",
  "430007": "行情查询超出限制，请缩短日期范围。",
  "433007": "数据源不匹配，请检查 resourceType 与 sourceId 组合。",
  "10011401": "白名单未开通，请联系管理员。",
}

export class ApiError extends CliError {
  readonly hint?: string

  constructor(
    message: string,
    readonly code?: string,
    readonly statusCode?: number,
    readonly details?: unknown,
  ) {
    super(message)
    this.hint = code ? ERROR_HINTS[code] : undefined
  }
}
