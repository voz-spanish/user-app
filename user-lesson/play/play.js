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
let items = []               // [{ id, material, lessonNumber, sentences: [...] }]
let itemSentenceMap = {}     // { item_id: [sentence(+chunks/vocab/itemId/material/lessonNumber), ...] }
let progress = null
let activeBoxId = null       // 現在選択中のBOX(item.id)

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
        audio_sentences ( id, sentence_number, spanish_display, japanese, start_sec, end_sec )
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
    .map((item, itemIdx) => ({
      id: item.id,
      material: item.audio_materials,
      lessonNumber: itemIdx + 1,
      sentences: [...(item.lesson_plan_sentences || [])]
        .sort((a, b) => a.order_index - b.order_index)
        .filter(s => s.audio_sentences)
        .map(s => ({
          id: s.audio_sentences.id,
          sentence_number: s.audio_sentences.sentence_number,
          spanish_display: s.audio_sentences.spanish_display,
          japanese: s.audio_sentences.japanese,
          start_sec: s.audio_sentences.start_sec,
          end_sec: s.audio_sentences.end_sec
        }))
    }))

  if (items.length === 0) {
    showError('このレッスンプランにはレッスンが設定されていません')
    return false
  }

  itemSentenceMap = {}
  const allSentenceIds = []
  items.forEach(it => {
    itemSentenceMap[it.id] = it.sentences.map(s => ({
      ...s, itemId: it.id, material: it.material, lessonNumber: it.lessonNumber
    }))
    it.sentences.forEach(s => allSentenceIds.push(s.id))
  })

  if (allSentenceIds.length > 0) {
    const { chunksMap, vocabMap } = await loadChunksAndVocab(allSentenceIds)
    Object.values(itemSentenceMap).forEach(list => {
      list.forEach(s => {
        s.chunks = chunksMap[s.id] || []
        s.vocab = vocabMap[s.id] || {}
      })
    })
  }

  if (items.some(it => it.material?.type === 'youtube' && it.material?.youtube_id)) {
    loadYouTubeAPI()
  }

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
      .insert({
        plan_id: planId, user_id: user.id,
        status: 'in_progress',
        completed_sentence_ids: [], completed_flashcards: {}
      })
      .select()
      .single()

    if (createError || !created) {
      console.error(createError)
      showError('進捗の作成に失敗しました')
      return false
    }
    progress = created
  }

  progress.completed_sentence_ids = progress.completed_sentence_ids || []
  progress.completed_flashcards = progress.completed_flashcards || {}

  return true
}

async function loadChunksAndVocab(sentenceIds) {
  if (sentenceIds.length === 0) return { chunksMap: {}, vocabMap: {} }

  const [chunksRes, vocabRes] = await Promise.all([
    db.from('audio_sentence_chunks').select('*').in('sentence_id', sentenceIds).order('sort_order'),
    db.from('audio_sentence_vocab').select('*').in('sentence_id', sentenceIds)
  ])

  const chunksMap = {}
  ;(chunksRes.data || []).forEach(c => {
    if (!chunksMap[c.sentence_id]) chunksMap[c.sentence_id] = []
    chunksMap[c.sentence_id].push(c)
  })

  const vocabMap = {}
  ;(vocabRes.data || []).forEach(v => {
    if (!vocabMap[v.sentence_id]) vocabMap[v.sentence_id] = {}
    vocabMap[v.sentence_id][v.spanish] = v.selected_meaning || ''
  })

  return { chunksMap, vocabMap }
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
  progress.completed_sentence_ids = progress.completed_sentence_ids || []
  progress.completed_flashcards = progress.completed_flashcards || {}
}

async function markSentenceDone(sentenceId) {
  if (progress.completed_sentence_ids.includes(sentenceId)) return
  const next = [...progress.completed_sentence_ids, sentenceId]
  progress.completed_sentence_ids = next // 楽観的に反映
  await saveProgress({ completed_sentence_ids: next })
  await recomputeStatus()
}

async function markFlashcardDone(itemId, mode) {
  const key = `${itemId}:${mode}`
  const next = { ...progress.completed_flashcards, [key]: true }
  progress.completed_flashcards = next
  await saveProgress({ completed_flashcards: next })
  await recomputeStatus()
}

function computeTotals() {
  const doneSentenceIds = new Set(progress.completed_sentence_ids)
  const doneFlashcards = progress.completed_flashcards
  let totalUnits = 0
  let doneUnits = 0
  items.forEach(item => {
    const sentences = itemSentenceMap[item.id] || []
    totalUnits += sentences.length
    doneUnits += sentences.filter(s => doneSentenceIds.has(s.id)).length
    const modes = []
    if (plan.flashcard_es_jp) modes.push('es_jp')
    if (plan.flashcard_jp_es) modes.push('jp_es')
    modes.forEach(m => {
      totalUnits += 1
      if (doneFlashcards[`${item.id}:${m}`]) doneUnits += 1
    })
  })
  return { totalUnits, doneUnits }
}

async function recomputeStatus() {
  const { totalUnits, doneUnits } = computeTotals()
  const newStatus = (totalUnits > 0 && doneUnits >= totalUnits) ? 'completed' : 'in_progress'
  if (progress.status !== newStatus) {
    await saveProgress({
      status: newStatus,
      completed_at: newStatus === 'completed' ? new Date().toISOString() : null
    })
  }
}

// ============================================================
// 画面切り替え
// ============================================================

function showView(viewId) {
  document.querySelectorAll('.view').forEach(v => { v.style.display = 'none' })
  document.getElementById(viewId).style.display = 'block'
}

// ============================================================
// レッスン内容一覧（BOXタブ + 選択中コンテンツ）
// ============================================================

function boxIsComplete(item) {
  const sentences = itemSentenceMap[item.id] || []
  const modes = []
  if (plan.flashcard_es_jp) modes.push('es_jp')
  if (plan.flashcard_jp_es) modes.push('jp_es')

  const doneSentenceIds = new Set(progress.completed_sentence_ids)
  const doneFlashcards = progress.completed_flashcards

  const allSentDone = sentences.length > 0 && sentences.every(s => doneSentenceIds.has(s.id))
  const allFcDone = modes.every(m => doneFlashcards[`${item.id}:${m}`])
  return (sentences.length > 0 || modes.length > 0) && allSentDone && allFcDone
}

function renderOverview() {
  showView('view-overview')

  const { totalUnits, doneUnits } = computeTotals()
  document.getElementById('overview-banner').style.display =
    (totalUnits > 0 && doneUnits >= totalUnits) ? 'block' : 'none'

  if (!activeBoxId || !items.some(it => it.id === activeBoxId)) {
    activeBoxId = items[0]?.id || null
  }

  renderBoxTabs()
  renderBoxContent()
}

function renderBoxTabs() {
  const tabsWrap = document.getElementById('box-tabs')
  tabsWrap.innerHTML = ''

  items.forEach((item, idx) => {
    const complete = boxIsComplete(item)
    const isActive = item.id === activeBoxId

    const tab = document.createElement('button')
    tab.type = 'button'
    tab.className = `box-tab${isActive ? ' active' : ''}`
    tab.dataset.itemId = item.id
    tab.innerHTML = `
      <span class="box-tab-circle ${complete ? 'done' : ''}">${complete ? '✓' : (idx + 1)}</span>
      <span class="box-tab-label">${item.material?.title || '（無題）'}</span>
    `
    tab.addEventListener('click', () => selectBox(item.id))
    tabsWrap.appendChild(tab)
  })
}

function selectBox(itemId) {
  if (activeBoxId === itemId) return
  activeBoxId = itemId
  renderOverview()

  const activeTab = document.querySelector(`.box-tab[data-item-id="${itemId}"]`)
  if (activeTab) activeTab.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
}

function renderBoxContent() {
  const contentWrap = document.getElementById('box-content')
  contentWrap.innerHTML = ''

  const item = items.find(it => it.id === activeBoxId)
  if (!item) return

  const sentences = itemSentenceMap[item.id] || []
  const modes = []
  if (plan.flashcard_es_jp) modes.push('es_jp')
  if (plan.flashcard_jp_es) modes.push('jp_es')

  const doneSentenceIds = new Set(progress.completed_sentence_ids)
  const doneFlashcards = progress.completed_flashcards

  contentWrap.innerHTML = `
    <div class="box-content-header">${item.material?.title || '（無題）'}</div>
    <div class="box-content-body">
      <div class="box-player-wrap" id="box-player-${item.id}"></div>
      <ul class="box-sentence-list" id="box-sentlist-${item.id}"></ul>
    </div>
  `

  renderBoxSentenceList(item, sentences, modes, doneSentenceIds, doneFlashcards)
}

function updateBoxCheck(itemId) {
  const { totalUnits, doneUnits } = computeTotals()
  document.getElementById('overview-banner').style.display =
    (totalUnits > 0 && doneUnits >= totalUnits) ? 'block' : 'none'

  const item = items.find(it => it.id === itemId)
  if (!item) return
  const complete = boxIsComplete(item)
  const idx = items.findIndex(it => it.id === itemId)

  const circleEl = document.querySelector(`.box-tab[data-item-id="${itemId}"] .box-tab-circle`)
  if (circleEl) {
    circleEl.classList.toggle('done', complete)
    circleEl.textContent = complete ? '✓' : (idx + 1)
  }
}

function renderBoxSentenceList(item, sentences, modes, doneSentenceIds, doneFlashcards) {
  const ul = document.getElementById(`box-sentlist-${item.id}`)
  if (!ul) return
  ul.innerHTML = ''

  sentences.forEach((s, si) => {
    const done = doneSentenceIds.has(s.id)
    const li = document.createElement('li')
    li.className = 'box-sentence-row'
    li.innerHTML = `
      <span class="row-check ${done ? 'done' : ''}">${done ? '✓' : '○'}</span>
      <button class="btn-play-sentence" type="button">▶</button>
      <span class="row-es">${cleanChunkDisplay(s.spanish_display || '')}</span>
      <button class="btn-row-detail" type="button">＞</button>
    `

    li.querySelector('.btn-play-sentence').addEventListener('click', async (e) => {
      e.stopPropagation()
      playSegmentForItem(item, s)
      const checkEl = li.querySelector('.row-check')
      checkEl.textContent = '✓'
      checkEl.classList.add('done')
      await markSentenceDone(s.id)
      updateBoxCheck(item.id)
    })

    li.querySelector('.btn-row-detail').addEventListener('click', (e) => {
      e.stopPropagation()
      openSentenceDetail(item, sentences, si)
    })

    ul.appendChild(li)
  })

  modes.forEach(m => {
    const done = !!doneFlashcards[`${item.id}:${m}`]
    const label = m === 'es_jp' ? 'フラッシュカード ES→JP' : 'フラッシュカード JP→ES'
    const li = document.createElement('li')
    li.className = 'box-flashcard-row'
    li.innerHTML = `
      <span class="row-check ${done ? 'done' : ''}">${done ? '✓' : '○'}</span>
      <span class="row-label">${label}</span>
      <button class="btn-row-detail" type="button">＞</button>
    `
    li.addEventListener('click', () => openFlashcardMode(item, sentences, m))
    ul.appendChild(li)
  })
}

// ----- 教材の区間再生（選択中BOXのプレイヤー） -----

function ensureBoxPlayer(item) {
  const wrap = document.getElementById(`box-player-${item.id}`)
  if (!wrap || wrap.dataset.ready) return wrap
  const material = item.material
  if (material?.type === 'youtube' && material.youtube_id) {
    const iframe = document.createElement('iframe')
    iframe.id = `box-yt-${item.id}`
    iframe.allow = 'autoplay; encrypted-media'
    iframe.allowFullscreen = true
    iframe.src = `https://www.youtube.com/embed/${material.youtube_id}`
    wrap.appendChild(iframe)
  } else if (material?.type === 'mp3' && material.audio_url) {
    const audio = document.createElement('audio')
    audio.id = `box-audio-${item.id}`
    audio.controls = true
    audio.src = material.audio_url
    wrap.appendChild(audio)
  }
  wrap.dataset.ready = '1'
  return wrap
}

function playSegmentForItem(item, sentence) {
  ensureBoxPlayer(item)
  const material = item.material
  if (material?.type === 'youtube' && material.youtube_id) {
    const iframe = document.getElementById(`box-yt-${item.id}`)
    if (!iframe) return
    const start = Math.max(0, Math.floor(sentence.start_sec ?? 0))
    const end = sentence.end_sec != null ? Math.ceil(sentence.end_sec) : null
    const endParam = end != null ? `&end=${end}` : ''
    iframe.src = `https://www.youtube.com/embed/${material.youtube_id}?start=${start}${endParam}&autoplay=1`
  } else if (material?.type === 'mp3' && material.audio_url) {
    const audio = document.getElementById(`box-audio-${item.id}`)
    if (!audio) return
    audio.currentTime = sentence.start_sec ?? 0
    audio.play()
    setupAudioAutoStop(audio, sentence.end_sec)
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

// ============================================================
// センテンス詳細
// ============================================================

let detailItem = null
let detailSentences = []
let detailIndex = 0

function openSentenceDetail(item, sentences, index) {
  detailItem = item
  detailSentences = sentences
  detailIndex = index
  showView('view-sentence-detail')
  renderSentenceDetail()
}

document.getElementById('detail-back-btn').addEventListener('click', () => {
  renderOverview()
})

document.getElementById('detail-prev-btn').addEventListener('click', () => {
  if (detailIndex > 0) { detailIndex--; renderSentenceDetail() }
})
document.getElementById('detail-next-btn').addEventListener('click', () => {
  if (detailIndex < detailSentences.length - 1) { detailIndex++; renderSentenceDetail() }
})

function renderSentenceDetail() {
  const item = detailItem
  const sentence = detailSentences[detailIndex]
  const material = item.material

  document.getElementById('detail-position').textContent =
    `${material?.title || ''}　${detailIndex + 1} / ${detailSentences.length}`

  document.getElementById('detail-prev-btn').disabled = detailIndex <= 0
  document.getElementById('detail-next-btn').disabled = detailIndex >= detailSentences.length - 1

  // プレイヤー
  const playerWrap = document.getElementById('detail-player-wrap')
  const audioRow = document.getElementById('detail-audio-row')
  playerWrap.innerHTML = ''
  audioRow.style.display = 'none'

  const btnPlay = document.getElementById('detail-btn-play')
  btnPlay.textContent = progress.completed_sentence_ids.includes(sentence.id)
    ? '✓ 再生する（完了済み・もう一度再生）'
    : '▶ 再生する（完了にする）'

  if (material?.type === 'youtube' && material.youtube_id) {
    const iframe = document.createElement('iframe')
    iframe.id = 'detail-yt-player'
    iframe.allow = 'autoplay; encrypted-media'
    iframe.allowFullscreen = true
    const start = Math.max(0, Math.floor(sentence.start_sec ?? 0))
    const end = sentence.end_sec != null ? Math.ceil(sentence.end_sec) : null
    const endParam = end != null ? `&end=${end}` : ''
    iframe.src = `https://www.youtube.com/embed/${material.youtube_id}?start=${start}${endParam}`
    playerWrap.appendChild(iframe)

    btnPlay.onclick = async () => {
      iframe.src = `https://www.youtube.com/embed/${material.youtube_id}?start=${start}${endParam}&autoplay=1`
      await markSentenceDone(sentence.id)
      updateBoxCheck(item.id)
      btnPlay.textContent = '✓ 再生する（完了済み・もう一度再生）'
    }
  } else if (material?.type === 'mp3' && material.audio_url) {
    audioRow.style.display = 'block'
    const audio = document.getElementById('detail-audio')
    audio.src = material.audio_url
    audio.currentTime = sentence.start_sec ?? 0

    btnPlay.onclick = async () => {
      audio.currentTime = sentence.start_sec ?? 0
      audio.play()
      setupAudioAutoStop(audio, sentence.end_sec)
      await markSentenceDone(sentence.id)
      updateBoxCheck(item.id)
      btnPlay.textContent = '✓ 再生する（完了済み・もう一度再生）'
    }
  } else {
    btnPlay.onclick = async () => {
      await markSentenceDone(sentence.id)
      updateBoxCheck(item.id)
      btnPlay.textContent = '✓ 完了済み'
    }
  }

  renderDetailSpanish(sentence)
  renderDetailJpNatural(sentence)
  renderDetailJpChunk(sentence)
}

function renderDetailSpanish(sentence) {
  const contentEl = document.getElementById('detail-es-content')
  const bubble = document.getElementById('detail-es-bubble')
  contentEl.innerHTML = ''
  bubble.style.display = 'none'

  if (!sentence.chunks || sentence.chunks.length === 0) {
    contentEl.textContent = cleanChunkDisplay(sentence.spanish_display || '')
    return
  }

  let activeChunkEl = null

  function resetAll() {
    if (activeChunkEl) {
      activeChunkEl.textContent = activeChunkEl.dataset.orig
      activeChunkEl.classList.remove('active')
    }
    contentEl.querySelectorAll('.fc-chunk-token').forEach(el => el.classList.remove('active'))
    bubble.style.display = 'none'
    activeChunkEl = null
  }

  function showBubble(text) {
    if (!text) { bubble.style.display = 'none'; return }
    bubble.textContent = text
    bubble.style.display = 'block'
  }

  sentence.chunks.forEach((chunk, ci) => {
    if (ci > 0) contentEl.appendChild(document.createTextNode(' '))

    const raw = normalizeRaw(chunk.spanish_raw || chunk.spanish_chunk)
    const tokens = parseTokens(raw)
    const leafTokens = getLeafTokens(tokens)
    const hasSubTokens = leafTokens.length > 1 ||
      (leafTokens.length === 1 && leafTokens[0].type !== 'word')

    const chunkSpan = document.createElement('span')
    chunkSpan.className = 'fc-chunk-token'
    chunkSpan.dataset.orig = cleanChunkDisplay(chunk.spanish_chunk)
    chunkSpan.textContent = cleanChunkDisplay(chunk.spanish_chunk)

    chunkSpan.addEventListener('click', (e) => {
      e.stopPropagation()
      if (activeChunkEl && activeChunkEl !== chunkSpan) {
        activeChunkEl.textContent = activeChunkEl.dataset.orig
        activeChunkEl.classList.remove('active')
        contentEl.querySelectorAll('.fc-chunk-token').forEach(el => el.classList.remove('active'))
        bubble.style.display = 'none'
        activeChunkEl = null
      }
      if (activeChunkEl === chunkSpan) { resetAll(); return }

      activeChunkEl = chunkSpan
      chunkSpan.classList.add('active')
      showBubble(chunk.japanese_chunk || cleanChunkDisplay(chunk.spanish_chunk))

      if (hasSubTokens) {
        expandChunkToSubs(chunkSpan, leafTokens, sentence.vocab, bubble, showBubble)
      }
    })

    contentEl.appendChild(chunkSpan)
  })

  contentEl.addEventListener('click', (e) => {
    if (e.target === contentEl) resetAll()
  })
}

function renderDetailJpNatural(sentence) {
  const btn = document.getElementById('detail-btn-jp-natural')
  const panel = document.getElementById('detail-jp-natural-panel')
  panel.textContent = sentence.japanese || '（未登録）'
  panel.style.display = 'none'
  btn.textContent = '＋ 自然な日本語訳'
  btn.classList.remove('open')

  const newBtn = btn.cloneNode(true)
  btn.parentNode.replaceChild(newBtn, btn)
  newBtn.addEventListener('click', () => {
    const isOpen = panel.style.display !== 'none'
    panel.style.display = isOpen ? 'none' : 'block'
    newBtn.textContent = isOpen ? '＋ 自然な日本語訳' : '－ 自然な日本語訳'
    newBtn.classList.toggle('open', !isOpen)
  })
}

function renderDetailJpChunk(sentence) {
  const wrap = document.getElementById('detail-btn-jp-chunk').parentNode
  const btn = document.getElementById('detail-btn-jp-chunk')
  const panel = document.getElementById('detail-jp-chunk-panel')
  const tokensEl = document.getElementById('detail-chunk-tokens')
  const bubble = document.getElementById('detail-chunk-bubble')

  panel.style.display = 'none'
  btn.textContent = '＋ チャンク直訳'
  btn.classList.remove('open')
  tokensEl.innerHTML = ''
  bubble.style.display = 'none'

  const hasChunks = sentence.chunks && sentence.chunks.length > 0
  const newBtn = btn.cloneNode(true)
  btn.parentNode.replaceChild(newBtn, btn)

  if (!hasChunks) {
    newBtn.style.display = 'none'
    panel.style.display = 'none'
    return
  }
  newBtn.style.display = 'block'

  let panelBuilt = false
  function buildPanel() {
    if (panelBuilt) return
    panelBuilt = true
    sentence.chunks.forEach((chunk, ci) => {
      if (ci > 0) {
        const sep = document.createElement('span')
        sep.className = 'chunk-sep'
        sep.textContent = '／'
        tokensEl.appendChild(sep)
      }
      const span = document.createElement('span')
      span.className = 'fc-chunk-lit'
      span.textContent = chunk.japanese_chunk || cleanChunkDisplay(chunk.spanish_chunk)
      span.addEventListener('click', (e) => {
        e.stopPropagation()
        tokensEl.querySelectorAll('.fc-chunk-lit').forEach(el => el.classList.remove('active'))
        span.classList.add('active')
        bubble.textContent = cleanChunkDisplay(chunk.spanish_chunk)
        bubble.style.display = 'block'
      })
      tokensEl.appendChild(span)
    })
  }

  newBtn.addEventListener('click', () => {
    const isOpen = panel.style.display !== 'none'
    if (!isOpen) {
      buildPanel()
      panel.style.display = 'flex'
      newBtn.textContent = '－ チャンク直訳'
      newBtn.classList.add('open')
    } else {
      panel.style.display = 'none'
      newBtn.textContent = '＋ チャンク直訳'
      newBtn.classList.remove('open')
    }
  })
}

// ============================================================
// フラッシュカード（教材ごとにスコープ）
// ============================================================

let fcActiveItem = null
let fcActiveMode = null   // 'es_jp' | 'jp_es'
let fcQueue = []
let fcIndex = 0
let fcResults = {}
let fcFirstResults = {}
let fcTotal = 0

let ytPlayer = null
let ytReady = false
let currentPlayTimer = null
let pendingPlayCard = null
let pendingPlayBtn = null

window.onYouTubeIframeAPIReady = () => {
  ytPlayer = new YT.Player('yt-player-hidden', {
    height: '1', width: '1',
    videoId: '',
    playerVars: { playsinline: 1, rel: 0, autoplay: 0 },
    events: {
      onReady: () => { ytReady = true },
      onStateChange: (e) => {
        if (e.data === YT.PlayerState.PLAYING && pendingPlayCard) {
          const card = pendingPlayCard
          const btn = pendingPlayBtn
          pendingPlayCard = null
          pendingPlayBtn = null
          if (currentPlayTimer) clearTimeout(currentPlayTimer)
          const duration = (card.end_sec - card.start_sec) * 1000
          btn.classList.add('playing')
          btn.textContent = '■ 再生中'
          currentPlayTimer = setTimeout(() => {
            try { ytPlayer.pauseVideo() } catch (e) {}
            btn.classList.remove('playing')
            btn.textContent = '▶ 再生'
            currentPlayTimer = null
          }, duration)
        }
      }
    }
  })
}

function loadYouTubeAPI() {
  if (document.getElementById('yt-api-script')) return
  const tag = document.createElement('script')
  tag.id = 'yt-api-script'
  tag.src = 'https://www.youtube.com/iframe_api'
  document.head.appendChild(tag)
}

function playFlashcardAudio(card, btn) {
  if (!card.material || card.material.type !== 'youtube' || !card.material.youtube_id) return
  if (card.start_sec == null || card.end_sec == null) return
  if (!ytPlayer || !ytReady) return

  if (currentPlayTimer) { clearTimeout(currentPlayTimer); currentPlayTimer = null }

  btn.textContent = '読込中…'
  btn.classList.remove('playing')

  pendingPlayCard = card
  pendingPlayBtn = btn

  let currentVideoId = ''
  try { currentVideoId = ytPlayer.getVideoData()?.video_id || '' } catch (e) {}

  if (currentVideoId === card.material.youtube_id) {
    ytPlayer.seekTo(card.start_sec, true)
    ytPlayer.playVideo()
  } else {
    ytPlayer.loadVideoById({ videoId: card.material.youtube_id, startSeconds: card.start_sec })
  }
}

function stopFlashcardAudio() {
  pendingPlayCard = null
  pendingPlayBtn = null
  if (currentPlayTimer) { clearTimeout(currentPlayTimer); currentPlayTimer = null }
  try { if (ytPlayer) ytPlayer.pauseVideo() } catch (e) {}
  const btnF = document.getElementById('fc-btn-play-front')
  const btnB = document.getElementById('fc-btn-play-back')
  if (btnF) { btnF.classList.remove('playing'); btnF.textContent = '▶ 再生' }
  if (btnB) { btnB.classList.remove('playing'); btnB.textContent = '▶ 再生' }
}

document.getElementById('fc-back-btn').addEventListener('click', () => {
  stopFlashcardAudio()
  renderOverview()
})

function openFlashcardMode(item, sentences, mode) {
  fcActiveItem = item
  fcActiveMode = mode
  showView('view-flashcard')
  startFlashcardPass(sentences)
}

function startFlashcardPass(sentences) {
  document.getElementById('fc-card-mode-wrap').style.display = 'block'
  document.getElementById('fc-result-view').style.display = 'none'

  fcQueue = [...sentences]
  fcIndex = 0
  fcResults = {}
  fcFirstResults = {}
  fcTotal = sentences.length

  if (fcTotal === 0) {
    onFlashcardPassContinue()
    return
  }

  document.getElementById('fc-mode-badge').textContent =
    fcActiveMode === 'es_jp' ? 'ES→JP' : 'JP→ES'

  renderFlashcardCard()
}

function renderFlashcardCard() {
  const card = fcQueue[fcIndex]
  const isEsJp = fcActiveMode === 'es_jp'
  updateFlashcardProgress()

  document.getElementById('fc-front').style.display = 'flex'
  document.getElementById('fc-back').style.display = 'none'
  document.getElementById('fc-card-input').value = ''
  document.getElementById('fc-front-bubble').style.display = 'none'
  document.getElementById('fc-back-bubble').style.display = 'none'
  document.getElementById('fc-user-answer-wrap').style.display = 'none'
  document.getElementById('fc-user-answer-text').value = ''

  document.getElementById('fc-front-chunk-reveal-wrap').style.display = 'none'
  document.getElementById('fc-chunk-reveal-panel').style.display = 'none'
  document.getElementById('fc-chunk-reveal-bubble').style.display = 'none'
  document.getElementById('fc-chunk-reveal-tokens').innerHTML = ''

  document.getElementById('fc-front-input-section').style.display = isEsJp ? 'none' : 'block'

  if (isEsJp) {
    renderFcFrontES(card)
    renderFcBackJP(card)
  } else {
    renderFcFrontJP(card)
    renderFcBackES(card)
  }

  const hasAudio = card.material?.type === 'youtube' && card.material?.youtube_id &&
    card.start_sec != null && card.end_sec != null
  const frontAudioRow = document.getElementById('fc-front-audio-row')
  const backAudioRow = document.getElementById('fc-back-audio-row')

  if (hasAudio) {
    frontAudioRow.style.display = isEsJp ? 'flex' : 'none'
    backAudioRow.style.display = isEsJp ? 'none' : 'flex'
  } else {
    frontAudioRow.style.display = 'none'
    backAudioRow.style.display = 'none'
  }

  document.getElementById('fc-btn-play-front').onclick = () =>
    playFlashcardAudio(card, document.getElementById('fc-btn-play-front'))
  document.getElementById('fc-btn-play-back').onclick = () =>
    playFlashcardAudio(card, document.getElementById('fc-btn-play-back'))
}

function fcLabel(card) {
  return `レッスン ${card.lessonNumber}  ・  センテンス ${card.sentence_number ?? ''}`
}

function renderFcFrontES(card) {
  document.getElementById('fc-front-label').textContent = fcLabel(card)
  const contentEl = document.getElementById('fc-front-content')
  const bubble = document.getElementById('fc-front-bubble')
  contentEl.innerHTML = ''
  bubble.style.display = 'none'

  if (!card.chunks || card.chunks.length === 0) {
    contentEl.textContent = cleanChunkDisplay(card.spanish_display || '')
    return
  }

  let activeChunkEl = null
  function resetAll() {
    if (activeChunkEl) {
      activeChunkEl.textContent = activeChunkEl.dataset.orig
      activeChunkEl.classList.remove('active')
    }
    contentEl.querySelectorAll('.fc-chunk-token').forEach(el => el.classList.remove('active'))
    bubble.style.display = 'none'
    activeChunkEl = null
  }
  function showBubble(text) {
    if (!text) { bubble.style.display = 'none'; return }
    bubble.textContent = text
    bubble.style.display = 'block'
  }

  card.chunks.forEach((chunk, ci) => {
    if (ci > 0) contentEl.appendChild(document.createTextNode(' '))
    const raw = normalizeRaw(chunk.spanish_raw || chunk.spanish_chunk)
    const tokens = parseTokens(raw)
    const leafTokens = getLeafTokens(tokens)
    const hasSubTokens = leafTokens.length > 1 ||
      (leafTokens.length === 1 && leafTokens[0].type !== 'word')

    const chunkSpan = document.createElement('span')
    chunkSpan.className = 'fc-chunk-token'
    chunkSpan.dataset.orig = cleanChunkDisplay(chunk.spanish_chunk)
    chunkSpan.textContent = cleanChunkDisplay(chunk.spanish_chunk)

    chunkSpan.addEventListener('click', (e) => {
      e.stopPropagation()
      if (activeChunkEl && activeChunkEl !== chunkSpan) {
        activeChunkEl.textContent = activeChunkEl.dataset.orig
        activeChunkEl.classList.remove('active')
        contentEl.querySelectorAll('.fc-chunk-token').forEach(el => el.classList.remove('active'))
        bubble.style.display = 'none'
        activeChunkEl = null
      }
      if (activeChunkEl === chunkSpan) { resetAll(); return }
      activeChunkEl = chunkSpan
      chunkSpan.classList.add('active')
      showBubble(chunk.japanese_chunk || cleanChunkDisplay(chunk.spanish_chunk))
      if (hasSubTokens) expandChunkToSubs(chunkSpan, leafTokens, card.vocab, bubble, showBubble)
    })

    contentEl.appendChild(chunkSpan)
  })

  contentEl.addEventListener('click', (e) => { if (e.target === contentEl) resetAll() })
}

function renderFcBackJP(card) {
  document.getElementById('fc-back-label').textContent = '日本語の意味'
  const contentEl = document.getElementById('fc-back-content')
  contentEl.innerHTML = `<div class="card-jp-natural">${card.japanese || '（未登録）'}</div>`
}

function renderFcFrontJP(card) {
  document.getElementById('fc-front-label').textContent = fcLabel(card)
  const contentEl = document.getElementById('fc-front-content')
  contentEl.innerHTML = ''

  const jpDiv = document.createElement('div')
  jpDiv.className = 'card-jp-natural'
  jpDiv.textContent = card.japanese || '（未登録）'
  contentEl.appendChild(jpDiv)

  const hasChunks = card.chunks && card.chunks.length > 0
  const chunkRevealWrap = document.getElementById('fc-front-chunk-reveal-wrap')
  const chunkRevealPanel = document.getElementById('fc-chunk-reveal-panel')
  const tokensEl = document.getElementById('fc-chunk-reveal-tokens')
  const bubble = document.getElementById('fc-chunk-reveal-bubble')
  const btnReveal = document.getElementById('fc-btn-chunk-reveal')

  if (!hasChunks) { chunkRevealWrap.style.display = 'none'; return }
  chunkRevealWrap.style.display = 'block'

  let panelBuilt = false
  function buildPanel() {
    if (panelBuilt) return
    panelBuilt = true
    tokensEl.innerHTML = ''
    bubble.style.display = 'none'
    card.chunks.forEach((chunk, ci) => {
      if (ci > 0) {
        const sep = document.createElement('span')
        sep.className = 'chunk-sep'
        sep.textContent = '／'
        tokensEl.appendChild(sep)
      }
      const span = document.createElement('span')
      span.className = 'fc-chunk-lit'
      span.textContent = chunk.japanese_chunk || cleanChunkDisplay(chunk.spanish_chunk)
      span.addEventListener('click', (e) => {
        e.stopPropagation()
        tokensEl.querySelectorAll('.fc-chunk-lit').forEach(el => el.classList.remove('active'))
        span.classList.add('active')
        bubble.textContent = cleanChunkDisplay(chunk.spanish_chunk)
        bubble.style.display = 'block'
      })
      tokensEl.appendChild(span)
    })
    tokensEl.addEventListener('click', (e) => {
      if (e.target === tokensEl) {
        tokensEl.querySelectorAll('.fc-chunk-lit').forEach(el => el.classList.remove('active'))
        bubble.style.display = 'none'
      }
    })
  }

  const newBtn = btnReveal.cloneNode(true)
  btnReveal.parentNode.replaceChild(newBtn, btnReveal)
  newBtn.addEventListener('click', () => {
    const isOpen = chunkRevealPanel.style.display !== 'none'
    if (!isOpen) {
      buildPanel()
      chunkRevealPanel.style.display = 'flex'
      newBtn.textContent = '－ チャンク直訳'
      newBtn.classList.add('open')
    } else {
      chunkRevealPanel.style.display = 'none'
      newBtn.textContent = '＋ チャンク直訳'
      newBtn.classList.remove('open')
    }
  })
}

function renderFcBackES(card) {
  document.getElementById('fc-back-label').textContent = 'スペイン語'
  const contentEl = document.getElementById('fc-back-content')
  const bubble = document.getElementById('fc-back-bubble')
  contentEl.innerHTML = ''
  bubble.style.display = 'none'

  if (!card.chunks || card.chunks.length === 0) {
    contentEl.textContent = cleanChunkDisplay(card.spanish_display || '')
    return
  }

  let activeChunkEl = null
  function resetAll() {
    if (activeChunkEl) {
      activeChunkEl.textContent = activeChunkEl.dataset.orig
      activeChunkEl.classList.remove('active')
    }
    contentEl.querySelectorAll('.fc-chunk-token').forEach(el => el.classList.remove('active'))
    bubble.style.display = 'none'
    activeChunkEl = null
  }
  function showBubble(text) {
    if (!text) { bubble.style.display = 'none'; return }
    bubble.textContent = text
    bubble.style.display = 'block'
  }

  card.chunks.forEach((chunk, ci) => {
    if (ci > 0) contentEl.appendChild(document.createTextNode(' '))
    const raw = normalizeRaw(chunk.spanish_raw || chunk.spanish_chunk)
    const tokens = parseTokens(raw)
    const leafTokens = getLeafTokens(tokens)
    const hasSubTokens = leafTokens.length > 1 ||
      (leafTokens.length === 1 && leafTokens[0].type !== 'word')

    const chunkSpan = document.createElement('span')
    chunkSpan.className = 'fc-chunk-token'
    chunkSpan.dataset.orig = cleanChunkDisplay(chunk.spanish_chunk)
    chunkSpan.textContent = cleanChunkDisplay(chunk.spanish_chunk)

    chunkSpan.addEventListener('click', (e) => {
      e.stopPropagation()
      if (activeChunkEl && activeChunkEl !== chunkSpan) {
        activeChunkEl.textContent = activeChunkEl.dataset.orig
        activeChunkEl.classList.remove('active')
        contentEl.querySelectorAll('.fc-chunk-token').forEach(el => el.classList.remove('active'))
        bubble.style.display = 'none'
        activeChunkEl = null
      }
      if (activeChunkEl === chunkSpan) { resetAll(); return }
      activeChunkEl = chunkSpan
      chunkSpan.classList.add('active')
      showBubble(chunk.japanese_chunk || cleanChunkDisplay(chunk.spanish_chunk))
      if (hasSubTokens) expandChunkToSubs(chunkSpan, leafTokens, card.vocab, bubble, showBubble)
    })

    contentEl.appendChild(chunkSpan)
  })

  contentEl.addEventListener('click', (e) => { if (e.target === contentEl) resetAll() })
}

document.getElementById('fc-btn-flip').addEventListener('click', () => {
  const isEsJp = fcActiveMode === 'es_jp'
  const card = fcQueue[fcIndex]

  if (!isEsJp) {
    const inputVal = document.getElementById('fc-card-input').value.trim()
    const wrapEl = document.getElementById('fc-user-answer-wrap')
    const textareaEl = document.getElementById('fc-user-answer-text')
    if (inputVal) {
      textareaEl.value = inputVal
      wrapEl.style.display = 'flex'
    } else {
      wrapEl.style.display = 'none'
    }
  }

  document.getElementById('fc-front').style.display = 'none'
  const back = document.getElementById('fc-back')
  back.style.display = 'flex'
  back.style.animation = 'none'
  requestAnimationFrame(() => { back.style.animation = 'fadeInCard 0.25s ease' })

  if (!isEsJp) renderFcBackES(card)
})

document.getElementById('fc-btn-maru').addEventListener('click', () => judgeFlashcard('○'))
document.getElementById('fc-btn-sankaku').addEventListener('click', () => judgeFlashcard('△'))
document.getElementById('fc-btn-batsu').addEventListener('click', () => judgeFlashcard('×'))

function judgeFlashcard(result) {
  const card = fcQueue[fcIndex]
  fcResults[card.id] = result
  if (!(card.id in fcFirstResults)) fcFirstResults[card.id] = result

  if (result === '○') {
    nextFlashcardCard()
  } else {
    fcQueue.push(card)
    nextFlashcardCard()
  }
}

function nextFlashcardCard() {
  fcIndex++
  if (fcIndex >= fcQueue.length) {
    showFlashcardPassResult()
  } else {
    renderFlashcardCard()
  }
}

function updateFlashcardProgress() {
  const doneCount = Object.values(fcResults).filter(r => r === '○').length
  const pct = fcTotal > 0 ? (doneCount / fcTotal) * 100 : 0
  document.getElementById('fc-progress-fill').style.width = pct + '%'
  const remaining = fcQueue.length - fcIndex
  document.getElementById('fc-progress-text').textContent = `残り ${remaining} 枚`
}

function showFlashcardPassResult() {
  stopFlashcardAudio()
  document.getElementById('fc-card-mode-wrap').style.display = 'none'
  document.getElementById('fc-result-view').style.display = 'block'

  const maru = Object.values(fcFirstResults).filter(r => r === '○').length
  const sankaku = Object.values(fcFirstResults).filter(r => r === '△').length
  const batsu = Object.values(fcFirstResults).filter(r => r === '×').length

  document.getElementById('fc-result-title').textContent =
    (fcActiveMode === 'es_jp' ? 'ES→JP' : 'JP→ES') + ' 完了'

  document.getElementById('fc-result-stats').innerHTML = `
    <div><span class="stat-maru">${maru}</span> ○ わかった</div>
    <div><span class="stat-sankaku">${sankaku}</span> △ なんとなく</div>
    <div><span class="stat-batsu">${batsu}</span> × わからなかった</div>
  `

  const reviewCards = fcQueue.length ? Object.keys(fcFirstResults)
    .map(id => (itemSentenceMap[fcActiveItem.id] || []).find(c => c.id === id))
    .filter(c => c && (fcFirstResults[c.id] === '△' || fcFirstResults[c.id] === '×')) : []

  const missedEl = document.getElementById('fc-result-missed')
  missedEl.innerHTML = ''

  if (reviewCards.length > 0) {
    const title = document.createElement('div')
    title.className = 'result-missed-title'
    title.textContent = `△・× だったセンテンス（${reviewCards.length}件）`
    missedEl.appendChild(title)

    reviewCards.forEach(c => {
      const r = fcFirstResults[c.id] || ''
      const badgeColor = r === '△' ? 'var(--earth)' : 'var(--accent)'
      const item = document.createElement('div')
      item.className = 'result-missed-item'
      item.innerHTML = `
        <div style="display:flex;align-items:baseline;gap:8px">
          <span style="color:${badgeColor};font-size:1rem">${r}</span>
          <span>${cleanChunkDisplay(c.spanish_display || '')}</span>
        </div>
        ${c.japanese ? `<div class="result-missed-jp">${c.japanese}</div>` : ''}
      `
      missedEl.appendChild(item)
    })
  }

  document.getElementById('fc-btn-continue').textContent = '一覧に戻る →'
  document.getElementById('fc-btn-continue').onclick = onFlashcardPassContinue
}

async function onFlashcardPassContinue() {
  await markFlashcardDone(fcActiveItem.id, fcActiveMode)
  fcActiveItem = null
  fcActiveMode = null
  renderOverview()
}

// ============================================================
// テキスト解析ユーティリティ
// ============================================================

function parseTokens(raw) {
  const tokens = []
  let i = 0
  while (i < raw.length) {
    if (raw[i] === '"') {
      const end = raw.indexOf('"', i + 1)
      const text = raw.slice(i + 1, end === -1 ? raw.length : end).trim()
      tokens.push({ type: 'silent', text })
      i = end === -1 ? raw.length : end + 1
    } else if (raw[i] === '[') {
      const end = findClosing(raw, i, '[', ']')
      const inner = raw.slice(i + 1, end).trim()
      const children = parseInnerTokens(inner)
      const displayText = stripSymbolsLight(inner)
      tokens.push({ type: 'phrase', text: displayText, displayText, children })
      i = end + 1
    } else if (raw[i] === '(') {
      const end = findClosing(raw, i, '(', ')')
      const text = raw.slice(i + 1, end).trim()
      const cleanText = text.replace(/^[¿¡\s]+|[?!.,;:\s]+$/g, '').trim()
      tokens.push({ type: 'expression', text: cleanText, displayText: cleanText })
      i = end + 1
    } else if (raw[i] === '/') {
      tokens.push({ type: 'sep' })
      i++
    } else if (raw[i] === ' ') {
      i++
    } else {
      let j = i
      while (j < raw.length && !' []()/"'.includes(raw[j])) j++
      const rawText = raw.slice(i, j)
      const text = stripPunctuation(rawText)
      if (text) tokens.push({ type: 'word', text, displayText: rawText })
      i = j
    }
  }
  return tokens
}

function parseInnerTokens(raw) {
  const tokens = []
  let i = 0
  while (i < raw.length) {
    if (raw[i] === '(') {
      const end = findClosing(raw, i, '(', ')')
      tokens.push({ type: 'expression', text: raw.slice(i + 1, end).trim() })
      i = end + 1
    } else if (raw[i] === ' ') { i++ }
    else {
      let j = i
      while (j < raw.length && !' ()'.includes(raw[j])) j++
      const rawText = raw.slice(i, j)
      const text = stripPunctuation(rawText)
      if (text) tokens.push({ type: 'word', text, displayText: rawText })
      i = j
    }
  }
  return tokens
}

function getLeafTokens(tokens, parentText) {
  const result = []
  tokens.forEach(t => {
    if (t.type === 'silent' || t.type === 'sep') return
    if (t.type === 'phrase' && t.children && t.children.length > 0) {
      result.push(...getLeafTokens(t.children, t.text))
    } else {
      result.push({ ...t, parentText: parentText || null })
    }
  })
  return result
}

function findClosing(str, start, open, close) {
  let depth = 0
  for (let i = start; i < str.length; i++) {
    if (str[i] === open) depth++
    if (str[i] === close) { depth--; if (depth === 0) return i }
  }
  return str.length - 1
}

function stripSymbolsLight(str) {
  return str.replace(/[\[\](){}\|"]/g, '').replace(/\s+/g, ' ').trim()
}

function stripPunctuation(text) {
  return text.replace(/^[¿¡\s]+|[?!.,;:\s]+$/g, '').trim()
}

function cleanChunkDisplay(text) {
  if (!text) return ''
  return text
    .replace(/[\[\](){}\|"]/g, '')
    .replace(/¿|¡/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeRaw(raw) {
  if (!raw) return ''
  return raw.replace(/\{/g, '[').replace(/\}/g, ']')
}

function expandChunkToSubs(chunkSpan, leafTokens, vocabMap, bubble, showBubble) {
  chunkSpan.innerHTML = ''
  chunkSpan.classList.add('active')

  leafTokens.forEach((token, ti) => {
    if (ti > 0) chunkSpan.appendChild(document.createTextNode(' '))
    const subSpan = document.createElement('span')
    subSpan.className = `fc-sub-token ${token.type}`
    subSpan.textContent = token.displayText || token.text
    if (token.type !== 'silent') {
      subSpan.addEventListener('click', (e) => {
        e.stopPropagation()
        chunkSpan.querySelectorAll('.fc-sub-token').forEach(el => el.classList.remove('active'))
        subSpan.classList.add('active')
        const meaning = vocabMap[token.text] || ''
        showBubble(meaning ? `${token.text} — ${meaning}` : token.text)
      })
    }
    chunkSpan.appendChild(subSpan)
  })
}

// ============================================================
// 起動
// ============================================================

;(async () => {
  await checkAuth()
  const ok = await loadData()
  if (!ok) return
  document.getElementById('loading-msg').style.display = 'none'
  renderOverview()
})()
