/**
 * 连接状态机：深链引导 → meta 首探 →（未配对则配对）→ 在线。
 * 状态流转：disconnected → probing → (unreachable | unpaired | online)
 */

import { reactive, computed } from 'vue'
import { client } from '@/api/client'
import { getMeta, pair as apiPair, requestPair, getPairRequest } from '@/api/endpoints'
import { deleteDevice, loadDevice, saveDevice, type StoredDevice } from '@/api/credentials'
import { deviceLabel, generateKeypair } from '@/api/nm1'
import { sse } from '@/api/sse'
import type { Meta } from '@/types/api'

export type ConnStatus =
  | 'disconnected'
  | 'probing'
  | 'reconnecting'
  | 'unreachable'
  | 'unpaired'
  | 'online'

/**
 * 深链参数（契约 §2）：?host=…&view=editor&pair=<token>（query 传参，view 恒为 editor）。
 * 解析后立即从地址清除（token 不留在历史）。
 */
export interface DeepLink {
  host: string
  pairToken: string
}

function parseDeepLinkParams(raw: string): DeepLink | null {
  if (!raw) return null
  const params = new URLSearchParams(raw)
  const host = params.get('host') ?? ''
  const pairToken = params.get('pair') ?? ''
  if (!host && !pairToken) return null
  return { host, pairToken }
}

interface ConnectionState {
  status: ConnStatus
  host: string
  meta: Meta | null
  device: StoredDevice | null
  /** 配对请求进行中（同步单次，短暂） */
  pairing: boolean
  error: string
  /** 待使用的配对 token（深链带入） */
  pendingPairToken: string
  /**
   * 本次页面会话中至少完整在线过一次：断线/凭据失效时保持原界面
   * （横幅提示重连）而不是跳回连接页；主动断开/解除配对才复位。
   */
  sessionEstablished: boolean
}

export const connection = reactive<ConnectionState>({
  status: 'disconnected',
  host: '',
  meta: null,
  device: null,
  pairing: false,
  error: '',
  pendingPairToken: '',
  sessionEstablished: false,
})

export const isOnline = computed(() => connection.status === 'online')
export const statusLabel = computed(() => {
  switch (connection.status) {
    case 'disconnected':
      return '未连接'
    case 'probing':
      return '连接中…'
    case 'reconnecting':
      return '重连中…'
    case 'unreachable':
      return '无法连接'
    case 'unpaired':
      return '待配对'
    case 'online':
      return '已连接'
  }
})

const HOST_KEY = 'neomacros-panel-host'

export function rememberHost(host: string): void {
  connection.host = host
  try {
    localStorage.setItem(HOST_KEY, host)
  } catch {
    /* 隐私模式等 */
  }
}

export function lastHost(): string {
  try {
    return localStorage.getItem(HOST_KEY) ?? ''
  } catch {
    return ''
  }
}

/** 解析并清除深链参数（token 不进历史/日志） */
export function consumeDeepLink(): DeepLink | null {
  const search = location.search.startsWith('?') ? location.search.slice(1) : ''
  const link = parseDeepLinkParams(search)
  if (link) {
    history.replaceState(null, '', location.pathname + location.hash)
  }
  return link
}

/** 用已有设备（IndexedDB）连接指定 host */
export async function connect(host: string): Promise<void> {
  connection.status = 'probing'
  connection.error = ''
  try {
    const device = await loadDevice(host) ?? null
    client.configure(host, device)
    const meta = await getMeta()
    connection.meta = meta
    connection.device = device
    rememberHost(host)
    if (!meta.api.includes(1)) {
      connection.status = 'unreachable'
      connection.error = `mod 版本过旧（API ${meta.api.join('/')} 不含 v1），请更新 NeoMacros`
      return
    }
    if (device) {
      connection.sessionEstablished = true
      connection.status = 'online'
      sse.start()
    } else {
      connection.status = 'unpaired'
    }
  } catch (e) {
    connection.status = 'unreachable'
    connection.error = e instanceof Error ? e.message : '连接失败'
  }
}

/** 配对成功后的共同收尾：凭据入库、切在线、启动事件流 */
async function finishPairing(
  clientId: string,
  wireAlgo: string,
  keypair: Awaited<ReturnType<typeof generateKeypair>>,
): Promise<void> {
  const device: StoredDevice = {
    host: connection.host,
    clientId,
    algo: wireAlgo,
    privateKey: keypair.privateKey,
    publicKeyJwk: keypair.publicKeyJwk,
    label: deviceLabel(),
    createdAt: Date.now(),
  }
  await saveDevice(device)
  client.configure(connection.host, device)
  connection.device = device
  connection.pendingPairToken = ''
  connection.sessionEstablished = true
  connection.status = 'online'
  sse.start()
}

/**
 * 配对（契约 §4）：同步单次请求——生成密钥对 → POST token → 立即返回 clientId → 设备入库转在线。
 * token 为深链一次性令牌（单次，落盘长 TTL）。algo 上送契约小写名（'ed25519' / 'ecdsa-p256'）。
 */
export async function pair(token: string): Promise<void> {
  if (!client.isConfigured()) throw new Error('未配置服务地址')
  if (!token) throw new Error('缺少配对 token')
  connection.pairing = true
  connection.error = ''
  try {
    const keypair = await generateKeypair()
    const wireAlgo = keypair.algo === 'Ed25519' ? 'ed25519' : 'ecdsa-p256'
    const res = await apiPair({
      token,
      label: deviceLabel(),
      algo: wireAlgo,
      pubJwk: keypair.publicKeyJwk,
    })
    await finishPairing(res.clientId, wireAlgo, keypair)
  } finally {
    connection.pairing = false
  }
}

/**
 * 免 token 配对（契约 §4.1）：仅限本机回环来源。生成密钥对 → POST 申请 →
 * 信任本机已开启时立即返回 clientId；否则轮询决定（pending → approved/denied/expired），
 * 游戏内会弹出可点击的确认卡片。mod 较旧（无此端点 404）或非回环来源（403）时抛错，
 * 调用方回落到 token 配对。
 */
export async function pairWithoutToken(): Promise<void> {
  if (!client.isConfigured()) throw new Error('未配置服务地址')
  connection.pairing = true
  connection.error = ''
  try {
    const keypair = await generateKeypair()
    const wireAlgo = keypair.algo === 'Ed25519' ? 'ed25519' : 'ecdsa-p256'
    const res = await requestPair({
      label: deviceLabel(),
      algo: wireAlgo,
      pubJwk: keypair.publicKeyJwk,
    })
    if (res.status === 'paired' && res.clientId) {
      await finishPairing(res.clientId, wireAlgo, keypair)
      return
    }
    if (res.status === 'pending' && res.requestId) {
      const deadline = Date.now() + 90_000
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1000))
        const status = await getPairRequest(res.requestId)
        if (status.status === 'approved' && status.clientId) {
          await finishPairing(status.clientId, wireAlgo, keypair)
          return
        }
        if (status.status === 'denied') throw new Error('游戏内拒绝了本次配对请求')
        if (status.status === 'expired') throw new Error('配对请求已过期，请重试')
      }
      throw new Error('等待游戏内确认超时，请重试')
    }
    throw new Error('配对服务响应不合法')
  } finally {
    connection.pairing = false
  }
}

// ---- 自愈重连（契约 §6 修订）：服务不可达/游戏重启后按退避轮询，恢复即自动上线 ----

let reconnectRun = 0

/** 读取当前状态（函数间接访问，打断 TS 对 reactive 属性的控制流窄化） */
function currentStatus(): ConnStatus {
  return connection.status
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** 开始自愈重连（单飞行）：已知 host 时轮询 meta，服务恢复即 connect 回在线。 */
export function startReconnectLoop(): void {
  if (connection.status === 'reconnecting') return
  if (!connection.host && !lastHost()) return
  void runReconnectLoop(++reconnectRun)
}

/** 停止自愈重连（显式断开或已恢复时调用）。 */
export function stopReconnectLoop(): void {
  reconnectRun++
  if (connection.status === 'reconnecting') {
    connection.status = 'unreachable'
  }
}

async function runReconnectLoop(run: number): Promise<void> {
  let attempt = 0
  connection.status = 'reconnecting'
  while (run === reconnectRun) {
    const host = connection.host || lastHost()
    if (!host) return
    connection.error = ''
    try {
      // 先做无副作用的免签探测（不惊动 connect 的 probing/unreachable 状态机），
      // 服务可达才走完整连接——「重连中」显示在整轮中断期间保持稳定。
      client.configure(host, null)
      await getMeta()
      await connect(host)
    } catch {
      // 服务还没回来；继续退避轮询
    }
    if (run !== reconnectRun) return
    // online：App.vue 的 status watch 会统一触发刷新；unpaired 需要用户介入（token 或
    // 免 token 申请），不自动发申请以免未信任时向游戏刷确认卡片。
    const status = currentStatus()
    if (status === 'online' || status === 'unpaired') return
    attempt++
    await sleep(Math.min(8000, 1000 * 2 ** Math.min(attempt, 3)))
  }
}

/** 断开（保留设备凭据） */
export function disconnect(): void {
  stopReconnectLoop()
  sse.stop()
  client.configure('', null)
  connection.sessionEstablished = false
  connection.status = 'disconnected'
  connection.meta = null
  connection.device = null
}

/** 解除本机配对（删除本地凭据；服务端记录需在游戏内/设备管理吊销） */
export async function forgetDevice(): Promise<void> {
  const host = connection.device?.host ?? client.host
  if (connection.device) await deleteDevice(connection.device.host)
  sse.stop()
  // client 上的凭据引用一并清除，避免签名请求继续带旧密钥
  client.configure(host, null)
  connection.device = null
  connection.sessionEstablished = false
  connection.status = client.isConfigured() ? 'unpaired' : 'disconnected'
}

/** 凭据失效降级：回到待配对态（保留地址）。forget=true 时同时清掉本机存储的该 host 凭据 */
function downgradeToUnpaired(forget: boolean): void {
  sse.stop()
  const host = client.host
  if (forget) void deleteDevice(host)
  client.configure(host, null)
  connection.device = null
  connection.status = 'unpaired'
}

// 401 自愈（契约 §5.4）：按服务端 message 分支处理——
// unknown device（被吊销/清档）+ 手里有深链 token → 静默重配对并让请求重试一次；
// unknown device 且无 token → 走免 token 配对申请（信任本机=静默恢复；未信任=游戏内
// 出确认卡片等玩家决定；旧版 mod/非回环 → 立即失败降级）；
// timestamp 窗口失败 → 凭据本身有效（时钟问题），仅降级提示、不销毁凭据；
// 其余（nonce/bh/签名，客户端 bug）→ 降级为待配对。
// 并发 401 共享同一次自愈（token 单次，不能各自烧一个）。
let repairInFlight: Promise<boolean> | null = null
client.onUnauthorized = (message: string): Promise<boolean> => {
  if (repairInFlight) return repairInFlight
  if (message.includes('timestamp outside')) {
    downgradeToUnpaired(false)
    connection.error = '本机时钟与游戏机偏差超过 ±30s，请校时后重试'
    return Promise.resolve(false)
  }
  const unknownDevice = message.includes('unknown device')
  const token = connection.pendingPairToken
  if (!token && unknownDevice) {
    repairInFlight = (async () => {
      try {
        await pairWithoutToken()
        return true
      } catch (e) {
        connection.error = e instanceof Error ? e.message : String(e)
        downgradeToUnpaired(true)
        return false
      } finally {
        repairInFlight = null
      }
    })()
    return repairInFlight
  }
  if (!token) {
    downgradeToUnpaired(unknownDevice)
    return Promise.resolve(false)
  }
  repairInFlight = (async () => {
    try {
      await pair(token)
      return true
    } catch (e) {
      connection.error = e instanceof Error ? e.message : String(e)
      downgradeToUnpaired(unknownDevice)
      return false
    } finally {
      repairInFlight = null
    }
  })()
  return repairInFlight
}
