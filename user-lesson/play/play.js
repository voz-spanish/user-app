const SUPABASE_URL = 'https://nsprbshgkxywtwmimkcy.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zcHJic2hna3h5d3R3bWlta2N5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzMzMxMDAsImV4cCI6MjA5MzkwOTEwMH0.g51y4rq3xEDYD9GJoux7UDBeOpXyqYLDptwQ3LHy6b8'
const { createClient } = supabase
const db = createClient(SUPABASE_URL, SUPABASE_KEY)

async function checkAuth() {
  const { data: { session } } = await db.auth.getSession()
  if (!session) window.location.href = '../../login/login.html'
  return session
}

const urlParams = new URLSearchParams(window.location.search)
const planId = urlParams.get('plan_id')

let currentUser = null
let plan = null
let items = []          // [{ id, material, sentences: [{id, es, jp, start, end}] }]
let flatSentences = []  // レッスン順に並んだ全選択センテンス（フラッシュカード用）
let progress = null

// ============================================================
// データ取得
// ============================================================

async function loadData() {
  const { data: { user } } = await db.auth.getUser()
  currentUser = user

  const { data: planData, error: planError } = await db
    .from('lesson_plan_sets')
    .select('*')
    .eq('id', planId)
    .single()

  if (planError || !planData) {
    showError('レッスンプランが見つかりませんでした')
    return false
  }
  plan = planData
  document.getElementById('header-plan-title').textContent = plan.title || '（タイトル未設定）'

  const { data: itemsData, error: itemsError } = await db
    .from('lesson_plan_items')
    .select(`
      id, order_index,
      audio_materials ( id, title, type, youtube_id, audio_url ),
      lesson_plan_sentences (
        id, order_index,
        audio_sentences ( id, spanish_display, japanese, start_sec, end_sec )
      )
    `)
    .eq('plan_id', planId)
    .order('order_index', { ascending: true })

  if (itemsError) {
    console.error(itemsError)
    showError('レッスン内容の読み込みに失敗しました')
    return false
  }

  items = [...(itemsData || [])]
    .sort((a, b) => a.order_index - b.order_index)
    .map(item => ({
      id: item.id,
      material: item.audio_materials,
      sentences: [...(item.lesson_plan_sentences || [])]
        .sort((a, b) => a.order_index - b.order_index)
        .filter(s => s.audio_sentences)
        .map(s => ({
          id: s.audio_sentences.id,
          es: s.audio_sentences.spanish_display,
          jp: s.audio_sentences.japanese,
          start: s.audio_sentences.start_sec,
          end: s.audio_sentences.end_sec
        }))
    }))

  flatSentences = items.flatMap(it => it.sentences)

  if (items.length === 0) {
    showError('このレッスンプランにはレッスンが設定されていません')
    return false
  }

  // 進捗の取得 or 新規作成
  const { data: existing, error: progressFetchError } = await db
    .from('lesson_plan_progress')
    .select('*')
    .eq('plan_id', planId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (progressFetchError) {
    console.error(progressFetchError)
    showError('進捗の読み込みに失敗しました')
    return false
  }

  if (existing) {
    progress = existing
  } else {
    const { data: created, error: createError } = await db
      .from('lesson_plan_progress')
      .insert({ plan_id: planId, user_id: user.id })
      .select()
      .single()

    if (createError || !created) {
      console.error(createError)
      showError('進捗の作成に失敗しました')
      return false
    }
    progress = created
  }

  return true
}

function showError(msg) {
  document.getElementById('loading-msg').style.display = 'none'
  const errorEl = document.getElementById('error-msg')
  errorEl.textContent = msg
  errorEl.style.display = 'block'
}

// ============================================================
// 進捗の保存
// ============================================================

async function saveProgress(partial) {
  const payload = { ...partial, updated_at: new Date().toISOString() }
  const { data, error } = await db
    .from('lesson_plan_progress')
    .update(payload)
    .eq('id', progress.id)
    .select()
    .single()

  if (error) {
    console.error(error)
    return
  }
  progress = data
}

async function completePlan() {
  await saveProgress({
    phase: 'completed',
    status: 'completed',
    completed_at: new Date().toISOString()
  })
}

async function restartPlan() {
  await saveProgress({
    phase: 'lesson',
    status: 'in_progress',
    current_item_index: 0,
    current_sentence_index: 0,
    completed_at: null
  })
  renderCurrentPhase()
}

// ============================================================
// 画面切り替え
// ============================================================

function renderCurrentPhase() {
  document.getElementById('view-lesson').style.display = 'none'
  document.getElementById('view-flashcard').style.display = 'none'
  document.getElementById('view-completed').style.display = 'none'
  document.getElementById('footer-fixed').style.display = 'none'

  if (progress.phase === 'completed') {
    document.getElementById('view-completed').style.display = 'block'
  } else if (progress.phase === 'flashcard_es_jp' || progress.phase === 'flashcard_jp_es') {
    document.getElementById('view-flashcard').style.display = 'block'
    document.getElementById('footer-fixed').style.display = 'flex'
    renderFlashcardPhase()
  } else {
    document.getElementById('view-lesson').style.display = 'block'
    document.getElementById('footer-fixed').style.display = 'flex'
    renderLessonPhase()
  }
}

// ============================================================
// レッスン視聴フェーズ
// ============================================================

function renderLessonPhase() {
  const idx = Math.min(Math.max(progress.current_item_index, 0), items.length - 1)
  const item = items[idx]
  const material = item.material

  document.getElementById('lesson-step-label').textContent = `レッスン ${idx + 1} / ${items.length}`
  document.getElementById('lesson-material-title').textContent = material?.title || ''

  const playerWrap = document.getElementById('player-wrap')
  playerWrap.innerHTML = ''

  if (material?.type === 'youtube' && material.youtube_id) {
    const iframe = document.createElement('iframe')
    iframe.id = 'yt-player'
    iframe.src = `https://www.youtube.com/embed/${material.youtube_id}`
    iframe.allow = 'autoplay; encrypted-media'
    iframe.allowFullscreen = true
    playerWrap.appendChild(iframe)
  } else if (material?.type === 'mp3' && material.audio_url) {
    const audio = document.createElement('audio')
    audio.id = 'lesson-audio'
    audio.controls = true
    audio.src = material.audio_url
    playerWrap.appendChild(audio)
  }

  const sentenceList = document.getElementById('sentence-list')
  sentenceList.innerHTML = ''

  item.sentences.forEach((sentence, sIndex) => {
    const row = document.createElement('div')
    row.className = 'sentence-row'
    row.innerHTML = `
      <button type="button" class="btn-play-sentence">▶</button>
      <div class="sentence-text-wrap">
        <div class="sentence-es">${sentence.es || ''}</div>
        <div class="sentence-jp">${sentence.jp || ''}</div>
      </div>
      <button type="button" class="btn-toggle-jp">JP</button>
    `

    row.querySelector('.btn-play-sentence').addEventListener('click', () => {
      document.querySelectorAll('.sentence-row').forEach(r => r.classList.remove('playing'))
      row.classList.add('playing')
      playSentenceSegment(material, sentence)
    })

    row.querySelector('.btn-toggle-jp').addEventListener('click', () => {
      row.querySelector('.sentence-jp').classList.toggle('revealed')
    })

    sentenceList.appendChild(row)
  })

  const isLastItem = idx >= items.length - 1
  const mainBtn = document.getElementById('btn-main-action')
  mainBtn.textContent = isLastItem
    ? ((plan.flashcard_es_jp || plan.flashcard_jp_es) ? 'フラッシュカードへ →' : 'レッスンプランを完了する')
    : '次のレッスンへ →'
  mainBtn.onclick = advanceLesson
}

function playSentenceSegment(material, sentence) {
  if (material?.type === 'youtube' && material.youtube_id) {
    const iframe = document.getElementById('yt-player')
    if (!iframe) return
    const start = Math.max(0, Math.floor(sentence.start ?? 0))
    const end = sentence.end != null ? Math.ceil(sentence.end) : null
    const endParam = end != null ? `&end=${end}` : ''
    iframe.src = `https://www.youtube.com/embed/${material.youtube_id}?start=${start}${endParam}&autoplay=1`
  } else if (material?.type === 'mp3' && material.audio_url) {
    const audio = document.getElementById('lesson-audio')
    if (!audio) return
    audio.currentTime = sentence.start ?? 0
    audio.play()
    setupAudioAutoStop(audio, sentence.end)
  }
}

function setupAudioAutoStop(audio, endSec) {
  if (audio._autoStopHandler) {
    audio.removeEventListener('timeupdate', audio._autoStopHandler)
    audio._autoStopHandler = null
  }
  if (endSec == null) return
  const handler = () => {
    if (audio.currentTime >= endSec) {
      audio.pause()
      audio.removeEventListener('timeupdate', handler)
      audio._autoStopHandler = null
    }
  }
  audio._autoStopHandler = handler
  audio.addEventListener('timeupdate', handler)
}

async function advanceLesson() {
  const isLastItem = progress.current_item_index >= items.length - 1

  if (!isLastItem) {
    await saveProgress({ current_item_index: progress.current_item_index + 1 })
  } else if (plan.flashcard_es_jp) {
    await saveProgress({ phase: 'flashcard_es_jp', current_sentence_index: 0 })
  } else if (plan.flashcard_jp_es) {
    await saveProgress({ phase: 'flashcard_jp_es', current_sentence_index: 0 })
  } else {
    await completePlan()
  }

  renderCurrentPhase()
}

// ============================================================
// フラッシュカードフェーズ
// ============================================================

let flashcardRevealed = false

function renderFlashcardPhase() {
  if (flatSentences.length === 0) {
    completePlan().then(renderCurrentPhase)
    return
  }

  const idx = Math.min(Math.max(progress.current_sentence_index, 0), flatSentences.length - 1)
  const sentence = flatSentences[idx]
  const isEsJp = progress.phase === 'flashcard_es_jp'

  document.getElementById('flashcard-mode-label').textContent = isEsJp ? 'ES → JP' : 'JP → ES'
  document.getElementById('flashcard-counter').textContent = `${idx + 1} / ${flatSentences.length}`

  flashcardRevealed = false
  renderFlashcardFace(sentence, isEsJp)

  document.getElementById('btn-main-action').textContent = '次へ →'
  document.getElementById('btn-main-action').onclick = nextFlashcard
}

function renderFlashcardFace(sentence, isEsJp) {
  const faceEl = document.getElementById('flashcard-face-content')
  const hintEl = document.getElementById('flashcard-hint')
  const frontText = isEsJp ? sentence.es : sentence.jp
  const backText  = isEsJp ? sentence.jp : sentence.es

  if (!flashcardRevealed) {
    faceEl.textContent = frontText || ''
    faceEl.classList.remove('is-back')
    hintEl.textContent = 'タップして答えを見る'
  } else {
    faceEl.textContent = backText || ''
    faceEl.classList.add('is-back')
    hintEl.textContent = ''
  }
}

document.getElementById('flashcard-el').addEventListener('click', () => {
  if (progress.phase !== 'flashcard_es_jp' && progress.phase !== 'flashcard_jp_es') return
  const idx = Math.min(Math.max(progress.current_sentence_index, 0), flatSentences.length - 1)
  const sentence = flatSentences[idx]
  const isEsJp = progress.phase === 'flashcard_es_jp'
  flashcardRevealed = !flashcardRevealed
  renderFlashcardFace(sentence, isEsJp)
})

async function nextFlashcard() {
  const isLast = progress.current_sentence_index >= flatSentences.length - 1

  if (!isLast) {
    await saveProgress({ current_sentence_index: progress.current_sentence_index + 1 })
  } else if (progress.phase === 'flashcard_es_jp' && plan.flashcard_jp_es) {
    await saveProgress({ phase: 'flashcard_jp_es', current_sentence_index: 0 })
  } else {
    await completePlan()
  }

  renderCurrentPhase()
}

// ============================================================
// イベント
// ============================================================

document.getElementById('btn-restart').addEventListener('click', restartPlan)

// ============================================================
// 起動
// ============================================================

;(async () => {
  await checkAuth()
  const ok = await loadData()
  if (!ok) return
  document.getElementById('loading-msg').style.display = 'none'
  renderCurrentPhase()
})()
