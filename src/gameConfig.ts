export type ClueBase = {
  value: number
  prompt: string
  answer: string
}

export type Clue =
  | (ClueBase & { mode?: undefined })
  | (ClueBase & { mode: 'frames'; acceptedAnswers: string[]; frames: string[] })
  | (ClueBase & { mode: 'zoom'; acceptedAnswers: string[]; image: string })

export type Category = {
  id: string
  name: string
  icon: string
  clues: Clue[]
}

export type GameConfig = {
  version: 1
  categories: Category[]
}

export const CONFIG_STORAGE_KEY = 'halloween-jeopardy:config:v1'
const FRAME_COUNT = 5

function createFrameClue(value: number, answer: string, slug: string, acceptedAnswers: string[]): Extract<Clue, { mode: 'frames' }> {
  return {
    mode: 'frames',
    value,
    prompt: 'Name the movie from its frames.',
    answer,
    acceptedAnswers,
    frames: Array.from({ length: FRAME_COUNT }, (_, index) => `/mini-games/movies/${slug}/frame-${index + 1}.webp`),
  }
}

const defaultCategories: Category[] = [
  {
    id: 'monsters',
    name: 'Monsters & Myths',
    icon: '🦇',
    clues: [
      { value: 100, prompt: 'Folklore says this wolf-like creature transforms under a full moon.', answer: 'A werewolf' },
      { value: 200, prompt: 'This legendary sea monster is also the name of a giant squid in fiction.', answer: 'The Kraken' },
      { value: 300, prompt: 'This one-eyed giant from Greek mythology has a name meaning “round eye.”', answer: 'A Cyclops' },
      { value: 400, prompt: 'In legend, this sea creature lures sailors with an enchanting song.', answer: 'A siren' },
      { value: 500, prompt: 'This ghost ship is doomed to sail the seas forever.', answer: 'The Flying Dutchman' },
    ],
  },
  {
    id: 'movie-monsters',
    name: 'Famous Frights',
    icon: '🎬',
    clues: [
      { value: 100, prompt: 'In the 1984 comedy, this team catches ghosts in New York City.', answer: 'The Ghostbusters' },
      { value: 200, prompt: 'This masked slasher haunts Haddonfield in the Halloween film series.', answer: 'Michael Myers' },
      { value: 300, prompt: 'Boris Karloff played this stitched-together creature in the 1931 film.', answer: 'Frankenstein’s monster' },
      { value: 400, prompt: 'This haunted doll is kept in a glass case in a popular horror franchise.', answer: 'Annabelle' },
      { value: 500, prompt: 'This 1975 shark thriller made many moviegoers wary of the ocean.', answer: 'Jaws' },
    ],
  },
  {
    id: 'trick-or-treat',
    name: 'Trick or Treat',
    icon: '🎃',
    clues: [
      { value: 100, prompt: 'A carved pumpkin lantern goes by this name.', answer: 'A jack-o’-lantern' },
      { value: 200, prompt: 'The two-word phrase shouted at the door to ask for Halloween candy.', answer: 'Trick or treat' },
      { value: 300, prompt: 'This orange gourd is the classic canvas for a jack-o’-lantern.', answer: 'A pumpkin' },
      { value: 400, prompt: 'This sticky autumn treat coats a crisp apple.', answer: 'Caramel (or toffee)' },
      { value: 500, prompt: 'This ancient Celtic festival is commonly linked to Halloween’s origins.', answer: 'Samhain' },
    ],
  },
  {
    id: 'spooky-science',
    name: 'Spooky Science',
    icon: '🧪',
    clues: [
      { value: 100, prompt: 'This force keeps your feet on the floor and makes a dropped potion fall.', answer: 'Gravity' },
      { value: 200, prompt: 'This ground-hugging cloud forms when tiny water droplets hang in the air.', answer: 'Fog' },
      { value: 300, prompt: 'This orange pigment helps give pumpkins their color.', answer: 'Beta-carotene' },
      { value: 400, prompt: 'Fireflies make their light through this natural chemical process.', answer: 'Bioluminescence' },
      { value: 500, prompt: 'A full moon to full moon cycle takes about this many days.', answer: '29.5 days' },
    ],
  },
  {
    id: 'witch-workshop',
    name: 'Witch’s Workshop',
    icon: '🕯️',
    clues: [
      { value: 100, prompt: 'A witch’s classic pointy hat pairs with this flying ride.', answer: 'A broomstick' },
      { value: 200, prompt: 'This pungent bulb is said to ward off vampires.', answer: 'Garlic' },
      { value: 300, prompt: 'A witch stirs bubbling potions in this large vessel.', answer: 'A cauldron' },
      { value: 400, prompt: 'Complete the famous magic word: “Abra-...”', answer: '...cadabra!' },
      { value: 500, prompt: 'This word describes an object believed to bring luck or protection.', answer: 'A talisman' },
    ],
  },
  {
    id: 'movie-frames',
    name: 'Guess by Frame',
    icon: '🎞️',
    clues: [
      createFrameClue(100, 'Night of the Living Dead', 'night-of-the-living-dead', ['Night of the Living Dead (1968)', 'Night of the Living Dead 1968', 'NOTLD']),
      createFrameClue(200, 'Nosferatu', 'nosferatu', ['Nosferatu (1922)', 'Nosferatu: A Symphony of Horror', 'Nosferatu, eine Symphonie des Grauens', 'A Symphony of Horror']),
      createFrameClue(300, 'The Golem', 'the-golem', ['The Golem (1920)', 'The Golem: How He Came into the World', 'Der Golem, wie er in die Welt kam']),
      createFrameClue(400, 'The Screaming Skull', 'the-screaming-skull', ['The Screaming Skull (1958)', 'Screaming Skull']),
      createFrameClue(500, 'The Hideous Sun Demon', 'the-hideous-sun-demon', ['The Hideous Sun Demon (1958)']),
    ],
  },
  {
    id: 'costume-zoom',
    name: 'Zoomed-In Costumes',
    icon: '🔎',
    clues: [
      { mode: 'zoom', value: 100, prompt: 'Name this classic Halloween costume.', answer: 'Witch', acceptedAnswers: ['witch costume', 'witch outfit'], image: '/mini-games/costumes/witch.svg' },
      { mode: 'zoom', value: 200, prompt: 'Name this classic Halloween costume.', answer: 'Vampire', acceptedAnswers: ['vampire costume', 'Dracula'], image: '/mini-games/costumes/vampire.svg' },
      { mode: 'zoom', value: 300, prompt: 'Name this classic Halloween costume.', answer: 'Mummy', acceptedAnswers: ['mummy costume', 'wrapped mummy'], image: '/mini-games/costumes/mummy.svg' },
      { mode: 'zoom', value: 400, prompt: 'Name this classic Halloween costume.', answer: 'Werewolf', acceptedAnswers: ['werewolf costume', 'wolfman', 'wolf man'], image: '/mini-games/costumes/werewolf.svg' },
      { mode: 'zoom', value: 500, prompt: 'Name this classic Halloween costume.', answer: 'Skeleton', acceptedAnswers: ['skeleton costume', 'skull costume'], image: '/mini-games/costumes/skeleton.svg' },
    ],
  },
]

function requireText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`${field} must be a non-empty string of at most ${maxLength} characters.`)
  }
  return value.trim()
}

function requireStringList(value: unknown, field: string, maxItemLength: number): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.trim() && item.length <= maxItemLength)) {
    throw new Error(`${field} must be a list of strings (each at most ${maxItemLength} characters).`)
  }
  return value.map((item) => item.trim())
}

const MAX_MEDIA_REFERENCE_LENGTH = 8_000_000

function requireMediaReference(value: unknown, field: string): string {
  const reference = requireText(value, field, MAX_MEDIA_REFERENCE_LENGTH)
  if (reference.startsWith('/') && !reference.startsWith('//')) return reference
  if (/^asset:\/\/[a-z0-9-]{16,80}$/i.test(reference)) return reference
  if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(reference)) return reference
  throw new Error(`${field} must be a local image path, an uploaded image, or embedded PNG, JPEG, or WebP data.`)
}

function requireMediaReferenceList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be a list of image references.`)
  return value.map((item, index) => requireMediaReference(item, `${field}, image ${index + 1}`))
}

function copyClue(clue: Clue): Clue {
  if (clue.mode === 'frames') return { ...clue, acceptedAnswers: [...clue.acceptedAnswers], frames: [...clue.frames] }
  if (clue.mode === 'zoom') return { ...clue, acceptedAnswers: [...clue.acceptedAnswers] }
  return { ...clue }
}

export function createDefaultGameConfig(): GameConfig {
  return {
    version: 1,
    categories: defaultCategories.map((category) => ({
      ...category,
      clues: category.clues.map(copyClue),
    })),
  }
}

export function parseGameConfig(value: unknown): GameConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('This is not a supported game configuration. Expected version 1 with at least one category.')
  }
  const root = value as { version?: unknown; categories?: unknown }
  const rawCategories = root.categories
  if (root.version !== 1 || !Array.isArray(rawCategories) || rawCategories.length === 0) {
    throw new Error('This is not a supported game configuration. Expected version 1 with at least one category.')
  }

  const ids = new Set<string>()
  const names = new Set<string>()
  const categories = rawCategories.map((rawCategory, categoryIndex): Category => {
    const label = `Category ${categoryIndex + 1}`
    if (typeof rawCategory !== 'object' || rawCategory === null || Array.isArray(rawCategory)) {
      throw new Error(`${label} must be an object.`)
    }
    const data = rawCategory as { id?: unknown; name?: unknown; icon?: unknown; clues?: unknown }
    const id = requireText(data.id, `${label} ID`, 64)
    const name = requireText(data.name, `${label} name`, 48)
    const icon = requireText(data.icon, `${label} icon`, 16)
    if (ids.has(id)) throw new Error(`Category ID “${id}” is duplicated.`)
    if (names.has(name.toLowerCase())) throw new Error(`Category name “${name}” is duplicated.`)
    ids.add(id)
    names.add(name.toLowerCase())

    const rawClues = data.clues
    if (!Array.isArray(rawClues)) throw new Error(`${label} clues must be a list.`)
    const clueValues = new Set<number>()
    const clues = rawClues.map((rawClue, clueIndex): Clue => {
      const clueLabel = `${label}, clue ${clueIndex + 1}`
      if (typeof rawClue !== 'object' || rawClue === null || Array.isArray(rawClue)) {
        throw new Error(`${clueLabel} must be an object.`)
      }
      const clueData = rawClue as {
        value?: unknown
        prompt?: unknown
        answer?: unknown
        mode?: unknown
        acceptedAnswers?: unknown
        frames?: unknown
        image?: unknown
      }
      if (!Number.isSafeInteger(clueData.value) || (clueData.value as number) <= 0) {
        throw new Error(`${clueLabel} needs a positive whole-number point value.`)
      }
      const clueValue = clueData.value as number
      if (clueValues.has(clueValue)) throw new Error(`${label} has duplicate ${clueValue}-point clues.`)
      clueValues.add(clueValue)

      const base: ClueBase = {
        value: clueValue,
        prompt: requireText(clueData.prompt, `${clueLabel} prompt`, 2000),
        answer: requireText(clueData.answer, `${clueLabel} answer`, 1000),
      }
      if (clueData.mode === undefined) return base
      if (clueData.mode === 'frames') {
        const acceptedAnswers = requireStringList(clueData.acceptedAnswers, `${clueLabel} accepted answers`, 200)
        const frames = requireMediaReferenceList(clueData.frames, `${clueLabel} frame paths`)
        if (frames.length !== FRAME_COUNT) throw new Error(`${clueLabel} must have exactly ${FRAME_COUNT} frame paths.`)
        return { ...base, mode: 'frames', acceptedAnswers, frames }
      }
      if (clueData.mode === 'zoom') {
        const acceptedAnswers = requireStringList(clueData.acceptedAnswers, `${clueLabel} accepted answers`, 200)
        const image = requireMediaReference(clueData.image, `${clueLabel} image path`)
        return { ...base, mode: 'zoom', acceptedAnswers, image }
      }
      throw new Error(`${clueLabel} has an unknown clue mode.`)
    })

    return { id, name, icon, clues }
  })

  return { version: 1, categories }
}
