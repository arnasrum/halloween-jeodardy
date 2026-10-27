<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

type Clue = {
  value: number
  prompt: string
  answer: string
}

type Category = {
  id: string
  name: string
  icon: string
  clues: Clue[]
}

type SelectedClue = {
  category: Category
  clue: Clue
} | null

type PlayedStatus = 'correct' | 'missed'
type Team = {
  name: string
  score: number
}

type SavedGame = {
  teams: Team[]
  activeTeamIndex: number
  played: Record<string, PlayedStatus>
}

const SAVE_KEY = 'halloween-jeopardy:save:v2'
const LEGACY_SAVE_KEY = 'halloween-jeopardy:save:v1'

const categories: Category[] = [
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
]

const defaultTeams: Team[] = [
  { name: 'Team Moonlight', score: 0 },
  { name: 'Team Midnight', score: 0 },
]
const teams = ref<Team[]>(defaultTeams.map((team) => ({ ...team })))
const activeTeamIndex = ref(0)
const played = ref<Record<string, PlayedStatus>>({})
const selectedClue = ref<SelectedClue>(null)
const showAnswer = ref(false)
const dialogRef = ref<HTMLDialogElement | null>(null)
const showAddTeamForm = ref(false)
const newTeamName = ref('')
const teamFormError = ref('')
const teamNameInput = ref<HTMLInputElement | null>(null)

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
    for (const category of categories) {
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
const remainingClues = computed(() => categories.reduce(
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

function beginAddTeam(): void {
  showAddTeamForm.value = true
  teamFormError.value = ''
  void nextTick(() => teamNameInput.value?.focus())
}

function cancelAddTeam(): void {
  showAddTeamForm.value = false
  newTeamName.value = ''
  teamFormError.value = ''
}

function addTeam(): void {
  const name = newTeamName.value.trim()
  if (!name) {
    teamFormError.value = 'Enter a team name.'
    return
  }
  if (name.length > 32) {
    teamFormError.value = 'Team names must be 32 characters or fewer.'
    return
  }
  if (teams.value.some((team) => team.name.toLowerCase() === name.toLowerCase())) {
    teamFormError.value = 'That team name is already in use.'
    return
  }

  teams.value.push({ name, score: 0 })
  newTeamName.value = ''
  teamFormError.value = ''
  showAddTeamForm.value = false
  persistGame()
}

function openClue(category: Category, clue: Clue): void {
  if (isPlayed(category, clue)) return
  selectedClue.value = { category, clue }
  showAnswer.value = false
}

function closeClue(): void {
  selectedClue.value = null
  showAnswer.value = false
}

function scoreClue(correct: boolean): void {
  const selected = selectedClue.value
  if (!selected || isPlayed(selected.category, selected.clue)) return

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
  <main class="app-shell">
    <header class="topbar">
      <a class="wordmark" href="#top" aria-label="Midnight Quiz Club home">
        <span class="wordmark-icon" aria-hidden="true">✦</span>
        <span>MIDNIGHT <b>QUIZ CLUB</b></span>
      </a>
      <div class="game-status"><span class="status-dot" aria-hidden="true"></span> GAME NIGHT</div>
    </header>

    <section id="top" class="hero" aria-labelledby="game-title">
      <div class="hero-copy">
        <p class="eyebrow"><span class="eyebrow-line"></span> Gather your ghouls &amp; test your wits</p>
        <h1 id="game-title">Halloween <span>Jeopardy</span></h1>
        <p class="hero-description">Five categories. Twenty-five clues. One delightfully spooky showdown.</p>
      </div>
      <div class="moon-art" aria-hidden="true">
        <span class="moon">☾</span>
        <span class="moon-spark spark-one">✦</span>
        <span class="moon-spark spark-two">✧</span>
        <span class="moon-spark spark-three">·</span>
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
        <button
          class="add-team-trigger"
          type="button"
          aria-controls="team-add-form"
          :aria-expanded="showAddTeamForm"
          @click="showAddTeamForm ? cancelAddTeam() : beginAddTeam()"
        >
          <span aria-hidden="true">{{ showAddTeamForm ? '×' : '+' }}</span>
          {{ showAddTeamForm ? 'Cancel' : 'Add team' }}
        </button>
      </div>
      <form v-if="showAddTeamForm" id="team-add-form" class="team-add-form" @submit.prevent="addTeam">
        <label class="team-name-field" for="new-team-name">
          <span>Team name</span>
          <input
            id="new-team-name"
            ref="teamNameInput"
            v-model="newTeamName"
            type="text"
            maxlength="32"
            autocomplete="off"
            placeholder="e.g. The Graveyard Shift"
            :aria-invalid="Boolean(teamFormError)"
            :aria-describedby="teamFormError ? 'team-name-error' : undefined"
            @input="teamFormError = ''"
          />
        </label>
        <button class="team-add-submit" type="submit">Add team</button>
        <p v-if="teamFormError" id="team-name-error" class="team-form-error" role="alert">{{ teamFormError }}</p>
      </form>
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
        <div class="game-board">
          <article v-for="category in categories" :key="category.id" class="category-column">
            <h3 class="category-heading">
              <span class="category-icon" aria-hidden="true">{{ category.icon }}</span>
              <span>{{ category.name }}</span>
            </h3>
            <button
              v-for="clue in category.clues"
              :key="clue.value"
              class="clue-tile"
              :class="{ 'clue-tile-played': isPlayed(category, clue) }"
              type="button"
              :disabled="isPlayed(category, clue)"
              :aria-label="`${category.name}, ${clue.value} points${isPlayed(category, clue) ? ', already played' : ''}`"
              @click="openClue(category, clue)"
            >
              <span v-if="!isPlayed(category, clue)">{{ clue.value }}</span>
              <span v-else aria-hidden="true">{{ played[clueKey(category, clue)] === 'correct' ? '✓' : '×' }}</span>
            </button>
          </article>
        </div>
      </div>
      <p class="scroll-hint">On a small screen? Swipe the board sideways <span aria-hidden="true">↔</span></p>
    </section>

    <footer class="footer-bar">
      <div class="footer-note"><span aria-hidden="true">✦</span> Play fair. Keep it spooky.</div>
      <button class="reset-button" type="button" @click="resetGame">Reset game <span aria-hidden="true">↺</span></button>
    </footer>

    <dialog ref="dialogRef" class="clue-dialog" aria-labelledby="clue-title" @click.self="closeClue" @close="onDialogClose">
      <div v-if="selectedClue" class="clue-modal-content">
        <button class="dialog-close" type="button" aria-label="Close clue" @click="closeClue">×</button>
        <div class="modal-category">
          <span aria-hidden="true">{{ selectedClue.category.icon }}</span>
          {{ selectedClue.category.name }}
        </div>
        <p class="modal-value">{{ selectedClue.clue.value }} <span>POINTS</span></p>
        <h2 id="clue-title" class="clue-prompt">{{ selectedClue.clue.prompt }}</h2>

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
      </div>
    </dialog>
  </main>
</template>
