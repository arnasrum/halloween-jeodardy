const DATABASE_NAME = 'halloween-jeopardy-media'
const DATABASE_VERSION = 1
const ASSET_STORE = 'assets'
const ASSET_PREFIX = 'asset://'

let databasePromise: Promise<IDBDatabase> | null = null

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise
  if (!('indexedDB' in window)) return Promise.reject(new Error('This browser does not support local image storage.'))

  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(ASSET_STORE)) request.result.createObjectStore(ASSET_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open local image storage.'))
    request.onblocked = () => reject(new Error('Local image storage is busy in another tab. Close the other game tab and retry.'))
  }).catch((error: unknown) => {
    databasePromise = null
    throw error
  })
  databasePromise = opening
  return opening
}

function assetId(reference: string): string | null {
  const match = /^asset:\/\/([a-z0-9-]{16,80})$/i.exec(reference)
  return match?.[1] ?? null
}

export function isMediaAssetReference(reference: string): boolean {
  return assetId(reference) !== null
}

export function isEmbeddedImageReference(reference: string): boolean {
  return /^data:image\/(?:png|jpeg|webp);base64,/.test(reference)
}

export async function storeMediaAsset(blob: Blob): Promise<string> {
  const database = await openDatabase()
  const id = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(ASSET_STORE, 'readwrite')
    transaction.objectStore(ASSET_STORE).put(blob, id)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not save this image.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Saving this image was cancelled.'))
  })
  return `${ASSET_PREFIX}${id}`
}

export async function readMediaAsset(reference: string): Promise<Blob | null> {
  const id = assetId(reference)
  if (!id) return null
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(ASSET_STORE, 'readonly')
    const request = transaction.objectStore(ASSET_STORE).get(id)
    let result: unknown
    request.onsuccess = () => { result = request.result }
    request.onerror = () => reject(request.error ?? new Error('Could not load this image.'))
    transaction.oncomplete = () => resolve(result instanceof Blob ? result : null)
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not load this image.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Loading this image was cancelled.'))
  })
}

export async function mediaAssetAsDataUrl(reference: string): Promise<string> {
  const blob = await readMediaAsset(reference)
  if (!blob) throw new Error('An uploaded image is missing from this browser. Import the exported config or upload that image again.')

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('Could not encode an image for export.'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Could not encode an image for export.'))
    reader.readAsDataURL(blob)
  })
}

export async function storeEmbeddedImage(dataUrl: string): Promise<string> {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl)
  if (!match) throw new Error('Imported image data must be PNG, JPEG, or WebP.')

  const binary = window.atob(match[2])
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return storeMediaAsset(new Blob([bytes], { type: match[1] }))
}

export async function pruneUnusedMediaAssets(references: string[]): Promise<void> {
  const database = await openDatabase()
  const usedIds = new Set(references.map(assetId).filter((id): id is string => id !== null))
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(ASSET_STORE, 'readwrite')
    const store = transaction.objectStore(ASSET_STORE)
    const request = store.getAllKeys()
    request.onsuccess = () => {
      for (const key of request.result) {
        if (typeof key === 'string' && !usedIds.has(key)) store.delete(key)
      }
    }
    request.onerror = () => reject(request.error ?? new Error('Could not clean up unused images.'))
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not clean up unused images.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Image cleanup was cancelled.'))
  })
}
