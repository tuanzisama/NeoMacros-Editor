/**
 * NM1 客户端签名原语（对齐 mod 侧 Nm1Header/Nm1Keys/Nm1Verifier）。
 *
 * 签名串 = "NM1\n" + METHOD + "\n" + path + "?" + query + "\n" + ts + "\n" + nonce + "\n" + bh
 * （query 可为空串，"?" 恒在；bh = b64url(sha256(body))，空体 = sha256("")）
 *
 * 算法：Ed25519（kty=OKP）优先；WebCrypto 不支持时回退 P-256 ECDSA（kty=EC，
 * 签名为 raw r||s 64 字节，服务端转 DER 后按 SHA256withECDSA 验签）。
 * 私钥 extractable=false（设计文档 D4），仅公钥可导出 JWK 用于配对。
 */

export type Nm1Algo = 'Ed25519' | 'P-256'

export function toB64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function randomNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return toB64Url(bytes)
}

/** bh：请求体 SHA-256 的 b64url（body 为 undefined/空时 = sha256("")） */
export async function bodyHash(body: string | undefined): Promise<string> {
  const data = new TextEncoder().encode(body ?? '')
  const digest = await crypto.subtle.digest('SHA-256', data)
  return toB64Url(new Uint8Array(digest))
}

/** 与 bh 相同口径：文件内容的 sha256 b64url（ETag 回退用） */
export async function sha256B64Url(text: string): Promise<string> {
  return bodyHash(text)
}

export interface Nm1Keypair {
  algo: Nm1Algo
  privateKey: CryptoKey
  publicKeyJwk: Record<string, string>
}

/** 探测 WebCrypto Ed25519 支持；不支持则回退 P-256。 */
export async function detectAlgo(): Promise<Nm1Algo> {
  try {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])
    if ('privateKey' in pair) return 'Ed25519'
  } catch {
    /* 不支持，回退 */
  }
  return 'P-256'
}

function cleanJwk(jwk: JsonWebKey): Record<string, string> {
  // 只留算法材料字段，剥掉 key_ops/ext（服务端按 kty/crv 重建公钥）
  const out: Record<string, string> = {}
  for (const key of ['kty', 'crv', 'x', 'y'] as const) {
    const v = jwk[key]
    if (typeof v === 'string') out[key] = v
  }
  return out
}

export async function generateKeypair(): Promise<Nm1Keypair> {
  const algo = await detectAlgo()
  const algorithm: AlgorithmIdentifier | EcdsaParams =
    algo === 'Ed25519' ? { name: 'Ed25519' } : { name: 'ECDSA', hash: 'SHA-256' }
  const pair = await crypto.subtle.generateKey(algorithm, false, ['sign', 'verify'])
  if (!('privateKey' in pair)) throw new Error('keypair generation failed')
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  return { algo, privateKey: pair.privateKey, publicKeyJwk: cleanJwk(jwk) }
}

/** 对签名串签名（Ed25519 raw / P-256 raw r||s，均 b64url）。 */
export async function sign(key: CryptoKey, algo: Nm1Algo, signingString: string): Promise<string> {
  const data = new TextEncoder().encode(signingString)
  const algorithm: AlgorithmIdentifier | EcdsaParams =
    algo === 'Ed25519' ? { name: 'Ed25519' } : { name: 'ECDSA', hash: 'SHA-256' }
  const sig = await crypto.subtle.sign(algorithm, key, data)
  return toB64Url(new Uint8Array(sig))
}

/** 组装完整签名串（与 Nm1Header.signingString 逐字节一致）。 */
export function signingString(
  method: string,
  path: string,
  query: string,
  ts: number,
  nonce: string,
  bh: string,
): string {
  return `NM1\n${method}\n${path}?${query}\n${ts}\n${nonce}\n${bh}`
}

/** UA 摘要作为设备标签，如 "Chrome@Windows"。 */
export function deviceLabel(): string {
  const ua = navigator.userAgent
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Browser'
  const os =
    /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|Mac OS X/.test(ua) ? 'Apple'
    : /Linux/.test(ua) ? 'Linux'
    : 'Unknown'
  return `${browser}@${os}`
}
