<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { CONFIG_STORAGE_KEY, createDefaultGameConfig, parseGameConfig } from './gameConfig'
import type { Category, Clue, GameConfig } from './gameConfig'
import {
  isEmbeddedAudioReference,
  isEmbeddedImageReference,
  isMediaAssetReference,
  listAudioAssets,
  listMediaAssets,
  mediaAssetAsDataUrl,
  mediaAssetUrl,
  readMediaAsset,
  storeAudioAsset,
  storeEmbeddedAudio,
  storeEmbeddedImage,
  storeMediaAsset,
} from './mediaStore'
import type { MediaAsset } from './mediaStore'


type SelectedClue = {
  category: Category
  clue: Clue
} | null

type PlayedStatus = 'correct' | 'missed'
type Team = {
  name: string
  score: number
}


const SAVE_KEY = 'halloween-jeopardy:save:v2'
const LEGACY_SAVE_KEY = 'halloween-jeopardy:save:v1'

const SPECIAL_REVEAL_COUNT = 5
const SPECIAL_REVEAL_PENALTY = 100

const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024
const MAX_AUDIO_UPLOAD_BYTES = 10 * 1024 * 1024
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

function loadSavedConfiguration(): GameConfig {
  try {
    const raw = window.localStorage.getItem(CONFIG_STORAGE_KEY)
    return raw ? parseGameConfig(JSON.parse(raw)) : createDefaultGameConfig()
  } catch {
    return createDefaultGameConfig()
  }
}

const categories = ref(loadSavedConfiguration().categories)

const defaultTeams: Team[] = [
  { name: 'Team Moonlight', score: 0 },
  { name: 'Team Midnight', score: 0 },
]
const teams = ref<Team[]>(defaultTeams.map((team) => ({ ...team })))
const activeTeamIndex = ref(0)
const played = ref<Record<string, PlayedStatus>>({})
const selectedClue = ref<SelectedClue>(null)
const showAnswer = ref(false)
const reviewMode = ref(false)
const dialogRef = ref<HTMLDialogElement | null>(null)
const frameViewerDialogRef = ref<HTMLDialogElement | null>(null)
const selectedFrameIndex = ref(0)
const newTeamName = ref('')
const isAdminPage = ref(window.location.pathname.replace(/\/+$/, '') === '/admin')
const adminSection = ref<'teams' | 'clues' | 'content'>('teams')
const adminReturnPath = ref('/')
const adminTeamIndex = ref(0)
const adminTeamName = ref('')
const adminTeamScore = ref('0')
const adminPoints = ref('100')
const adminMessage = ref('')
const configFileInputRef = ref<HTMLInputElement | null>(null)
const mediaLibrary = ref<MediaAsset[]>([])
const audioLibrary = ref<MediaAsset[]>([])
const mediaError = ref('')
const configCategoryId = ref(categories.value[0]?.id ?? '')
const configCategoryName = ref('')
const configCategoryIcon = ref('')
const newCategoryName = ref('')
const newCategoryIcon = ref('👻')
const configClueIndex = ref(-1)
const configClueValue = ref('100')
const configCluePrompt = ref('')
const configClueAnswer = ref('')
const configAcceptedAnswers = ref('')
const configClueMode = ref<'standard' | 'frames' | 'zoom' | 'audio'>('standard')
const adminCategoryId = ref(categories.value[0]?.id ?? '')
const adminClueValue = ref(String(categories.value[0]?.clues[0]?.value ?? ''))
const revealStage = ref(1)
const specialGuess = ref('')
const specialFeedback = ref('')
const specialOutcome = ref<'correct' | 'missed' | null>(null)

const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
const prefersReducedMotion = ref(motionPreference.matches)
const sceneMediaRef = ref<HTMLElement | null>(null)
const isSceneFullscreen = ref(false)
const fullscreenError = ref('')

function updateReducedMotion(event: MediaQueryListEvent): void {
  prefersReducedMotion.value = event.matches
}

function updateFullscreenState(): void {
  isSceneFullscreen.value = document.fullscreenElement === sceneMediaRef.value
}

async function toggleSceneFullscreen(): Promise<void> {
  const scene = sceneMediaRef.value
  if (!scene) return
  fullscreenError.value = ''

  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen()
      return
    }
    await scene.requestFullscreen()
  } catch {
    fullscreenError.value = 'Fullscreen is unavailable in this browser.'
  }
}

onMounted(() => {
  motionPreference.addEventListener('change', updateReducedMotion)
  document.addEventListener('fullscreenchange', updateFullscreenState)
  window.addEventListener('popstate', syncAdminRoute)
  if (isAdminPage.value) prepareAdminPage()
  void refreshMediaSources()
})
onUnmounted(() => {
  motionPreference.removeEventListener('change', updateReducedMotion)
  document.removeEventListener('fullscreenchange', updateFullscreenState)
  window.removeEventListener('popstate', syncAdminRoute)
})

function collectMediaReferences(categoryList: Category[] = categories.value): string[] {
  const references: string[] = []
  for (const category of categoryList) {
    for (const clue of category.clues) {
      if (clue.mode === 'frames') references.push(...clue.frames)
      else if (clue.mode === 'zoom') references.push(clue.image)
      else if (clue.mode === 'audio') references.push(clue.audio)
    }
  }
  return references
}

function imageSource(reference: string): string {
  return mediaAssetUrl(reference)
}

function replaceMediaReference(oldReference: string, newReference: string): void {
  for (const category of categories.value) {
    for (const clue of category.clues) {
      if (clue.mode === 'frames') {
        clue.frames = clue.frames.map((reference) => reference === oldReference ? newReference : reference)
      } else if (clue.mode === 'zoom' && clue.image === oldReference) {
        clue.image = newReference
      } else if (clue.mode === 'audio' && clue.audio === oldReference) {
        clue.audio = newReference
      }
    }
  }
}

function legacyMediaName(reference: string): string {
  for (const category of categories.value) {
    for (const clue of category.clues) {
      if (clue.mode === 'frames') {
        const frameIndex = clue.frames.indexOf(reference)
        if (frameIndex >= 0) return `${category.name} — ${clue.value} points — frame ${frameIndex + 1}`
      } else if (clue.mode === 'zoom' && clue.image === reference) {
        return `${category.name} — ${clue.value} points — zoom image`
      } else if (clue.mode === 'audio' && clue.audio === reference) {
        return `${category.name} — ${clue.value} points — sound clip`
      }
    }
  }
  return 'Recovered media'
}

async function refreshMediaSources(): Promise<void> {
  try {
    const [imageAssets, audioAssets] = await Promise.all([listMediaAssets(), listAudioAssets()])
    const available = new Set([...imageAssets, ...audioAssets].map((asset) => asset.reference))
    const references = [...new Set(collectMediaReferences(categories.value).filter(isMediaAssetReference))]
    const missing: string[] = []
    let migrated = false

    for (const reference of references) {
      if (available.has(reference)) continue
      try {
        const blob = await readMediaAsset(reference)
        if (!blob) {
          missing.push(reference)
          continue
        }
        const replacement = blob.type.toLowerCase().startsWith('audio/')
          ? await storeAudioAsset(blob, legacyMediaName(reference))
          : await storeMediaAsset(blob, legacyMediaName(reference))
        replaceMediaReference(reference, replacement)
        available.add(replacement)
        migrated = true
      } catch {
        missing.push(reference)
      }
    }

    const [savedImages, savedAudio] = await Promise.all([listMediaAssets(), listAudioAssets()])
    mediaLibrary.value = savedImages
    audioLibrary.value = savedAudio
    const errors: string[] = []
    if (missing.length) {
      errors.push(`${missing.length} older uploaded media file${missing.length === 1 ? '' : 's'} could not be moved to this server. Import a full config export or upload replacements.`)
    }
    if (migrated && !persistConfiguration()) {
      errors.push('Media files were moved to the server, but the updated clue references could not be saved in this browser. Export the configuration.')
    }
    mediaError.value = errors.join(' ')
  } catch (error) {
    mediaLibrary.value = []
    audioLibrary.value = []
    mediaError.value = error instanceof Error ? error.message : 'Could not load the server media libraries.'
  }
}

function assignExistingMedia(event: Event, frameIndex?: number, mediaType: 'image' | 'audio' = 'image'): void {
  const select = event.currentTarget as HTMLSelectElement
  const reference = select.value
  const selected = configSelectedClue.value
  const category = configCategory.value
  const library = mediaType === 'audio' ? audioLibrary.value : mediaLibrary.value
  if (!reference || !selected?.mode || !category || !library.some((asset) => asset.reference === reference)) return

  const clue = category.clues.find((item) => item.value === selected.value)
  if (!clue || clue.mode !== selected.mode) return

  let description: string
  if (clue.mode === 'frames' && mediaType === 'image') {
    if (frameIndex === undefined || frameIndex < 0 || frameIndex >= clue.frames.length) return
    clue.frames[frameIndex] = reference
    description = `frame ${frameIndex + 1}`
  } else if (clue.mode === 'zoom' && mediaType === 'image' && frameIndex === undefined) {
    clue.image = reference
    description = 'zoom image'
  } else if (clue.mode === 'audio' && mediaType === 'audio' && frameIndex === undefined) {
    clue.audio = reference
    description = 'sound clip'
  } else {
    return
  }

  mediaError.value = ''
  commitConfigurationChange(`Selected a saved ${description} for the ${clue.value}-point clue.`)
}

async function uploadConfigImage(event: Event, frameIndex?: number): Promise<void> {
  const input = event.currentTarget as HTMLInputElement
  const file = input.files?.[0]
  const selected = configSelectedClue.value
  const categoryId = configCategory.value?.id
  if (!file || !selected || !categoryId || !selected.mode) return

  if (!Object.hasOwn(ACCEPTED_IMAGE_TYPES, file.type.toLowerCase())) {
    adminMessage.value = 'Choose a PNG, JPEG, or WebP image.'
    input.value = ''
    return
  }
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    adminMessage.value = 'Images must be 10 MB or smaller.'
    input.value = ''
    return
  }

  try {
    const image = await optimizeUploadedImage(file)
    const storedReference = await storeMediaAsset(image, file.name)

    const category = categories.value.find((item) => item.id === categoryId)
    const clue = category?.clues.find((item) => item.value === selected.value)
    if (!clue || clue.mode !== selected.mode) throw new Error('The selected clue changed before the upload finished. Try again.')

    let description: string
    if (clue.mode === 'frames') {
      if (frameIndex === undefined || frameIndex < 0 || frameIndex >= clue.frames.length) {
        throw new Error('Could not find that movie frame slot.')
      }
      clue.frames[frameIndex] = storedReference
      description = `frame ${frameIndex + 1}`
    } else if (clue.mode === 'zoom' && frameIndex === undefined) {
      clue.image = storedReference
      description = 'zoom image'
    } else {
      throw new Error('This clue does not have a matching image slot.')
    }

    mediaError.value = ''
    commitConfigurationChange(`Uploaded ${description} for the ${clue.value}-point clue. It is now available in the saved image library.`)
    await refreshMediaSources()
  } catch (error) {
    adminMessage.value = error instanceof Error ? error.message : 'Could not upload that image.'
  } finally {
    input.value = ''
  }
}

async function uploadConfigAudio(event: Event): Promise<void> {
  const input = event.currentTarget as HTMLInputElement
  const file = input.files?.[0]
  const selected = configSelectedClue.value
  const categoryId = configCategory.value?.id
  if (!file || !selected || selected.mode !== 'audio' || !categoryId) return

  if (!Object.hasOwn(ACCEPTED_AUDIO_TYPES, file.type.toLowerCase())) {
    adminMessage.value = 'Choose an MP3, WAV, or OGG sound file.'
    input.value = ''
    return
  }
  if (file.size > MAX_AUDIO_UPLOAD_BYTES) {
    adminMessage.value = 'Sound files must be 10 MB or smaller.'
    input.value = ''
    return
  }

  try {
    const storedReference = await storeAudioAsset(file, file.name)
    const category = categories.value.find((item) => item.id === categoryId)
    const clue = category?.clues.find((item) => item.value === selected.value)
    if (!clue || clue.mode !== 'audio') throw new Error('The selected clue changed before the upload finished. Try again.')

    clue.audio = storedReference
    mediaError.value = ''
    commitConfigurationChange(`Uploaded a sound clip for the ${clue.value}-point clue. It is now available in the saved audio library.`)
    await refreshMediaSources()
  } catch (error) {
    adminMessage.value = error instanceof Error ? error.message : 'Could not upload that sound file.'
  } finally {
    input.value = ''
  }
}

async function optimizeUploadedImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not prepare this image in the browser.')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Could not encode this image as WebP.'))
      }, 'image/webp', 0.84)
    })
  } finally {
    bitmap.close()
  }
}

async function storeEmbeddedMedia(configuration: GameConfig): Promise<GameConfig> {
  for (const category of configuration.categories) {
    for (const clue of category.clues) {
      if (clue.mode === 'frames') {
        for (let index = 0; index < clue.frames.length; index += 1) {
          const source = clue.frames[index]
          if (source && isEmbeddedImageReference(source)) clue.frames[index] = await storeEmbeddedImage(source)
        }
      } else if (clue.mode === 'zoom' && isEmbeddedImageReference(clue.image)) {
        clue.image = await storeEmbeddedImage(clue.image)
      } else if (clue.mode === 'audio' && isEmbeddedAudioReference(clue.audio)) {
        clue.audio = await storeEmbeddedAudio(clue.audio)
      }
    }
  }
  return parseGameConfig(configuration)
}


function persistGame(): void {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({
      teams: teams.value,
      activeTeamIndex: activeTeamIndex.value,
      played: played.value,
    }))
  } catch {
    // The game remains playable when browser storage is unavailable.
  }
}

function persistConfiguration(): boolean {
  try {
    window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify({ version: 1, categories: categories.value }))
    return true
  } catch {
    return false
  }
}

function prunePlayedClues(): void {
  const validKeys = new Set<string>()
  for (const category of categories.value) {
    for (const clue of category.clues) validKeys.add(clueKey(category, clue))
  }

  const remainingPlayed: Record<string, PlayedStatus> = {}
  for (const [key, status] of Object.entries(played.value)) {
    if (validKeys.has(key)) remainingPlayed[key] = status
  }
  played.value = remainingPlayed
}

function isSavedTeam(value: unknown): value is Team {
  if (typeof value !== 'object' || value === null) return false
  const team = value as Record<string, unknown>
  return typeof team.name === 'string'
    && team.name.trim().length > 0
    && team.name.length <= 32
    && Number.isSafeInteger(team.score)
}

function isSavedTeamList(value: unknown): value is Team[] {
  return Array.isArray(value) && value.length > 0 && value.every(isSavedTeam)
}

function isLegacyScoreList(value: unknown): value is number[] {
  return Array.isArray(value)
    && value.length === defaultTeams.length
    && value.every(Number.isSafeInteger)
}

function restoreGame(): void {
  try {
    const currentSave = window.localStorage.getItem(SAVE_KEY)
    const legacySave = currentSave ? null : window.localStorage.getItem(LEGACY_SAVE_KEY)
    const raw = currentSave ?? legacySave
    if (!raw) return

    const saved = JSON.parse(raw) as Record<string, unknown>
    const legacyScores = saved.scores
    const restoredTeams = isSavedTeamList(saved.teams)
      ? saved.teams.map((team) => ({ ...team }))
      : isLegacyScoreList(legacyScores)
        ? defaultTeams.map((team, index) => ({ ...team, score: legacyScores[index] }))
        : null
    const savedActiveTeam = saved.activeTeamIndex
    const savedPlayed = saved.played
    if (
      !restoredTeams
      || typeof savedActiveTeam !== 'number'
      || !Number.isInteger(savedActiveTeam)
      || savedActiveTeam < 0
      || savedActiveTeam >= restoredTeams.length
      || typeof savedPlayed !== 'object'
      || savedPlayed === null
      || Array.isArray(savedPlayed)
    ) return

    teams.value = restoredTeams
    activeTeamIndex.value = savedActiveTeam

    const restoredPlayed: Record<string, PlayedStatus> = {}
    for (const category of categories.value) {
      for (const clue of category.clues) {
        const key = clueKey(category, clue)
        const status = (savedPlayed as Record<string, unknown>)[key]
        if (status === 'correct' || status === 'missed') restoredPlayed[key] = status
      }
    }
    played.value = restoredPlayed
    if (legacySave) persistGame()
  } catch {
    // Ignore malformed or inaccessible saved data and start a fresh game.
  }
}

restoreGame()

const currentTeam = computed(() => teams.value[activeTeamIndex.value])

const totalClueCount = computed(() => categories.value.reduce((total, category) => total + category.clues.length, 0))
const configCategory = computed(() => categories.value.find((item) => item.id === configCategoryId.value) ?? null)
const configSelectedClue = computed(() => {
  const category = configCategory.value
  return category ? category.clues[configClueIndex.value] ?? null : null
})
const adminSelectedClue = computed(() => {
  const category = categories.value.find((item) => item.id === adminCategoryId.value)
  const clue = category?.clues.find((item) => String(item.value) === adminClueValue.value)
  return category && clue ? { category, clue } : null
})
const adminSelectedCluePlayed = computed(() => {
  const selected = adminSelectedClue.value
  return selected ? isPlayed(selected.category, selected.clue) : false
})
const currentSpecialReward = computed(() => {
  const clue = selectedClue.value?.clue
  if (!clue?.mode) return 0
  return Math.max(0, clue.value - (revealStage.value - 1) * SPECIAL_REVEAL_PENALTY)
})
const currentZoomScale = computed(() => specialOutcome.value || reviewMode.value ? 1 : [4.5, 3.3, 2.4, 1.6, 1][revealStage.value - 1] ?? 1)
const frameViewerCount = computed(() => {
  const clue = selectedClue.value?.clue
  if (clue?.mode !== 'frames') return 0
  return reviewMode.value || specialOutcome.value ? clue.frames.length : revealStage.value
})
const remainingClues = computed(() => categories.value.reduce(
  (count, category) => count + category.clues.filter((clue) => !played.value[clueKey(category, clue)]).length,
  0,
))

function clueKey(category: Category, clue: Clue): string {
  return `${category.id}-${clue.value}`
}

function isPlayed(category: Category, clue: Clue): boolean {
  return Boolean(played.value[clueKey(category, clue)])
}

function selectTeam(index: number): void {
  activeTeamIndex.value = index
  persistGame()
}

function loadAdminTeam(index: number): void {
  const team = teams.value[index]
  if (!team) return
  adminTeamIndex.value = index
  adminTeamName.value = team.name
  adminTeamScore.value = String(team.score)
  adminMessage.value = ''
}

function prepareAdminPage(): void {
  loadAdminTeam(activeTeamIndex.value)
  adminPoints.value = '100'
  newTeamName.value = ''
  const firstCategory = categories.value[0]
  const editorCategory = categories.value.find((category) => category.id === configCategoryId.value) ?? firstCategory
  if (editorCategory) loadConfigCategory(editorCategory.id)
  adminMessage.value = ''
  adminSection.value = 'teams'
}

function openAdminPage(): void {
  if (!isAdminPage.value) {
    adminReturnPath.value = window.location.pathname.replace(/\/+$/, '') || '/'
    window.history.pushState({ view: 'admin' }, '', '/admin')
  }
  prepareAdminPage()
  isAdminPage.value = true
  window.scrollTo(0, 0)
}

function closeAdminPage(): void {
  if (!isAdminPage.value) return
  window.history.replaceState({}, '', adminReturnPath.value || '/')
  isAdminPage.value = false
  window.scrollTo(0, 0)
}

function syncAdminRoute(): void {
  const nextAdminPage = window.location.pathname.replace(/\/+$/, '') === '/admin'
  if (nextAdminPage && !isAdminPage.value) prepareAdminPage()
  isAdminPage.value = nextAdminPage
}

function selectAdminTeam(): void {
  loadAdminTeam(adminTeamIndex.value)
}

function saveAdminTeam(): void {
  const team = teams.value[adminTeamIndex.value]
  const name = adminTeamName.value.trim()
  const rawScore = String(adminTeamScore.value).trim()
  const score = Number(rawScore)
  if (!team) {
    adminMessage.value = 'Choose a team first.'
    return
  }
  if (!name) {
    adminMessage.value = 'Enter a team name.'
    return
  }
  if (name.length > 32) {
    adminMessage.value = 'Team names must be 32 characters or fewer.'
    return
  }
  if (teams.value.some((candidate, index) => index !== adminTeamIndex.value && candidate.name.toLowerCase() === name.toLowerCase())) {
    adminMessage.value = 'That team name is already in use.'
    return
  }
  if (!rawScore || !Number.isSafeInteger(score)) {
    adminMessage.value = 'Enter a whole-number score.'
    return
  }

  team.name = name
  team.score = score
  adminTeamName.value = name
  adminTeamScore.value = String(score)
  persistGame()
  adminMessage.value = `Saved ${name} with ${score.toLocaleString()} points.`
}

function addAdminTeam(): void {
  const name = newTeamName.value.trim()
  if (!name) {
    adminMessage.value = 'Enter a team name.'
    return
  }
  if (name.length > 32) {
    adminMessage.value = 'Team names must be 32 characters or fewer.'
    return
  }
  if (teams.value.some((team) => team.name.toLowerCase() === name.toLowerCase())) {
    adminMessage.value = 'That team name is already in use.'
    return
  }

  teams.value.push({ name, score: 0 })
  newTeamName.value = ''
  loadAdminTeam(teams.value.length - 1)
  persistGame()
  adminMessage.value = `Added ${name}.`
}

function removeAdminTeam(): void {
  const team = teams.value[adminTeamIndex.value]
  if (!team) {
    adminMessage.value = 'Choose a team first.'
    return
  }
  if (teams.value.length <= 1) {
    adminMessage.value = 'At least one team must remain.'
    return
  }
  if (!window.confirm(`Remove ${team.name} and its score?`)) return

  const removedIndex = adminTeamIndex.value
  teams.value.splice(removedIndex, 1)
  if (activeTeamIndex.value > removedIndex) activeTeamIndex.value -= 1
  else if (activeTeamIndex.value === removedIndex) activeTeamIndex.value = Math.min(removedIndex, teams.value.length - 1)
  loadAdminTeam(Math.min(removedIndex, teams.value.length - 1))
  persistGame()
  adminMessage.value = `Removed ${team.name}.`
}

function adjustTeamScore(direction: 1 | -1): void {
  const team = teams.value[adminTeamIndex.value]
  const points = Number(adminPoints.value)
  if (!team) {
    adminMessage.value = 'Choose a team first.'
    return
  }
  if (!Number.isSafeInteger(points) || points <= 0) {
    adminMessage.value = 'Enter a positive whole number of points.'
    return
  }

  const updatedScore = team.score + direction * points
  if (!Number.isSafeInteger(updatedScore)) {
    adminMessage.value = 'That adjustment is too large.'
    return
  }

  team.score = updatedScore
  adminTeamScore.value = String(updatedScore)
  persistGame()
  adminMessage.value = `${direction === 1 ? 'Added' : 'Subtracted'} ${points} points ${direction === 1 ? 'to' : 'from'} ${team.name}. New score: ${updatedScore}.`
}

function selectAdminCategory(): void {
  const category = categories.value.find((item) => item.id === adminCategoryId.value)
  adminClueValue.value = String(category?.clues[0]?.value ?? '')
  adminMessage.value = ''
}

function reenableSelectedClue(): void {
  const selected = adminSelectedClue.value
  if (!selected || !isPlayed(selected.category, selected.clue)) return

  const key = clueKey(selected.category, selected.clue)
  const updatedPlayed = { ...played.value }
  delete updatedPlayed[key]
  played.value = updatedPlayed
  persistGame()
  adminMessage.value = `Re-enabled ${selected.category.name} for ${selected.clue.value} points.`
}

function reenableAllClues(): void {
  const playedCount = Object.keys(played.value).length
  if (!playedCount) {
    adminMessage.value = 'All clues are already available.'
    return
  }
  if (!window.confirm(`Re-enable all ${playedCount} played clues?`)) return

  played.value = {}
  persistGame()
  adminMessage.value = `Re-enabled all ${playedCount} played clues.`
}

function commitConfigurationChange(message: string): void {
  prunePlayedClues()
  const saved = persistConfiguration()
  persistGame()
  adminMessage.value = saved
    ? message
    : `${message} Export the configuration to keep a copy; browser storage was unavailable.`
}

function nextAvailableClueValue(category: Category): number {
  const usedValues = new Set(category.clues.map((clue) => clue.value))
  let value = 100
  while (usedValues.has(value)) value += 100
  return value
}

function loadConfigCategory(id: string): void {
  const category = categories.value.find((item) => item.id === id)
  if (!category) return
  configCategoryId.value = category.id
  configCategoryName.value = category.name
  configCategoryIcon.value = category.icon
  adminCategoryId.value = category.id
  loadConfigClue(category.clues.length ? 0 : -1)
  adminMessage.value = ''
}

function loadConfigClue(index: number): void {
  const category = configCategory.value
  if (!category) return
  const clue = category.clues[index]
  configClueIndex.value = clue ? index : -1
  configClueValue.value = String(clue?.value ?? nextAvailableClueValue(category))
  configCluePrompt.value = clue?.prompt ?? ''
  configClueAnswer.value = clue?.answer ?? ''
  configAcceptedAnswers.value = clue?.mode === 'zoom' ? clue.acceptedAnswers.join('\n') : ''
  configClueMode.value = clue?.mode ?? 'standard'
  adminClueValue.value = String(clue?.value ?? category.clues[0]?.value ?? '')
}

function selectConfigCategory(): void {
  loadConfigCategory(configCategoryId.value)
}

function selectConfigClue(): void {
  loadConfigClue(configClueIndex.value)
}

function saveConfigCategory(): void {
  const category = configCategory.value
  const name = configCategoryName.value.trim()
  const icon = configCategoryIcon.value.trim()
  if (!category) {
    adminMessage.value = 'Choose a category first.'
    return
  }
  if (!name || name.length > 48) {
    adminMessage.value = 'Category names must contain 1–48 characters.'
    return
  }
  if (!icon || icon.length > 16) {
    adminMessage.value = 'Enter a category icon of 1–16 characters.'
    return
  }
  if (categories.value.some((item) => item.id !== category.id && item.name.toLowerCase() === name.toLowerCase())) {
    adminMessage.value = 'That category name is already in use.'
    return
  }

  category.name = name
  category.icon = icon
  commitConfigurationChange(`Saved category “${name}”.`)
}

function createCategoryId(name: string): string {
  const base = name.toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'category'
  let id = base
  let suffix = 2
  while (categories.value.some((category) => category.id === id)) {
    id = `${base}-${suffix}`
    suffix += 1
  }
  return id
}

function addConfigCategory(): void {
  const name = newCategoryName.value.trim()
  const icon = newCategoryIcon.value.trim()
  if (!name || name.length > 48) {
    adminMessage.value = 'Category names must contain 1–48 characters.'
    return
  }
  if (!icon || icon.length > 16) {
    adminMessage.value = 'Enter a category icon of 1–16 characters.'
    return
  }
  if (categories.value.some((category) => category.name.toLowerCase() === name.toLowerCase())) {
    adminMessage.value = 'That category name is already in use.'
    return
  }

  const category: Category = { id: createCategoryId(name), name, icon, clues: [] }
  categories.value.push(category)
  newCategoryName.value = ''
  newCategoryIcon.value = '👻'
  loadConfigCategory(category.id)
  commitConfigurationChange(`Added category “${name}”. Add clues before starting that column.`)
}

function removeConfigCategory(): void {
  const category = configCategory.value
  if (!category) return
  if (categories.value.length <= 1) {
    adminMessage.value = 'At least one category must remain.'
    return
  }
  if (!window.confirm(`Remove “${category.name}” and all of its clues?`)) return

  const index = categories.value.findIndex((item) => item.id === category.id)
  categories.value.splice(index, 1)
  loadConfigCategory(categories.value[Math.min(index, categories.value.length - 1)]!.id)
  commitConfigurationChange(`Removed category “${category.name}”.`)
}

function moveConfigCategory(direction: -1 | 1): void {
  const index = categories.value.findIndex((category) => category.id === configCategoryId.value)
  const targetIndex = index + direction
  if (index < 0 || targetIndex < 0 || targetIndex >= categories.value.length) return
  const [category] = categories.value.splice(index, 1)
  if (!category) return
  categories.value.splice(targetIndex, 0, category)
  commitConfigurationChange(`Moved “${category.name}” ${direction < 0 ? 'earlier' : 'later'}.`)
}

function startNewConfigClue(): void {
  const category = configCategory.value
  if (!category) return
  configClueIndex.value = -1
  configClueValue.value = String(nextAvailableClueValue(category))
  configCluePrompt.value = ''
  configClueAnswer.value = ''
  configClueMode.value = 'standard'
  configAcceptedAnswers.value = ''
  adminMessage.value = ''
}

function saveConfigClue(): void {
  const category = configCategory.value
  const rawValue = String(configClueValue.value).trim()
  const value = Number(rawValue)
  const prompt = configCluePrompt.value.trim()
  const answer = configClueAnswer.value.trim()
  const acceptedAnswers = configAcceptedAnswers.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
  if (!category) {
    adminMessage.value = 'Choose a category first.'
    return
  }
  if (!rawValue || !Number.isSafeInteger(value) || value <= 0) {
    adminMessage.value = 'Clue values must be positive whole numbers.'
    return
  }
  if (!prompt || prompt.length > 2000) {
    adminMessage.value = 'Clue prompts must contain 1–2,000 characters.'
    return
  }
  if (!answer || answer.length > 1000) {
    adminMessage.value = 'Clue answers must contain 1–1,000 characters.'
    return
  }
  if (configClueMode.value === 'zoom' && acceptedAnswers.some((item) => item.length > 200)) {
    adminMessage.value = 'Each accepted-answer variant must be 200 characters or fewer.'
    return
  }
  if (category.clues.some((clue, index) => index !== configClueIndex.value && clue.value === value)) {
    adminMessage.value = `A ${value}-point clue already exists in this category.`
    return
  }

  const existing = configClueIndex.value >= 0 ? category.clues[configClueIndex.value] : undefined
  if (configClueIndex.value >= 0 && !existing) return

  let updatedClue: Clue
  if (configClueMode.value === 'frames') {
    const frames = existing?.mode === 'frames'
      ? [...existing.frames]
      : Array.from({ length: SPECIAL_REVEAL_COUNT }, (_, index) => `/mini-games/uploads/frame-${index + 1}.webp`)
    updatedClue = { value, prompt, answer, mode: 'frames', frames }
  } else if (configClueMode.value === 'zoom') {
    const image = existing?.mode === 'zoom' ? existing.image : '/mini-games/uploads/zoom.webp'
    updatedClue = { value, prompt, answer, mode: 'zoom', acceptedAnswers, image }
  } else if (configClueMode.value === 'audio') {
    const audio = existing?.mode === 'audio' ? existing.audio : '/mini-games/uploads/sound.mp3'
    updatedClue = { value, prompt, answer, mode: 'audio', audio }
  } else {
    updatedClue = { value, prompt, answer }
  }

  if (existing) category.clues[configClueIndex.value] = updatedClue
  else category.clues.push(updatedClue)
  category.clues.sort((left, right) => left.value - right.value)
  const savedIndex = category.clues.findIndex((clue) => clue.value === value)
  loadConfigClue(savedIndex)
  commitConfigurationChange(`Saved the ${value}-point clue in “${category.name}”.`)
}

function removeConfigClue(): void {
  const category = configCategory.value
  const clue = configSelectedClue.value
  if (!category || !clue || configClueIndex.value < 0) return
  if (!window.confirm(`Remove the ${clue.value}-point clue from “${category.name}”?`)) return

  const removedValue = clue.value
  category.clues.splice(configClueIndex.value, 1)
  loadConfigClue(Math.min(configClueIndex.value, category.clues.length - 1))
  commitConfigurationChange(`Removed the ${removedValue}-point clue from “${category.name}”.`)
}


async function exportConfiguration(): Promise<void> {
  try {
    const configuration = parseGameConfig({ version: 1, categories: categories.value })
    for (const category of configuration.categories) {
      for (const clue of category.clues) {
        if (clue.mode === 'frames') {
          for (let index = 0; index < clue.frames.length; index += 1) {
            const reference = clue.frames[index]
            if (reference && isMediaAssetReference(reference)) {
              clue.frames[index] = await mediaAssetAsDataUrl(reference)
            }
          }
        } else if (clue.mode === 'zoom' && isMediaAssetReference(clue.image)) {
          clue.image = await mediaAssetAsDataUrl(clue.image)
        } else if (clue.mode === 'audio' && isMediaAssetReference(clue.audio)) {
          clue.audio = await mediaAssetAsDataUrl(clue.audio)
        }
      }
    }

    const exportable = parseGameConfig(configuration)
    const blob = new Blob([`${JSON.stringify(exportable, null, 2)}\n`], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const download = document.createElement('a')
    download.href = url
    download.download = 'halloween-jeopardy-config.json'
    document.body.append(download)
    download.click()
    download.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    adminMessage.value = 'Exported the board configuration with uploaded images and sounds embedded as JSON.'
  } catch (error) {
    adminMessage.value = error instanceof Error ? error.message : 'Could not export this configuration.'
  }
}

function requestConfigImport(): void {
  configFileInputRef.value?.click()
}

async function importConfiguration(event: Event): Promise<void> {
  const input = event.currentTarget as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const configuration = parseGameConfig(JSON.parse(await file.text()))
    if (!window.confirm('Replace the current categories and clues? Team names and scores stay; all clues will be re-enabled.')) return

    const imported = await storeEmbeddedMedia(configuration)
    categories.value = imported.categories
    played.value = {}
    const firstCategory = categories.value[0]
    if (firstCategory) {
      loadConfigCategory(firstCategory.id)
      adminCategoryId.value = firstCategory.id
      adminClueValue.value = String(firstCategory.clues[0]?.value ?? '')
    }
    await refreshMediaSources()
    const saved = persistConfiguration()
    persistGame()
    adminMessage.value = saved
      ? `Imported ${categories.value.length} categories and ${totalClueCount.value} clues. Team scores were kept.`
      : 'Imported the board, but browser storage was unavailable. Export the configuration to keep a copy.'
  } catch (error) {
    adminMessage.value = error instanceof Error ? error.message : 'Could not import that configuration.'
  } finally {
    input.value = ''
  }
}


function openClue(category: Category, clue: Clue): void {
  const status = played.value[clueKey(category, clue)]
  selectedFrameIndex.value = 0
  selectedClue.value = { category, clue }
  reviewMode.value = Boolean(status)
  showAnswer.value = reviewMode.value
  revealStage.value = reviewMode.value ? SPECIAL_REVEAL_COUNT : 1
  specialGuess.value = ''
  specialFeedback.value = ''
  specialOutcome.value = null
}

function closeClue(): void {
  if (frameViewerDialogRef.value?.open) frameViewerDialogRef.value.close()
  selectedClue.value = null
  showAnswer.value = false
  reviewMode.value = false
  revealStage.value = 1
  specialGuess.value = ''
  specialFeedback.value = ''
  specialOutcome.value = null
}

function openFrameViewer(index: number): void {
  const clue = selectedClue.value?.clue
  if (clue?.mode !== 'frames' || index < 0 || index >= frameViewerCount.value) return
  selectedFrameIndex.value = index
  frameViewerDialogRef.value?.showModal()
}

function openCostumeViewer(): void {
  if (selectedClue.value?.clue.mode !== 'zoom') return
  frameViewerDialogRef.value?.showModal()
}

function stepFrame(direction: -1 | 1): void {
  const clue = selectedClue.value?.clue
  const frameCount = frameViewerCount.value
  if (clue?.mode !== 'frames' || frameCount < 2) return
  selectedFrameIndex.value = (selectedFrameIndex.value + direction + frameCount) % frameCount
}

function closeFrameViewer(): void {
  if (frameViewerDialogRef.value?.open) frameViewerDialogRef.value.close()
}

function onFrameViewerClose(): void {
  selectedFrameIndex.value = 0
}

function normalizeAnswer(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '')
}

function finishSpecial(correct: boolean): void {
  const selected = selectedClue.value
  if (!selected || (selected.clue.mode !== 'frames' && selected.clue.mode !== 'zoom') || specialOutcome.value || isPlayed(selected.category, selected.clue)) return

  const key = clueKey(selected.category, selected.clue)
  const awarded = correct ? currentSpecialReward.value : 0
  teams.value[activeTeamIndex.value].score += awarded
  played.value = { ...played.value, [key]: correct ? 'correct' : 'missed' }
  specialOutcome.value = correct ? 'correct' : 'missed'
  specialFeedback.value = correct
    ? `Correct! ${currentTeam.value.name} earns ${awarded} points.`
    : `No more reveals. The answer was ${selected.clue.answer}.`
  persistGame()
}

function judgeFrameAnswer(correct: boolean): void {
  const selected = selectedClue.value
  if (!selected || selected.clue.mode !== 'frames' || specialOutcome.value || reviewMode.value || isPlayed(selected.category, selected.clue)) return

  if (correct) {
    finishSpecial(true)
    return
  }

  if (revealStage.value < SPECIAL_REVEAL_COUNT) {
    revealStage.value += 1
    specialFeedback.value = `Incorrect. Frame ${revealStage.value} revealed. Potential score: ${currentSpecialReward.value}.`
    return
  }

  finishSpecial(false)
}

function submitSpecialGuess(): void {
  const selected = selectedClue.value
  if (!selected || selected.clue.mode !== 'zoom' || specialOutcome.value) return

  const guess = normalizeAnswer(specialGuess.value)
  if (!guess) {
    specialFeedback.value = 'Enter a guess first.'
    return
  }

  const acceptedAnswers = [selected.clue.answer, ...selected.clue.acceptedAnswers]
  if (acceptedAnswers.some((answer) => normalizeAnswer(answer) === guess)) {
    finishSpecial(true)
    return
  }

  specialGuess.value = ''
  if (revealStage.value < SPECIAL_REVEAL_COUNT) {
    revealStage.value += 1
    specialFeedback.value = `Not quite. The next reveal costs ${SPECIAL_REVEAL_PENALTY} points. Potential score: ${currentSpecialReward.value}.`
    return
  }

  finishSpecial(false)
}

function scoreClue(correct: boolean): void {
  const selected = selectedClue.value
  if (!selected || (selected.clue.mode !== undefined && selected.clue.mode !== 'audio') || isPlayed(selected.category, selected.clue)) return
  const key = clueKey(selected.category, selected.clue)
  teams.value[activeTeamIndex.value].score += correct ? selected.clue.value : -selected.clue.value
  played.value = { ...played.value, [key]: correct ? 'correct' : 'missed' }
  persistGame()
  closeClue()
}

function onDialogClose(): void {
  if (selectedClue.value) closeClue()
}

function resetGame(): void {
  if (!window.confirm('Start a fresh game? Scores and played clues will be cleared.')) return
  teams.value.forEach((team) => { team.score = 0 })
  played.value = {}
  activeTeamIndex.value = 0
  persistGame()
  closeClue()
}

watch(selectedClue, (selected) => {
  const dialog = dialogRef.value
  if (!dialog) return
  if (selected && !dialog.open) dialog.showModal()
  if (!selected && dialog.open) dialog.close()
})
</script>

<template>
  <div v-if="!isAdminPage" class="skeleton-backdrop" aria-hidden="true">
    <video
      v-if="!prefersReducedMotion"
      ref="sceneMediaRef"
      class="skeleton-scene"
      autoplay
      muted
      loop
      playsinline
      preload="auto"
      poster="/skeleton-rave.webp"
      @click="toggleSceneFullscreen"
    >
      <source src="/skeleton-rave-loop.mp4" type="video/mp4" />
    </video>
    <img
      v-else
      ref="sceneMediaRef"
      class="skeleton-scene"
      src="/skeleton-rave.webp"
      alt=""
      draggable="false"
      @click="toggleSceneFullscreen"
    />
  </div>

  <main class="app-shell" :class="{ 'app-shell-admin': isAdminPage }">
    <header class="topbar">
      <a class="wordmark" href="#top" aria-label="Midnight Quiz Club home">
        <span class="wordmark-icon" aria-hidden="true">✦</span>
        <span>MIDNIGHT <b>QUIZ CLUB</b></span>
      </a>
      <button
        class="fullscreen-toggle"
        type="button"
        :aria-label="isSceneFullscreen ? 'Exit fullscreen skeleton scene' : 'View skeleton scene fullscreen'"
        :aria-pressed="isSceneFullscreen"
        title="Toggle fullscreen skeleton scene"
        @click="toggleSceneFullscreen"
      >
        <span aria-hidden="true">{{ isSceneFullscreen ? '⤢' : '⛶' }}</span>
      </button>
      <div class="game-status"><span class="status-dot" aria-hidden="true"></span> GAME NIGHT</div>
    </header>
    <p v-if="fullscreenError" class="fullscreen-error" role="status">{{ fullscreenError }}</p>

    <section id="top" class="hero" aria-labelledby="game-title">
      <div class="hero-copy">
        <p class="eyebrow"><span class="eyebrow-line"></span> Gather your ghouls &amp; test your wits</p>
        <h1 id="game-title">Halloween <span>Jeopardy</span></h1>
        <p class="hero-description">{{ categories.length }} categories. {{ totalClueCount }} clues. Get ready to rattle a few bones.</p>
      </div>
    </section>

    <section class="score-section" aria-labelledby="score-heading">
      <div class="section-heading">
        <div class="section-title-group">
          <span class="section-number">01</span>
          <h2 id="score-heading">Choose your team</h2>
        </div>
      </div>
      <div class="score-toolbar">
        <p class="turn-hint"><span class="turn-pip" aria-hidden="true"></span> Tap a team to set the active turn</p>
      </div>
      <div class="team-picker">
        <button
          v-for="(team, index) in teams"
          :key="team.name"
          class="team-card"
          :class="{ 'team-card-active': activeTeamIndex === index }"
          type="button"
          :aria-pressed="activeTeamIndex === index"
          @click="selectTeam(index)"
        >
          <span class="team-emblem" aria-hidden="true">{{ index === 0 ? '☾' : '✦' }}</span>
          <span class="team-details">
            <span class="team-name">{{ team.name }}</span>
            <span class="team-score-label">{{ team.score.toLocaleString() }} points</span>
          </span>
          <span v-if="activeTeamIndex === index" class="active-badge">YOUR TURN</span>
          <span v-else class="team-score">{{ team.score }}</span>
        </button>
      </div>
    </section>

    <section class="board-section" aria-labelledby="board-heading">
      <div class="section-heading board-section-heading">
        <div class="section-title-group">
          <span class="section-number">02</span>
          <h2 id="board-heading">Pick a clue</h2>
        </div>
        <p class="clue-counter"><strong>{{ remainingClues }}</strong> clues left</p>
      </div>
      <p class="board-instruction">It’s <strong>{{ currentTeam.name }}</strong>’s turn. Choose a point value to reveal a clue.</p>

      <div class="board-scroll" role="region" aria-label="Jeopardy game board" tabindex="0">
        <div
          class="game-board"
          :style="{ '--category-count': categories.length, minWidth: `${Math.max(1120, categories.length * 160)}px` }"
        >
          <article v-for="category in categories" :key="category.id" class="category-column" :style="{ '--clue-count': category.clues.length }">
            <h3 class="category-heading">
              <span class="category-icon" aria-hidden="true">{{ category.icon }}</span>
              <span>{{ category.name }}</span>
            </h3>
            <button
              v-for="clue in category.clues"
              :key="clue.value"
              class="clue-tile"
              :class="{ 'clue-tile-played': isPlayed(category, clue), 'clue-tile-audio': clue.mode === 'audio' }"
              type="button"
              :aria-label="`${category.name}, ${clue.value} points${clue.mode === 'audio' ? ', sound clue' : ''}${isPlayed(category, clue) ? ', already played' : ''}`"
              @click="openClue(category, clue)"
            >
              <span v-if="!isPlayed(category, clue)" :class="{ 'clue-tile-audio-value': clue.mode === 'audio' }">
                <span v-if="clue.mode === 'audio'" class="clue-tile-audio-label" aria-hidden="true">SOUND</span>
                {{ clue.value }}
              </span>
              <span v-else aria-hidden="true">{{ played[clueKey(category, clue)] === 'correct' ? '✓' : '×' }}</span>
            </button>
          </article>
        </div>
      </div>
      <p class="scroll-hint">On a small screen? Swipe the board sideways <span aria-hidden="true">↔</span></p>
    </section>

    <footer class="footer-bar">
      <div class="footer-note"><span aria-hidden="true">✦</span> Play fair. Keep it spooky.</div>
      <div class="footer-actions">
        <a class="admin-trigger" href="/admin" @click.prevent="openAdminPage">Admin <span aria-hidden="true">⚙</span></a>
        <button class="reset-button" type="button" @click="resetGame">Reset game <span aria-hidden="true">↺</span></button>
      </div>
    </footer>

    <dialog ref="dialogRef" class="clue-dialog" aria-labelledby="clue-title" @click.self="closeClue" @close="onDialogClose">
      <div v-if="selectedClue" class="clue-modal-content">
        <button class="dialog-close" type="button" aria-label="Close clue" @click="closeClue">×</button>
        <div class="modal-category">
          <span aria-hidden="true">{{ selectedClue.category.icon }}</span>
          {{ selectedClue.category.name }}
        </div>
        <p class="modal-value">
          <template v-if="selectedClue.clue.mode && selectedClue.clue.mode !== 'audio'">
            {{ reviewMode ? selectedClue.clue.value : specialOutcome === 'missed' ? 0 : currentSpecialReward }}
            <span>{{ reviewMode ? 'CLUE VALUE' : specialOutcome ? 'POINTS AWARDED' : 'POTENTIAL POINTS' }}</span>
          </template>
          <template v-else>
            {{ selectedClue.clue.value }} <span>{{ reviewMode ? 'CLUE VALUE' : 'POINTS' }}</span>
          </template>
        </p>
        <h2 id="clue-title" class="clue-prompt">{{ selectedClue.clue.prompt }}</h2>

        <div v-if="selectedClue.clue.mode === 'audio'" class="audio-clue-player">
          <span>Listen to the sound</span>
          <audio :src="mediaAssetUrl(selectedClue.clue.audio)" controls preload="metadata" aria-label="Play sound clue">
            Your browser does not support audio playback.
          </audio>
        </div>

        <template v-if="selectedClue.clue.mode === undefined || selectedClue.clue.mode === 'audio'">
          <div v-if="reviewMode" class="review-summary">
            <span>COMPLETED CLUE</span>
            <p>Answer: {{ selectedClue.clue.answer }}</p>
            <small>Marked {{ played[clueKey(selectedClue.category, selectedClue.clue)] === 'correct' ? 'correct' : 'missed' }}.</small>
          </div>
          <template v-else>
            <div class="answer-stage" aria-live="polite">
              <Transition name="answer-reveal">
                <div v-if="showAnswer" class="answer-card">
                  <span class="answer-label">THE ANSWER</span>
                  <p>{{ selectedClue.clue.answer }}</p>
                </div>
              </Transition>
            </div>

            <button v-if="!showAnswer" class="reveal-button" type="button" autofocus @click="showAnswer = true">
              <span aria-hidden="true">✦</span> Reveal answer
            </button>
            <div v-else class="judging-panel">
              <p>Did <strong>{{ currentTeam.name }}</strong> get it?</p>
              <div class="judging-actions">
                <button class="judge-button judge-correct" type="button" @click="scoreClue(true)">
                  <span aria-hidden="true">✓</span> Correct <b>+{{ selectedClue.clue.value }}</b>
                </button>
                <button class="judge-button judge-missed" type="button" @click="scoreClue(false)">
                  <span aria-hidden="true">×</span> Incorrect <b>−{{ selectedClue.clue.value }}</b>
                </button>
              </div>
            </div>
          </template>
        </template>
        <section v-else class="special-clue-content" :class="`special-clue-${selectedClue.clue.mode}`">
          <p v-if="!specialOutcome && !reviewMode" class="special-progress">
            <span>{{ selectedClue.clue.mode === 'frames' ? 'FRAME' : 'ZOOM' }}</span>
            <strong>{{ revealStage }}</strong> / {{ SPECIAL_REVEAL_COUNT }}
            <span class="special-stake">{{ currentSpecialReward }} points at stake</span>
          </p>
          <p v-if="selectedClue.clue.mode === 'frames' && !specialOutcome && !reviewMode" class="special-rules">The host judges each answer. Every incorrect guess reveals the next frame and costs {{ SPECIAL_REVEAL_PENALTY }} points.</p>
          <p v-else-if="selectedClue.clue.mode === 'zoom' && !specialOutcome && !reviewMode" class="special-rules">Every extra reveal costs {{ SPECIAL_REVEAL_PENALTY }} points.</p>
          <p v-else-if="selectedClue.clue.mode === 'frames' && !reviewMode" class="special-rules">Scroll through all five frames below.</p>

          <button
            v-if="selectedClue.clue.mode === 'frames' && !specialOutcome && !reviewMode"
            class="special-media-frame movie-frame movie-frame-button"
            type="button"
            :aria-label="`Enlarge current frame ${revealStage}`"
            @click="openFrameViewer(revealStage - 1)"
          >
            <img :src="imageSource(selectedClue.clue.frames[revealStage - 1])" :alt="`Movie scene clue, frame ${revealStage}`" />
          </button>
          <button
            v-else-if="selectedClue.clue.mode === 'zoom'"
            class="special-media-frame costume-zoom costume-zoom-button"
            type="button"
            aria-label="Enlarge costume image"
            @click="openCostumeViewer"
          >
            <img
              :src="imageSource(selectedClue.clue.image)"
              :style="{ transform: `scale(${currentZoomScale})` }"
              alt="Zoomed-in costume clue"
            />
          </button>

          <div v-if="selectedClue.clue.mode === 'frames' && !specialOutcome && !reviewMode" class="judging-panel">
            <p>Host: was <strong>{{ currentTeam.name }}</strong> correct?</p>
            <div class="judging-actions">
              <button class="judge-button judge-correct" type="button" @click="judgeFrameAnswer(true)">
                <span aria-hidden="true">✓</span> Correct <b>+{{ currentSpecialReward }}</b>
              </button>
              <button class="judge-button judge-missed" type="button" @click="judgeFrameAnswer(false)">
                <span aria-hidden="true">×</span> Incorrect <b>{{ revealStage < SPECIAL_REVEAL_COUNT ? `Next frame · −${SPECIAL_REVEAL_PENALTY}` : 'End clue' }}</b>
              </button>
            </div>
          </div>

          <form v-if="selectedClue.clue.mode === 'zoom' && !specialOutcome && !reviewMode" class="special-guess-form" @submit.prevent="submitSpecialGuess">
            <label for="special-guess">Guess the costume or character</label>
            <div class="special-guess-entry">
              <input
                id="special-guess"
                v-model="specialGuess"
                type="text"
                maxlength="80"
                autocomplete="off"
                placeholder="Name the costume"
                autofocus
              />
              <button class="special-submit-button" type="submit">Guess</button>
            </div>
          </form>
          <p v-if="specialFeedback && !reviewMode" class="special-feedback" role="status" aria-live="polite">{{ specialFeedback }}</p>
          <div v-if="specialOutcome && !reviewMode" class="special-result" :class="`special-result-${specialOutcome}`">
            <span>{{ specialOutcome === 'correct' ? 'MYSTERY SOLVED' : 'OUT OF REVEALS' }}</span>
            <p>Answer: {{ selectedClue.clue.answer }}</p>
            <button class="special-close-button" type="button" @click="closeClue">Back to board</button>
          </div>

          <div v-if="reviewMode" class="review-summary">
            <span>COMPLETED CLUE</span>
            <p>Answer: {{ selectedClue.clue.answer }}</p>
            <small>Marked {{ played[clueKey(selectedClue.category, selectedClue.clue)] === 'correct' ? 'correct' : 'missed' }}.</small>
          </div>

          <div
            v-if="selectedClue.clue.mode === 'frames' && (specialOutcome || reviewMode)"
            class="postgame-frame-strip"
            role="region"
            aria-label="All five movie frames"
            tabindex="0"
          >
            <figure v-for="(frame, index) in selectedClue.clue.frames" :key="frame" class="postgame-frame">
              <button
                class="postgame-frame-button"
                type="button"
                :aria-label="`Open frame ${index + 1} enlarged`"
                @click="openFrameViewer(index)"
              >
                <img :src="imageSource(frame)" :alt="`Frame ${index + 1} from ${selectedClue.clue.answer}`" />
                <span class="postgame-frame-caption">Frame {{ index + 1 }} · Enlarge</span>
              </button>
            </figure>
          </div>
        </section>
      </div>
    </dialog>

    <dialog
      ref="frameViewerDialogRef"
      class="frame-viewer-dialog"
      aria-labelledby="frame-viewer-title"
      @click.self="closeFrameViewer"
      @close="onFrameViewerClose"
      @keydown.left.stop.prevent="stepFrame(-1)"
      @keydown.right.stop.prevent="stepFrame(1)"
    >
      <div v-if="selectedClue && (selectedClue.clue.mode === 'frames' || selectedClue.clue.mode === 'zoom')" class="frame-viewer-content">
        <button class="dialog-close" type="button" aria-label="Close image viewer" autofocus @click="closeFrameViewer">×</button>
        <h2 id="frame-viewer-title" class="frame-viewer-title">
          <template v-if="selectedClue.clue.mode === 'frames'">
            {{ reviewMode || specialOutcome ? selectedClue.clue.answer : `Frame ${selectedFrameIndex + 1}` }}
          </template>
          <template v-else>
            {{ reviewMode || specialOutcome ? selectedClue.clue.answer : `Costume · Reveal ${revealStage} of ${SPECIAL_REVEAL_COUNT}` }}
          </template>
        </h2>
        <div v-if="selectedClue.clue.mode === 'frames'" class="frame-viewer-stage">
          <button v-if="frameViewerCount > 1" class="frame-viewer-nav frame-viewer-nav-previous" type="button" aria-label="Previous frame" @click="stepFrame(-1)">‹</button>
          <img
            :src="imageSource(selectedClue.clue.frames[selectedFrameIndex])"
            :alt="reviewMode || specialOutcome ? `Frame ${selectedFrameIndex + 1} from ${selectedClue.clue.answer}` : `Frame ${selectedFrameIndex + 1}`"
          />
          <button v-if="frameViewerCount > 1" class="frame-viewer-nav frame-viewer-nav-next" type="button" aria-label="Next frame" @click="stepFrame(1)">›</button>
        </div>
        <div v-else class="frame-viewer-costume">
          <img
            :src="imageSource(selectedClue.clue.image)"
            :style="{ transform: `scale(${currentZoomScale})` }"
            :alt="reviewMode || specialOutcome ? `${selectedClue.clue.answer} costume` : `Costume clue at reveal ${revealStage}`"
          />
        </div>
        <p class="frame-viewer-count">
          <template v-if="selectedClue.clue.mode === 'frames'">
            <template v-if="reviewMode || specialOutcome">Frame {{ selectedFrameIndex + 1 }} of {{ frameViewerCount }} · Use arrow keys to browse</template>
            <template v-else>Frame {{ selectedFrameIndex + 1 }} · revealed so far</template>
          </template>
          <template v-else>
            <template v-if="reviewMode || specialOutcome">Full costume</template>
            <template v-else>Current reveal {{ revealStage }} of {{ SPECIAL_REVEAL_COUNT }} · no penalty</template>
          </template>
        </p>
        <div v-if="selectedClue.clue.mode === 'frames' && frameViewerCount > 1" class="frame-viewer-index">
          <button
            v-for="index in frameViewerCount"
            :key="index"
            class="frame-index-button"
            :class="{ 'frame-index-current': selectedFrameIndex === index - 1 }"
            type="button"
            :aria-label="`View frame ${index}`"
            :aria-current="selectedFrameIndex === index - 1 ? 'step' : undefined"
            @click="selectedFrameIndex = index - 1"
          >
            {{ index }}
          </button>
        </div>
      </div>
    </dialog>

    <div v-if="isAdminPage" class="admin-page">
      <div class="admin-page-layout">
        <header class="admin-page-header">
          <div class="admin-page-intro">
            <a class="admin-back-link" href="/" @click.prevent="closeAdminPage">← Back to game</a>
            <span class="admin-eyebrow">GAME HOST</span>
            <h1 id="admin-title">Game administration</h1>
            <p>Manage teams, clue availability, and board content.</p>
          </div>
          <div class="admin-page-stats" role="group" aria-label="Current board summary">
            <div><strong>{{ teams.length }}</strong><span>Teams</span></div>
            <div><strong>{{ remainingClues }} / {{ totalClueCount }}</strong><span>Clues available</span></div>
            <div><strong>{{ categories.length }}</strong><span>Categories</span></div>
          </div>
        </header>

        <nav class="admin-nav" aria-label="Administration sections">
          <button class="admin-nav-item" type="button" :aria-pressed="adminSection === 'teams'" @click="adminSection = 'teams'">
            <span class="admin-nav-index">01</span>
            <span class="admin-nav-label">Teams &amp; scores</span>
            <span class="admin-nav-detail">{{ teams.length }} teams</span>
          </button>
          <button class="admin-nav-item" type="button" :aria-pressed="adminSection === 'clues'" @click="adminSection = 'clues'">
            <span class="admin-nav-index">02</span>
            <span class="admin-nav-label">Clue availability</span>
            <span class="admin-nav-detail">{{ totalClueCount - remainingClues }} played</span>
          </button>
          <button class="admin-nav-item" type="button" :aria-pressed="adminSection === 'content'" @click="adminSection = 'content'">
            <span class="admin-nav-index">03</span>
            <span class="admin-nav-label">Board setup</span>
            <span class="admin-nav-detail">Categories, clues, media</span>
          </button>
        </nav>

        <p v-if="adminMessage" class="admin-message" role="status" aria-live="polite">{{ adminMessage }}</p>

        <div v-if="adminSection === 'teams'" class="admin-page-grid">

        <section class="admin-page-card" aria-labelledby="admin-teams-title">
          <div class="admin-section-heading">
            <h3 id="admin-teams-title">Teams</h3>
            <span>{{ teams.length }} {{ teams.length === 1 ? 'team' : 'teams' }}</span>
          </div>
          <div class="admin-team-editor">
            <label class="admin-field" for="admin-team">
              <span>Choose team</span>
              <select id="admin-team" v-model.number="adminTeamIndex" @change="selectAdminTeam">
                <option v-for="(team, index) in teams" :key="team.name" :value="index">{{ team.name }}</option>
              </select>
            </label>
            <label class="admin-field" for="admin-team-name">
              <span>Team name</span>
              <input id="admin-team-name" v-model="adminTeamName" type="text" maxlength="32" autocomplete="off" @input="adminMessage = ''" />
            </label>
            <label class="admin-field" for="admin-team-score">
              <span>Score</span>
              <input id="admin-team-score" v-model="adminTeamScore" type="number" step="1" inputmode="numeric" @input="adminMessage = ''" />
            </label>
          </div>
          <div class="admin-team-actions">
            <button class="admin-save-button" type="button" @click="saveAdminTeam">Save team changes</button>
            <button class="admin-remove-team-button" type="button" :disabled="teams.length <= 1" @click="removeAdminTeam">Remove team</button>
          </div>
          <p v-if="teams.length <= 1" class="admin-note">At least one team must remain in the game.</p>
          <form class="admin-add-team-form" @submit.prevent="addAdminTeam">
            <label class="admin-field" for="admin-new-team-name">
              <span>Add a team</span>
              <input
                id="admin-new-team-name"
                v-model="newTeamName"
                type="text"
                maxlength="32"
                autocomplete="off"
                placeholder="e.g. The Graveyard Shift"
                @input="adminMessage = ''"
              />
            </label>
            <button class="admin-secondary-button" type="submit">Add team</button>
          </form>
        </section>

        <section class="admin-page-card" aria-labelledby="admin-score-title">
          <div class="admin-section-heading">
            <h3 id="admin-score-title">Quick score adjustment</h3>
            <span>Selected: {{ teams[adminTeamIndex]?.name ?? 'No team' }}</span>
          </div>
          <label class="admin-field admin-points-field" for="admin-points">
            <span>Points to adjust</span>
            <input
              id="admin-points"
              v-model="adminPoints"
              type="number"
              min="1"
              step="1"
              inputmode="numeric"
              @input="adminMessage = ''"
            />
          </label>
          <div class="admin-adjustment-actions">
            <button class="admin-add-button" type="button" @click="adjustTeamScore(1)">＋ Add points</button>
            <button class="admin-subtract-button" type="button" @click="adjustTeamScore(-1)">− Subtract points</button>
          </div>
        </section>

        </div>
        <section v-if="adminSection === 'clues'" class="admin-page-card" aria-labelledby="admin-clues-title">
          <div class="admin-section-heading">
            <h3 id="admin-clues-title">Clue board</h3>
            <span>{{ remainingClues }} available · {{ totalClueCount - remainingClues }} played</span>
          </div>
          <div class="admin-controls">
            <label class="admin-field" for="admin-category">
              <span>Category</span>
              <select id="admin-category" v-model="adminCategoryId" @change="selectAdminCategory">
                <option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }}</option>
              </select>
            </label>
            <label class="admin-field" for="admin-clue">
              <span>Clue value</span>
              <select id="admin-clue" v-model="adminClueValue" @change="adminMessage = ''">
                <option v-for="clue in adminSelectedClue ? adminSelectedClue.category.clues : []" :key="clue.value" :value="String(clue.value)">
                  {{ clue.value }} points
                </option>
              </select>
            </label>
          </div>
          <div v-if="adminSelectedClue" class="admin-clue-details">
            <p><strong>{{ adminSelectedClue.category.name }} · {{ adminSelectedClue.clue.value }} points</strong>{{ adminSelectedClue.clue.prompt }}</p>
            <span :class="adminSelectedCluePlayed ? 'admin-clue-played' : 'admin-clue-available'">
              {{ adminSelectedCluePlayed ? `Played · ${played[clueKey(adminSelectedClue.category, adminSelectedClue.clue)]}` : 'Available' }}
            </span>
          </div>
          <div class="admin-clue-actions">
            <button class="admin-save-button" type="button" :disabled="!adminSelectedCluePlayed" @click="reenableSelectedClue">
              Re-enable selected clue
            </button>
            <button class="admin-secondary-button" type="button" :disabled="remainingClues === totalClueCount" @click="reenableAllClues">
              Re-enable all clues
            </button>
          </div>
        </section>

        <section v-if="adminSection === 'content'" class="admin-page-card" aria-labelledby="admin-config-title">
          <div class="admin-section-heading">
            <h3 id="admin-config-title">Board configuration</h3>
            <span>{{ categories.length }} categories · {{ totalClueCount }} clues</span>
          </div>
          <p class="admin-config-note">Configuration is saved in this browser. Export JSON to back it up or move it to another device; uploaded images and sounds are embedded. Team scores are separate.</p>
          <div class="admin-config-transfer">
            <button class="admin-secondary-button" type="button" @click="exportConfiguration">Export config JSON</button>
            <button class="admin-secondary-button" type="button" @click="requestConfigImport">Import config JSON</button>
            <input
              ref="configFileInputRef"
              class="admin-file-input"
              type="file"
              accept="application/json,.json"
              @change="importConfiguration"
            />
          </div>
          <p class="admin-note">Upload each picture or sound once to the server library, then reuse it in any clue. Config exports embed attached media.</p>

          <div class="admin-config-editor">
            <div class="admin-editor-heading">
              <h4>Categories and clues</h4>
              <p>Edit the board, questions, answers, and clue media here.</p>
            </div>
            <div class="admin-config-editor-body">
              <div class="admin-config-category-fields">
                <label class="admin-field" for="config-category">
                  <span>Category</span>
                  <select id="config-category" v-model="configCategoryId" @change="selectConfigCategory">
                    <option v-for="category in categories" :key="category.id" :value="category.id">{{ category.icon }} {{ category.name }}</option>
                  </select>
                </label>
                <label class="admin-field" for="config-category-name">
                  <span>Category name</span>
                  <input id="config-category-name" v-model="configCategoryName" type="text" maxlength="48" @input="adminMessage = ''" />
                </label>
                <label class="admin-field" for="config-category-icon">
                  <span>Category icon</span>
                  <input id="config-category-icon" v-model="configCategoryIcon" type="text" maxlength="16" @input="adminMessage = ''" />
                </label>
              </div>
              <div class="admin-config-category-actions">
                <button class="admin-save-button" type="button" @click="saveConfigCategory">Save category</button>
                <button
                  class="admin-secondary-button"
                  type="button"
                  :disabled="categories.findIndex((category) => category.id === configCategoryId) <= 0"
                  aria-label="Move category earlier"
                  @click="moveConfigCategory(-1)"
                >↑ Earlier</button>
                <button
                  class="admin-secondary-button"
                  type="button"
                  :disabled="categories.findIndex((category) => category.id === configCategoryId) >= categories.length - 1"
                  aria-label="Move category later"
                  @click="moveConfigCategory(1)"
                >↓ Later</button>
                <button class="admin-remove-team-button" type="button" :disabled="categories.length <= 1" @click="removeConfigCategory">Remove category</button>
              </div>

              <form class="admin-config-add-category-form" @submit.prevent="addConfigCategory">
                <label class="admin-field" for="new-config-category-name">
                  <span>Add category</span>
                  <input id="new-config-category-name" v-model="newCategoryName" type="text" maxlength="48" placeholder="Category name" @input="adminMessage = ''" />
                </label>
                <label class="admin-field" for="new-config-category-icon">
                  <span>Icon</span>
                  <input id="new-config-category-icon" v-model="newCategoryIcon" type="text" maxlength="16" />
                </label>
                <button class="admin-secondary-button" type="submit">Add category</button>
              </form>

              <div v-if="configCategory" class="admin-config-clue-editor">
                <div class="admin-section-heading">
                  <h4>Clues in {{ configCategory.name }}</h4>
                  <button class="admin-secondary-button" type="button" @click="startNewConfigClue">New clue</button>
                </div>
                <label v-if="configCategory.clues.length" class="admin-field" for="config-clue">
                  <span>Select clue to edit</span>
                  <select id="config-clue" v-model.number="configClueIndex" @change="selectConfigClue">
                    <option v-for="(clue, index) in configCategory.clues" :key="clue.value" :value="index">
                      {{ clue.value }} points — {{ clue.prompt.slice(0, 56) }}
                    </option>
                  </select>
                </label>
                <p v-else class="admin-note">This category has no clues yet. Add one below.</p>
                <form class="admin-config-clue-form" @submit.prevent="saveConfigClue">
                  <label class="admin-field" for="config-clue-value">
                    <span>Point value</span>
                    <input id="config-clue-value" v-model="configClueValue" type="number" min="1" step="1" inputmode="numeric" @input="adminMessage = ''" />
                  </label>
                  <label class="admin-field admin-clue-type-field" for="config-clue-mode">
                    <span>Clue type</span>
                    <select id="config-clue-mode" v-model="configClueMode" @change="adminMessage = ''">
                      <option value="standard">Standard question</option>
                      <option value="frames">Movie frames · five images</option>
                      <option value="zoom">Zoomed-in picture</option>
                      <option value="audio">Sound clip</option>
                    </select>
                  </label>
                  <label class="admin-field admin-clue-prompt-field" for="config-clue-prompt">
                    <span>Question / clue</span>
                    <textarea id="config-clue-prompt" v-model="configCluePrompt" rows="3" maxlength="2000" @input="adminMessage = ''"></textarea>
                  </label>
                  <label class="admin-field admin-clue-answer-field" for="config-clue-answer">
                    <span>Answer</span>
                    <textarea id="config-clue-answer" v-model="configClueAnswer" rows="2" maxlength="1000" @input="adminMessage = ''"></textarea>
                  </label>
                  <label v-if="configClueMode === 'zoom'" class="admin-field admin-clue-accepted-answers-field" for="config-clue-accepted-answers">
                    <span>Accepted answers (one per line)</span>
                    <textarea id="config-clue-accepted-answers" v-model="configAcceptedAnswers" rows="2" maxlength="2000" @input="adminMessage = ''"></textarea>
                  </label>
                  <div v-if="configClueMode === 'frames' && configSelectedClue?.mode === 'frames'" class="admin-media-editor admin-media-editor-frames">
                    <label v-for="(frame, index) in configSelectedClue.frames" :key="`frame-${index}`" class="admin-media-slot">
                      <span>Frame {{ index + 1 }}</span>
                      <img :src="imageSource(frame)" :alt="`Preview for movie frame ${index + 1}`" />
                      <select :aria-label="`Choose saved movie frame ${index + 1}`" :value="isMediaAssetReference(frame) ? frame : ''" @change="assignExistingMedia($event, index)">
                        <option value="">Choose a saved image…</option>
                        <option v-for="asset in mediaLibrary" :key="asset.reference" :value="asset.reference">{{ asset.name }}</option>
                      </select>
                      <span class="admin-media-upload-label">Or upload a new image</span>
                      <input type="file" accept="image/png,image/jpeg,image/webp" :aria-label="`Upload movie frame ${index + 1}`" @change="uploadConfigImage($event, index)" />
                    </label>
                  </div>
                  <label v-else-if="configClueMode === 'zoom' && configSelectedClue?.mode === 'zoom'" class="admin-media-slot admin-media-slot-zoom">
                    <span>Zoomed-in picture</span>
                    <img :src="imageSource(configSelectedClue.image)" alt="Preview of zoomed-in clue image" />
                    <select aria-label="Choose saved zoom image" :value="isMediaAssetReference(configSelectedClue.image) ? configSelectedClue.image : ''" @change="assignExistingMedia($event)">
                      <option value="">Choose a saved image…</option>
                      <option v-for="asset in mediaLibrary" :key="asset.reference" :value="asset.reference">{{ asset.name }}</option>
                    </select>
                    <span class="admin-media-upload-label">Or upload a new image</span>
                    <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload zoomed-in clue picture" @change="uploadConfigImage($event)" />
                  </label>
                  <label v-else-if="configClueMode === 'audio' && configSelectedClue?.mode === 'audio'" class="admin-media-slot admin-media-slot-audio">
                    <span>Sound clip</span>
                    <audio
                      v-if="!configSelectedClue.audio.startsWith('/mini-games/uploads/')"
                      :src="mediaAssetUrl(configSelectedClue.audio)"
                      controls
                      preload="metadata"
                      aria-label="Preview saved sound clip"
                    ></audio>
                    <select aria-label="Choose saved sound" :value="isMediaAssetReference(configSelectedClue.audio) ? configSelectedClue.audio : ''" @change="assignExistingMedia($event, undefined, 'audio')">
                      <option value="">Choose a saved sound…</option>
                      <option v-for="asset in audioLibrary" :key="asset.reference" :value="asset.reference">{{ asset.name }}</option>
                    </select>
                    <span class="admin-media-upload-label">Or upload an MP3, WAV, or OGG sound file</span>
                    <input type="file" accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/ogg,.mp3,.wav,.ogg" aria-label="Upload sound clip" @change="uploadConfigAudio($event)" />
                  </label>
                  <p v-if="configClueMode === 'audio'" class="admin-note">
                    {{ configSelectedClue?.mode === 'audio'
                      ? 'Sounds are saved on this server and can be reused by any clue. Choose a saved sound or upload a new one; JSON exports embed sound files.'
                      : 'Save this clue first to create its sound slot. Then choose a saved sound or upload a new one to the server library.' }}
                  </p>
                  <p v-else-if="configClueMode !== 'standard'" class="admin-note">
                    {{ configSelectedClue?.mode === configClueMode
                      ? 'Images are saved on this server and can be reused by any clue on this server. Choose a saved image or upload a new one; JSON exports embed the images.'
                      : configClueMode === 'frames'
                        ? 'Save this clue first to create five frame slots. Then choose saved images or upload new images to the server library.'
                        : 'Save this clue first to create its zoom slot. Then choose a saved image or upload a new one to the server library.' }}
                  </p>
                  <p v-if="mediaError" class="admin-note admin-media-error" role="alert">{{ mediaError }}</p>
                  <div class="admin-config-category-actions">
                    <button class="admin-save-button" type="submit">{{ configClueIndex < 0 ? 'Add clue' : 'Save clue' }}</button>
                    <button class="admin-remove-team-button" type="button" :disabled="configClueIndex < 0" @click="removeConfigClue">Remove clue</button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </section>

      </div>
    </div>
  </main>
</template>
