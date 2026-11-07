/**
 * 面板 HTTP 客户端：NM1 每请求签名 + 统一错误归一化。
 * meta / pair 免签；其余端点全部签名（§3.3）。
 */

import type { StoredDevice } from './credentials'
import { bodyHash, randomNonce, sign, signingString, type Nm1Algo } from './nm1'
import { ApiError } from '@/types/api'

/** 存储的 algo 兼容两种表示：契约小写名（'ed25519'/'ecdsa-p256'）与旧 WebCrypto 名（'Ed25519'/'P-256'） */
function storedAlgo(algo: string): Nm1Algo {
  return algo.toLowerCase().includes('ed25519') ? 'Ed25519' : 'P-256'
}

export interface RequestOptions {
  query?: Record<string, string | number | undefined>
  body?: string
  /** 免签端点（meta/pair）显式声明；默认签名 */
  unsigned?: boolean
  /** 附加请求头（如 If-Match） */
  headers?: Record<string, string>
  /** 内部：401 恢复后已重试过一次，防止循环 */
  _retried?: boolean
}

export interface ApiResponse {
  status: number
  headers: Headers
  text: string
  /** 原始字节（二进制下载用；text 即它的 UTF-8 解码） */
  bytes: ArrayBuffer
  json: () => unknown
}

function buildQuery(query: Record<string, string | number | undefined> | undefined): string {
  if (!query) return ''
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) params.set(k, String(v))
  }
  const s = params.toString()
  return s
}

export class PanelClient {
  host = ''
  device: StoredDevice | null = null
  /**
   * 401 自愈钩子（connection store 注册）：设备凭据失效时尝试恢复。
   * 入参为服务端 401 message（契约 §5.4 分支依据）。
   * 返回 true = 已恢复，当前请求重签重试一次；false = 放弃，按原错误抛出。
   */
  onUnauthorized: ((message: string) => Promise<boolean>) | null = null

  get baseUrl(): string {
    return `http://${this.host}`
  }

  isConfigured(): boolean {
    return this.host.length > 0
  }

  /** 是否已配对（可发签名请求） */
  isPaired(): boolean {
    return this.device !== null
  }

  async configure(host: string, device: StoredDevice | null): Promise<void> {
    this.host = host
    this.device = device
  }

  private pathWithQuery(path: string, query: string): string {
    return query ? `${path}?${query}` : path
  }

  async request(method: string, path: string, options: RequestOptions = {}): Promise<ApiResponse> {
    if (!this.isConfigured()) throw new ApiError(0, 'internal', '未配置服务地址')
    const query = buildQuery(options.query)
    const rawPath = this.pathWithQuery(path, query)
    const headers: Record<string, string> = { ...options.headers }
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'

    if (!options.unsigned) {
      const device = this.device
      if (!device) throw new ApiError(401, 'unauthorized', '尚未配对')
      const ts = Math.floor(Date.now() / 1000)
      const nonce = randomNonce()
      const bh = await bodyHash(options.body)
      const sig = await sign(device.privateKey, storedAlgo(device.algo), signingString(method, path, query, ts, nonce, bh))
      headers['Authorization'] =
        `NeoMacros1 id=${device.clientId}, ts=${ts}, nonce=${nonce}, bh=${bh}, sig=${sig}`
    }

    let res: Response
    try {
      res = await fetch(this.baseUrl + rawPath, {
        method,
        headers,
        body: options.body,
        // 同源凭据无关；明确不带 cookies，避免无谓的预检升级
        credentials: 'omit',
      })
    } catch (e) {
      throw new ApiError(0, 'internal', '无法连接到 NeoMacros 服务（检查 web start 与本地网络权限）')
    }

    const bytes = await res.arrayBuffer()
    const text = new TextDecoder().decode(bytes)
    if (!res.ok) {
      let code = 'internal'
      let message = res.statusText || '请求失败'
      let payload: unknown
      try {
        const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } } & Record<string, unknown>
        if (parsed?.error) {
          code = parsed.error.code ?? code
          message = parsed.error.message ?? message
          payload = parsed
        }
      } catch {
        /* 非 JSON 错误体，保持默认 */
      }
      // 设备凭据失效（401）：尝试恢复一次后重签重试
      if (res.status === 401 && !options.unsigned && !options._retried && this.onUnauthorized) {
        const recovered = await this.onUnauthorized(message)
        if (recovered) {
          return this.request(method, path, { ...options, _retried: true })
        }
      }
      throw new ApiError(res.status, code, message, payload)
    }
    return {
      status: res.status,
      headers: res.headers,
      text,
      bytes,
      json: () => JSON.parse(text),
    }
  }
}

/** 全局单例；connection store 负责装配。 */
export const client = new PanelClient()
