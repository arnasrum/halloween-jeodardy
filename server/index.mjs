import { createHash, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataDirectory = resolve(process.env.APP_DATA_DIR ?? join(projectRoot, 'data'))
const mediaDirectory = join(dataDirectory, 'media')
const databasePath = join(dataDirectory, 'media.sqlite')
const port = Number(process.env.PORT ?? 4173)
const host = process.env.HOST ?? '127.0.0.1'

await mkdir(mediaDirectory, { recursive: true })

const database = new DatabaseSync(databasePath)
database.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_name TEXT NOT NULL UNIQUE,
    byte_size INTEGER NOT NULL,
    sha256 TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );
`)

const findMediaById = database.prepare('SELECT * FROM media WHERE id = ?')
const findMediaByHash = database.prepare('SELECT * FROM media WHERE sha256 = ?')
const listImages = database.prepare("SELECT * FROM media WHERE mime_type LIKE 'image/%' ORDER BY created_at DESC, name COLLATE NOCASE ASC")
const listAudio = database.prepare("SELECT * FROM media WHERE mime_type LIKE 'audio/%' ORDER BY created_at DESC, name COLLATE NOCASE ASC")
const insertMedia = database.prepare(`
  INSERT INTO media (id, name, mime_type, file_name, byte_size, sha256, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`)

const mediaFormats = {
  'image/png': {
    extension: 'png',
    matches: (bytes) => bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  },
  'image/jpeg': {
    extension: 'jpg',
    matches: (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  'image/webp': {
    extension: 'webp',
    matches: (bytes) => bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP',
  },
  'audio/mpeg': {
    extension: 'mp3',
    matches: (bytes) => bytes.length >= 3 && (bytes.toString('ascii', 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)),
  },
  'audio/wav': {
    extension: 'wav',
    matches: (bytes) => bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE',
  },
  'audio/ogg': {
    extension: 'ogg',
    matches: (bytes) => bytes.length >= 4 && bytes.toString('ascii', 0, 4) === 'OggS',
  },
}
const mediaMimeAliases = { 'audio/mp3': 'audio/mpeg', 'audio/x-wav': 'audio/wav' }
const acceptedMediaContentTypes = [...Object.keys(mediaFormats), ...Object.keys(mediaMimeAliases)]

function publicMedia(row) {
  return {
    reference: `asset://${row.id}`,
    name: row.name,
    mimeType: row.mime_type,
    size: row.byte_size,
    createdAt: row.created_at,
  }
}

function displayName(header, extension) {
  let submitted = ''
  try {
    submitted = decodeURIComponent(header ?? '')
  } catch {
    submitted = ''
  }
  const name = (submitted.split(/[\\/]/).at(-1) ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 160)
  return name || `Uploaded media.${extension}`
}

const app = express()
app.disable('x-powered-by')
app.get('/api/health', (_request, response) => response.json({ status: 'ok' }))
app.get('/api/media', (request, response) => {
  const type = request.query.type
  if (type === undefined || type === 'image') return response.json(listImages.all().map(publicMedia))
  if (type === 'audio') return response.json(listAudio.all().map(publicMedia))
  return response.status(400).json({ error: 'Media type must be image or audio.' })
})
app.get('/api/media/:id', (request, response, next) => {
  const id = request.params.id
  if (!/^[a-f0-9-]{16,80}$/i.test(id)) return response.sendStatus(404)
  const media = findMediaById.get(id)
  if (!media) return response.sendStatus(404)

  response.set('Cache-Control', 'public, max-age=31536000, immutable')
  response.set('X-Content-Type-Options', 'nosniff')
  response.sendFile(media.file_name, { root: mediaDirectory, headers: { 'Content-Type': media.mime_type } }, (error) => {
    if (error) next(error)
  })
})

app.post('/api/media', express.raw({ type: acceptedMediaContentTypes, limit: '10mb' }), async (request, response, next) => {
  try {
    const suppliedMimeType = request.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
    const mimeType = mediaMimeAliases[suppliedMimeType] ?? suppliedMimeType
    const format = Object.hasOwn(mediaFormats, mimeType) ? mediaFormats[mimeType] : undefined
    const bytes = request.body
    if (!format || !Buffer.isBuffer(bytes) || bytes.length === 0) {
      return response.status(415).json({ error: 'Upload a PNG, JPEG, WebP, MP3, WAV, or OGG file.' })
    }
    if (!format.matches(bytes)) return response.status(415).json({ error: 'The uploaded file does not match its declared media type.' })

    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const existing = findMediaByHash.get(sha256)
    if (existing) return response.status(200).json(publicMedia(existing))

    const id = randomUUID()
    const fileName = `${id}.${format.extension}`
    const filePath = join(mediaDirectory, fileName)
    await writeFile(filePath, bytes, { flag: 'wx' })

    try {
      insertMedia.run(id, displayName(request.get('x-file-name'), format.extension), mimeType, fileName, bytes.length, sha256, new Date().toISOString())
    } catch (error) {
      await unlink(filePath).catch(() => undefined)
      const duplicate = findMediaByHash.get(sha256)
      if (duplicate) return response.status(200).json(publicMedia(duplicate))
      throw error
    }

    return response.status(201).json(publicMedia(findMediaById.get(id)))
  } catch (error) {
    next(error)
  }
})

app.use('/api', (_request, response) => response.status(404).json({ error: 'Unknown media endpoint.' }))

const distDirectory = join(projectRoot, 'dist')
app.use(express.static(distDirectory))
app.use((request, response, next) => {
  if (request.method !== 'GET' || !request.accepts('html')) return next()
  response.sendFile(join(distDirectory, 'index.html'), (error) => {
    if (error) next(error)
  })
})
app.use((request, response) => response.status(404).json({ error: 'Not found.' }))
app.use((error, _request, response, next) => {
  if (response.headersSent) return next(error)
  const status = Number(error.status) || 500
  const message = status < 500 ? error.message : 'The media server could not complete the request.'
  response.status(status).json({ error: message })
})

app.listen(port, host, () => {
  console.log(`Media server listening at http://${host}:${port}`)
})
