const DATABASE_NAME = 'halloween-jeopardy-media'
const DATABASE_VERSION = 1
const ASSET_STORE = 'assets'
const MEDIA_API = '/api/media'
const ACCEPTED_IMAGE_TYPES: Record<string, true> = {
  'image/png': true,
  'image/jpeg': true,
  'image/webp': true,
}
const ACCEPTED_AUDIO_TYPES: Record<string, true> = {
  'audio/mpeg': true,
  'audio/mp3': true,
  'audio/wav': true,
  'audio/x-wav': true,
  'audio/ogg': true,
}
const MAX_MEDIA_UPLOAD_BYTES = 10 * 1024 * 1024

export type MediaAsset = {
  reference: string
  name: string
  mimeType: string
  size: number
  createdAt: string
}

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
    request.onerror = () => reject(request.error ?? new Error('Could not load an older local image.'))
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

async function responseError(response: Response, fallback: string): Promise<Error> {
  try {
    const result = await response.json() as { error?: unknown }
    if (typeof result.error === 'string') return new Error(result.error)
  } catch {
    // Use the caller's stable message for non-JSON failures.
  }
  return new Error(fallback)
}

export function isMediaAssetReference(reference: string): boolean {
  return assetId(reference) !== null
}

export function isEmbeddedImageReference(reference: string): boolean {
  return /^data:image\/(?:png|jpeg|webp);base64,/.test(reference)
}

export function isEmbeddedAudioReference(reference: string): boolean {
  return /^data:audio\/(?:mpeg|mp3|wav|x-wav|ogg);base64,/.test(reference)
}

export function mediaAssetUrl(reference: string): string {
  const id = assetId(reference)
  return id ? `${MEDIA_API}/${encodeURIComponent(id)}` : reference
}

async function listAssets(type: 'image' | 'audio'): Promise<MediaAsset[]> {
  let response: Response
  try {
    response = await fetch(`${MEDIA_API}?type=${type}`)
  } catch {
    throw new Error('Could not connect to the media server. Start the app with `npm run dev`.')
  }
  if (!response.ok) throw await responseError(response, `Could not load the saved ${type} library.`)
  return await response.json() as MediaAsset[]
}

export function listMediaAssets(): Promise<MediaAsset[]> {
  return listAssets('image')
}

export function listAudioAssets(): Promise<MediaAsset[]> {
  return listAssets('audio')
}

async function uploadMediaAsset(blob: Blob, name: string): Promise<string> {
  if (blob.size > MAX_MEDIA_UPLOAD_BYTES) throw new Error('Media files must be 10 MB or smaller.')

  let response: Response
  try {
    response = await fetch(MEDIA_API, {
      method: 'POST',
      headers: {
        'Content-Type': blob.type,
        'X-File-Name': encodeURIComponent(name),
      },
      body: blob,
    })
  } catch {
    throw new Error('Could not connect to the media server. Start the app with `npm run dev`.')
  }
  if (!response.ok) throw await responseError(response, 'Could not save this media on the server.')
  const asset = await response.json() as MediaAsset
  return asset.reference
}

export async function storeMediaAsset(blob: Blob, name = 'Uploaded image'): Promise<string> {
  if (!Object.hasOwn(ACCEPTED_IMAGE_TYPES, blob.type.toLowerCase())) throw new Error('Upload a PNG, JPEG, or WebP image.')
  return uploadMediaAsset(blob, name)
}

export async function storeAudioAsset(blob: Blob, name = 'Uploaded sound'): Promise<string> {
  if (!Object.hasOwn(ACCEPTED_AUDIO_TYPES, blob.type.toLowerCase())) throw new Error('Upload an MP3, WAV, or OGG sound file.')
  return uploadMediaAsset(blob, name)
}

async function readLegacyMediaAsset(reference: string): Promise<Blob | null> {
  const id = assetId(reference)
  if (!id) return null
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(ASSET_STORE, 'readonly')
    const request = transaction.objectStore(ASSET_STORE).get(id)
    let result: unknown
    request.onsuccess = () => { result = request.result }
    request.onerror = () => reject(request.error ?? new Error('Could not load this older local image.'))
    transaction.oncomplete = () => resolve(result instanceof Blob ? result : null)
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not load this older local image.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Loading this older local image was cancelled.'))
  })
}

export async function readMediaAsset(reference: string): Promise<Blob | null> {
  const id = assetId(reference)
  if (!id) return null

  let response: Response
  try {
    response = await fetch(mediaAssetUrl(reference))
  } catch {
    return readLegacyMediaAsset(reference)
  }
  if (response.status === 404) return readLegacyMediaAsset(reference)
  if (!response.ok) throw await responseError(response, 'Could not load this saved media.')
  return response.blob()
}

export async function mediaAssetAsDataUrl(reference: string): Promise<string> {
  const blob = await readMediaAsset(reference)
  if (!blob) throw new Error('An uploaded media file is missing from the server and this browser. Import a full config export or upload a replacement.')

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('Could not encode media for export.'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Could not encode media for export.'))
    reader.readAsDataURL(blob)
  })
}

export async function storeEmbeddedImage(dataUrl: string): Promise<string> {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl)
  if (!match) throw new Error('Imported image data must be PNG, JPEG, or WebP.')

  const binary = window.atob(match[2])
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  const extension = match[1] === 'image/jpeg' ? 'jpg' : match[1].slice('image/'.length)
  return storeMediaAsset(new Blob([bytes], { type: match[1] }), `Imported image.${extension}`)
}

export async function storeEmbeddedAudio(dataUrl: string): Promise<string> {
  const match = /^data:(audio\/(?:mpeg|mp3|wav|x-wav|ogg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl)
  if (!match) throw new Error('Imported sound data must be MP3, WAV, or OGG.')

  const mimeType = match[1] === 'audio/mp3' ? 'audio/mpeg' : match[1] === 'audio/x-wav' ? 'audio/wav' : match[1]
  const binary = window.atob(match[2])
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  const extension = mimeType === 'audio/mpeg' ? 'mp3' : mimeType.slice('audio/'.length)
  return storeAudioAsset(new Blob([bytes], { type: mimeType }), `Imported sound.${extension}`)
}
