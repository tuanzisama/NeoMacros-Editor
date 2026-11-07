/**
 * 已配对设备的本地持久化（设计文档 §9：IndexedDB，(host → {clientId, algo, keypair})）。
 * CryptoKey 可结构化克隆直接入库；extractable=false 的私钥导不出来，XSS 也拿不到原始材料。
 */

export interface StoredDevice {
  host: string
  clientId: string
  algo: string
  privateKey: CryptoKey
  publicKeyJwk: Record<string, string>
  label: string
  createdAt: number
}

const DB_NAME = 'neomacros-panel'
const STORE = 'devices'
const VERSION = 1

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'host' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'))
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('IndexedDB 操作失败'))
    })
  } finally {
    db.close()
  }
}

export async function loadDevice(host: string): Promise<StoredDevice | undefined> {
  try {
    return await withStore('readonly', (s) => s.get(host) as IDBRequest<StoredDevice | undefined>)
  } catch {
    return undefined
  }
}

export async function saveDevice(device: StoredDevice): Promise<void> {
  await withStore('readwrite', (s) => s.put(device) as IDBRequest<IDBValidKey>)
}

export async function deleteDevice(host: string): Promise<void> {
  await withStore('readwrite', (s) => s.delete(host) as IDBRequest<undefined>)
}
