const SUPABASE_URL = 'https://nsprbshgkxywtwmimkcy.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zcHJic2hna3h5d3R3bWlta2N5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzMzMxMDAsImV4cCI6MjA5MzkwOTEwMH0.g51y4rq3xEDYD9GJoux7UDBeOpXyqYLDptwQ3LHy6b8'
const { createClient } = supabase
const db = createClient(SUPABASE_URL, SUPABASE_KEY)

async function checkAuth() {
  const { data: { session } } = await db.auth.getSession()
  if (!session) window.location.href = '../user-login/user-login.html'
  return session
}

/* =====================================================
   ユーザーのプラン判定
   TODO: 本実装ではユーザーのサブスクリプション状態
   (例: profiles テーブルの plan カラムなど)から取得する。
   今は仮に 'plus' 固定にしている。
===================================================== */
function getUserPlan() {
  return 'plus' // 'free' | 'plus' | 'max'
}

function canView(scope) {
  const order = { free: 0, plus: 1, max: 2 }
  if (scope === 'draft') return false
  return order[scope] <= order[getUserPlan()]
}

let allCategories = []
let allSets = []
let allCards = []
let setCardMap = {} // set_id -> [card, ...]

async function fetchAll() {
  const [catsRes, setsRes, cardsRes, mapRes] = await Promise.all([
    db.from('categories').select('*').order('name'),
    db.from('flashcard_sets').select('*').neq('scope', 'draft').order('name'),
    db.from('cards').select('*').neq('scope', 'draft'),
    db.from('flashcard_set_cards').select('set_id, card_id, excluded').eq('excluded', false)
  ])
  if (!catsRes.error) allCategories = catsRes.data
  if (!setsRes.error) allSets = setsRes.data
  if (!cardsRes.error) allCards = cardsRes.data

  const cardById = {}
  allCards.forEach(c => { cardById[c.id] = c })

  setCardMap = {}
  if (!mapRes.error) {
    mapRes.data.forEach(row => {
      const card = cardById[row.card_id]
      if (!card) return // 非公開カード、または権限外のカードは除外
      if (!setCardMap[row.set_id]) setCardMap[row.set_id] = []
      setCardMap[row.set_id].push(card)
    })
  }
}

/* =====================================================
   一覧描画(カテゴリごとにセットをグループ表示)
===================================================== */
function renderList() {
  const wrap = document.getElementById('category-groups')
  const empty = document.getElementById('empty-msg')
  wrap.innerHTML = ''

  if (allSets.length === 0) {
    empty.style.display = 'block'
    return
  }
  empty.style.display = 'none'

  // カテゴリ未設定のセットも「その他」としてまとめる
  // ※「レッスン」という名前のカテゴリは、レッスン素材一覧(lp-list-group)の
  //   見出しと名前が重複してしまうため、ここでは除外する
  const groups = [...allCategories, { id: null, name: 'その他' }]
    .filter(cat => cat.name !== 'レッスン')

  groups.forEach(cat => {
    const sets = allSets.filter(s => (s.category_id || null) === cat.id)
    if (sets.length === 0) return

    const groupEl = document.createElement('div')
    groupEl.className = 'category-group'

    const title = document.createElement('p')
    title.className = 'category-title'
    title.textContent = cat.name
    groupEl.appendChild(title)

    sets.forEach(set => {
      const cards = setCardMap[set.id] || []
      const locked = !canView(set.scope)

      const row = document.createElement('div')
      row.className = 'set-row'
      row.innerHTML = `
        <span class="set-row-name">${set.name}</span>
        <span class="set-row-meta">
          ${locked ? `<span class="lock-badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="10" rx="1"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
            ${set.scope}
          </span>` : `<span class="set-row-count">${cards.length}枚</span>`}
        </span>
      `
      row.addEventListener('click', () => {
        if (locked) {
          alert('このフラッシュカードは上位プランで利用できます')
          return
        }
        if (cards.length === 0) {
          alert('このフラッシュカードにはまだカードがありません')
          return
        }
        startTraining(set, cards)
      })
      groupEl.appendChild(row)
    })

    wrap.appendChild(groupEl)
  })
}

/* =====================================================
   トレーニング画面
===================================================== */
let deck = []
let totalCount = 0
let knownCount = 0
let currentCard = null
let currentSetName = ''

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function startTraining(set, cards) {
  deck = shuffle(cards)
  totalCount = deck.length
  knownCount = 0
  currentSetName = set.name

  document.getElementById('view-list').classList.add('hidden')
  document.getElementById('view-complete').classList.remove('active')
  document.getElementById('view-training').classList.add('active')
  document.getElementById('training-set-name').textContent = currentSetName

  nextCard()
}

function nextCard() {
  if (deck.length === 0) {
    finishTraining()
    return
  }
  currentCard = deck.shift()
  updateProgress()
  showFront()
}

function updateProgress() {
  document.getElementById('training-progress').textContent = `${knownCount} / ${totalCount}`
  const pct = totalCount === 0 ? 0 : Math.round((knownCount / totalCount) * 100)
  document.getElementById('progress-fill').style.width = `${pct}%`
}

function showFront() {
  document.getElementById('flip-card-inner').classList.remove('flipped')
  document.getElementById('training-actions').classList.remove('show')
  document.getElementById('training-hint-tap').style.display = 'block'

  document.getElementById('flip-front').innerHTML = `
    <span class="flip-word">${currentCard.spanish}</span>
  `
  document.getElementById('flip-back').innerHTML = `
    <span class="flip-word">${currentCard.japanese}</span>
    ${currentCard.example ? `<span class="flip-example">${currentCard.example}</span>` : ''}
    ${currentCard.hint ? `<span class="flip-hint">${currentCard.hint}</span>` : ''}
  `
}

function flipCard() {
  const inner = document.getElementById('flip-card-inner')
  const isFlipped = inner.classList.toggle('flipped')
  if (isFlipped) {
    document.getElementById('training-actions').classList.add('show')
    document.getElementById('training-hint-tap').style.display = 'none'
  }
}

function markKnown() {
  knownCount++
  updateProgress()
  nextCard()
}

function markRetry() {
  deck.push(currentCard) // デッキの最後に回す
  nextCard()
}

function finishTraining() {
  document.getElementById('view-training').classList.remove('active')
  document.getElementById('view-complete').classList.add('active')
  document.getElementById('complete-sub').textContent =
    `「${currentSetName}」を ${totalCount}枚 覚えました`
}

function exitTraining() {
  document.getElementById('view-training').classList.remove('active')
  document.getElementById('view-complete').classList.remove('active')
  document.getElementById('view-list').classList.remove('hidden')
}

function initTrainingUI() {
  document.getElementById('flip-card').addEventListener('click', flipCard)
  document.getElementById('btn-known').addEventListener('click', markKnown)
  document.getElementById('btn-retry').addEventListener('click', markRetry)
  document.getElementById('btn-exit-training').addEventListener('click', exitTraining)
  document.getElementById('btn-complete-back').addEventListener('click', exitTraining)
  document.getElementById('btn-complete-retry').addEventListener('click', () => {
    const set = allSets.find(s => s.name === currentSetName)
    const cards = set ? (setCardMap[set.id] || []) : []
    document.getElementById('view-complete').classList.remove('active')
    document.getElementById('view-training').classList.add('active')
    startTraining(set, cards)
  })
}

function initDrawer() {
  document.getElementById('burger-btn').addEventListener('click', () => {
    document.getElementById('drawer').classList.toggle('open')
    document.getElementById('drawer-overlay').classList.toggle('open')
  })
  document.getElementById('drawer-overlay').addEventListener('click', () => {
    document.getElementById('drawer').classList.remove('open')
    document.getElementById('drawer-overlay').classList.remove('open')
  })
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await db.auth.signOut()
    window.location.href = '../user-login/user-login.html'
  })
}

function initNotifButton() {
  document.getElementById('btn-notif').addEventListener('click', () => {
    window.location.href = '../user-announce/user-announce.html'
  })
}

/* =====================================================
   ヘッダー右上の通知ドット
   TODO: announce テーブルの「未読アナウンスの有無」に差し替える
===================================================== */
async function loadNotifBadge() {
  const hasUnread = false // ダミー: 本実装ではDBから判定
  document.getElementById('notif-dot').classList.toggle('show', hasUnread)
}

/* =====================================================
   レッスン フラッシュカード（練習専用・進捗には反映しません）
   既存の「単語/テーマ」フラッシュカードとは別の仕組みとして、
   保存済みのレッスンプラン(lesson_plan_sets)を自動で一覧表示し、
   毎回 ES→JP / JP→ES を選んでレッスンプレイ画面と同じ操作感で
   練習できるようにする。
===================================================== */

// 「レッスンプラン」単位ではなく、プランに含まれる「レッスン素材」ごとに
// タイトルで束ねて一覧表示する。同じタイトルの素材が複数プランに含まれる
// 場合は1つに統合し、センテンスも重複排除してまとめる。
let allLessonMaterials = [] // [{ title, sentences:[...], sentenceCount }]

async function fetchLessonPlans() {
  const { data, error } = await db
    .from('lesson_plan_sets')
    .select(`
      id, title, updated_at,
      lesson_plan_items (
        id, order_index,
        audio_materials ( id, title, type, youtube_id, audio_url ),
        lesson_plan_sentences (
          id, order_index,
          audio_sentences ( id, sentence_number, spanish_display, japanese, start_sec, end_sec )
        )
      )
    `)
    .eq('status', 'saved')
    .order('updated_at', { ascending: false })

  if (error) {
    console.error(error)
    allLessonMaterials = []
    return
  }

  // タイトルごとにセンテンスを束ねる（同一タイトルは統合・センテンスは重複排除）
  const byTitle = {} // title -> { title, sentencesById:{}, order:[] }

  ;(data || []).forEach(plan => {
    const items = [...(plan.lesson_plan_items || [])].sort((a, b) => a.order_index - b.order_index)

    items.forEach(item => {
      const material = item.audio_materials
      const title = material?.title || '（タイトル未設定）'

      const sentences = [...(item.lesson_plan_sentences || [])]
        .sort((a, b) => a.order_index - b.order_index)
        .filter(s => s.audio_sentences)
        .map(s => ({
          id: s.audio_sentences.id,
          sentence_number: s.audio_sentences.sentence_number,
          spanish_display: s.audio_sentences.spanish_display,
          japanese: s.audio_sentences.japanese,
          start_sec: s.audio_sentences.start_sec,
          end_sec: s.audio_sentences.end_sec,
          material
        }))

      if (!byTitle[title]) byTitle[title] = { title, sentencesById: {}, order: [] }
      sentences.forEach(s => {
        if (!byTitle[title].sentencesById[s.id]) {
          byTitle[title].sentencesById[s.id] = s
          byTitle[title].order.push(s.id)
        }
      })
    })
  })

  allLessonMaterials = Object.values(byTitle)
    .map(g => {
      const sentences = g.order.map(id => g.sentencesById[id])
      return { title: g.title, sentences, sentenceCount: sentences.length }
    })
    .filter(m => m.sentenceCount > 0)
    .sort((a, b) => a.title.localeCompare(b.title, 'ja'))
}

function renderLessonGroup() {
  const groupEl = document.getElementById('lp-list-group')
  const wrap = document.getElementById('lp-list')
  wrap.innerHTML = ''

  if (allLessonMaterials.length === 0) {
    groupEl.style.display = 'none'
    return
  }
  groupEl.style.display = 'block'

  allLessonMaterials.forEach(material => {
    const row = document.createElement('div')
    row.className = 'set-row'
    row.innerHTML = `
      <span class="set-row-name">${material.title}</span>
      <span class="set-row-meta">
        <span class="set-row-count">${material.sentenceCount}枚</span>
      </span>
    `
    row.addEventListener('click', () => openLpModeSelect(material))
    wrap.appendChild(row)
  })
}

/* ----- モード選択 ----- */
let lpActivePlan = null
let lpActiveMode = null

function openLpModeSelect(material) {
  lpActivePlan = material // 現在選択中の「レッスン素材」グループ（変数名は既存のまま流用）
  document.getElementById('view-list').classList.add('hidden')
  document.getElementById('view-lp-mode').style.display = 'block'
  document.getElementById('lp-mode-title').textContent = material.title
}

function closeLpModeSelect() {
  document.getElementById('view-lp-mode').style.display = 'none'
  document.getElementById('view-list').classList.remove('hidden')
}

function initLpModeSelectUI() {
  document.getElementById('lp-mode-back').addEventListener('click', closeLpModeSelect)
  document.getElementById('lp-mode-es-jp').addEventListener('click', () => startLpSession('es_jp'))
  document.getElementById('lp-mode-jp-es').addEventListener('click', () => startLpSession('jp_es'))
}

/* ----- チャンク/語彙の読み込み(初回のみ・遅延読み込み) ----- */
async function ensureLpSentencesLoaded(material) {
  if (material._sentencesFlat) return material._sentencesFlat

  const flat = material.sentences.map(s => ({ ...s }))

  const ids = flat.map(s => s.id)
  if (ids.length > 0) {
    const [chunksRes, vocabRes] = await Promise.all([
      db.from('audio_sentence_chunks').select('*').in('sentence_id', ids).order('sort_order'),
      db.from('audio_sentence_vocab').select('*').in('sentence_id', ids)
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
    flat.forEach(s => { s.chunks = chunksMap[s.id] || []; s.vocab = vocabMap[s.id] || {} })
  }

  material._sentencesFlat = flat
  return flat
}

/* ----- YouTube / 音声 再生(レッスンプレイ画面と同じ挙動) ----- */
let lpYtPlayer = null
let lpYtReady = false
let lpCurrentPlayTimer = null
let lpPendingPlayCard = null
let lpPendingPlayBtn = null
let lpAudioEl = null

window.onYouTubeIframeAPIReady = () => {
  lpYtPlayer = new YT.Player('yt-player-hidden', {
    height: '1', width: '1',
    videoId: '',
    playerVars: { playsinline: 1, rel: 0, autoplay: 0 },
    events: {
      onReady: () => { lpYtReady = true },
      onStateChange: (e) => {
        if (e.data === YT.PlayerState.PLAYING && lpPendingPlayCard) {
          const card = lpPendingPlayCard
          const btn = lpPendingPlayBtn
          lpPendingPlayCard = null
          lpPendingPlayBtn = null
          if (lpCurrentPlayTimer) clearTimeout(lpCurrentPlayTimer)
          const duration = (card.end_sec - card.start_sec) * 1000
          btn.classList.add('playing')
          btn.textContent = '■ 再生中'
          lpCurrentPlayTimer = setTimeout(() => {
            try { lpYtPlayer.pauseVideo() } catch (e) {}
            btn.classList.remove('playing')
            btn.textContent = '▶ 再生'
            lpCurrentPlayTimer = null
          }, duration)
        }
      }
    }
  })
}

function loadLpYouTubeAPI() {
  if (document.getElementById('yt-api-script')) return
  const tag = document.createElement('script')
  tag.id = 'yt-api-script'
  tag.src = 'https://www.youtube.com/iframe_api'
  document.head.appendChild(tag)
}

function playLpAudio(card, btn) {
  if (!card.material || card.start_sec == null || card.end_sec == null) return
  if (card.material.type === 'youtube' && card.material.youtube_id) {
    playLpAudioYouTube(card, btn)
  } else if (card.material.type === 'mp3' && card.material.audio_url) {
    playLpAudioMp3(card, btn)
  }
}

function playLpAudioYouTube(card, btn) {
  if (!lpYtPlayer || !lpYtReady) return
  stopLpMp3()
  if (lpCurrentPlayTimer) { clearTimeout(lpCurrentPlayTimer); lpCurrentPlayTimer = null }

  btn.textContent = '読込中…'
  btn.classList.remove('playing')
  lpPendingPlayCard = card
  lpPendingPlayBtn = btn

  let currentVideoId = ''
  try { currentVideoId = lpYtPlayer.getVideoData()?.video_id || '' } catch (e) {}

  if (currentVideoId === card.material.youtube_id) {
    lpYtPlayer.seekTo(card.start_sec, true)
    lpYtPlayer.playVideo()
  } else {
    lpYtPlayer.loadVideoById({ videoId: card.material.youtube_id, startSeconds: card.start_sec })
  }
}

function ensureLpAudioEl() {
  if (!lpAudioEl) {
    lpAudioEl = document.createElement('audio')
    lpAudioEl.id = 'lp-audio-hidden'
    lpAudioEl.style.display = 'none'
    document.body.appendChild(lpAudioEl)
  }
  return lpAudioEl
}

function stopLpMp3() {
  if (!lpAudioEl) return
  if (lpAudioEl._autoStopHandler) {
    lpAudioEl.removeEventListener('timeupdate', lpAudioEl._autoStopHandler)
    lpAudioEl._autoStopHandler = null
  }
  lpAudioEl.pause()
}

function playLpAudioMp3(card, btn) {
  lpPendingPlayCard = null
  lpPendingPlayBtn = null
  if (lpCurrentPlayTimer) { clearTimeout(lpCurrentPlayTimer); lpCurrentPlayTimer = null }
  try { if (lpYtPlayer) lpYtPlayer.pauseVideo() } catch (e) {}

  const audio = ensureLpAudioEl()
  stopLpMp3()

  const startPlayback = () => {
    audio.currentTime = card.start_sec
    audio.play()
    btn.classList.add('playing')
    btn.textContent = '■ 再生中'
    const handler = () => {
      if (audio.currentTime >= card.end_sec) {
        audio.pause()
        audio.removeEventListener('timeupdate', handler)
        audio._autoStopHandler = null
        btn.classList.remove('playing')
        btn.textContent = '▶ 再生'
      }
    }
    audio._autoStopHandler = handler
    audio.addEventListener('timeupdate', handler)
  }

  if (audio.src === card.material.audio_url && audio.readyState >= 1) {
    startPlayback()
  } else {
    btn.textContent = '読込中…'
    audio.src = card.material.audio_url
    audio.addEventListener('loadedmetadata', startPlayback, { once: true })
    audio.load()
  }
}

function stopLpAudio() {
  lpPendingPlayCard = null
  lpPendingPlayBtn = null
  if (lpCurrentPlayTimer) { clearTimeout(lpCurrentPlayTimer); lpCurrentPlayTimer = null }
  try { if (lpYtPlayer) lpYtPlayer.pauseVideo() } catch (e) {}
  stopLpMp3()
  const btnF = document.getElementById('lp-btn-play-front')
  const btnB = document.getElementById('lp-btn-play-back')
  if (btnF) { btnF.classList.remove('playing'); btnF.textContent = '▶ 再生' }
  if (btnB) { btnB.classList.remove('playing'); btnB.textContent = '▶ 再生' }
}

/* ----- トレーニング本体(○△×判定・チャンク展開・音声再生) ----- */
let lpQueue = []
let lpIndex = 0
let lpResults = {}
let lpFirstResults = {}
let lpTotal = 0

async function startLpSession(mode) {
  lpActiveMode = mode
  const sentences = await ensureLpSentencesLoaded(lpActivePlan)

  if (sentences.some(s => s.material?.type === 'youtube' && s.material?.youtube_id)) {
    loadLpYouTubeAPI()
  }

  document.getElementById('view-lp-mode').style.display = 'none'
  document.getElementById('view-lp-training').style.display = 'flex'
  setTrainingFooterMode(true)
  startLpPass(sentences)
}

function startLpPass(sentences) {
  document.getElementById('lp-card-mode-wrap').style.display = 'block'
  document.getElementById('lp-result-view').style.display = 'none'

  lpQueue = [...sentences]
  lpIndex = 0
  lpResults = {}
  lpFirstResults = {}
  lpTotal = sentences.length

  if (lpTotal === 0) {
    showLpResult()
    return
  }

  document.getElementById('lp-mode-badge').textContent = lpActiveMode === 'es_jp' ? 'ES→JP' : 'JP→ES'
  renderLpCard()
}

function lpLabel(card) {
  return `センテンス ${card.sentence_number ?? ''}`
}

function renderLpCard() {
  const card = lpQueue[lpIndex]
  const isEsJp = lpActiveMode === 'es_jp'
  updateLpProgress()

  document.getElementById('lp-front').style.display = 'flex'
  document.getElementById('lp-back').style.display = 'none'
  document.getElementById('lp-card-input').value = ''
  document.getElementById('lp-front-bubble').style.display = 'none'
  document.getElementById('lp-back-bubble').style.display = 'none'
  document.getElementById('lp-user-answer-wrap').style.display = 'none'
  document.getElementById('lp-user-answer-text').value = ''

  document.getElementById('lp-front-chunk-reveal-wrap').style.display = 'none'
  document.getElementById('lp-chunk-reveal-panel').style.display = 'none'
  document.getElementById('lp-chunk-reveal-bubble').style.display = 'none'
  document.getElementById('lp-chunk-reveal-tokens').innerHTML = ''

  document.getElementById('lp-front-input-section').style.display = isEsJp ? 'none' : 'block'

  if (isEsJp) {
    renderLpFrontES(card)
    renderLpBackJP(card)
  } else {
    renderLpFrontJP(card)
    renderLpBackES(card)
  }

  const hasAudio =
    ((card.material?.type === 'youtube' && card.material?.youtube_id) ||
     (card.material?.type === 'mp3' && card.material?.audio_url)) &&
    card.start_sec != null && card.end_sec != null
  const frontAudioRow = document.getElementById('lp-front-audio-row')
  const backAudioRow = document.getElementById('lp-back-audio-row')

  if (hasAudio) {
    frontAudioRow.style.display = isEsJp ? 'flex' : 'none'
    backAudioRow.style.display = isEsJp ? 'none' : 'flex'
  } else {
    frontAudioRow.style.display = 'none'
    backAudioRow.style.display = 'none'
  }

  document.getElementById('lp-btn-play-front').onclick = () =>
    playLpAudio(card, document.getElementById('lp-btn-play-front'))
  document.getElementById('lp-btn-play-back').onclick = () =>
    playLpAudio(card, document.getElementById('lp-btn-play-back'))
}

function renderLpFrontES(card) {
  document.getElementById('lp-front-label').textContent = lpLabel(card)
  const contentEl = document.getElementById('lp-front-content')
  const bubble = document.getElementById('lp-front-bubble')
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

function renderLpBackJP(card) {
  document.getElementById('lp-back-label').textContent = '日本語の意味'
  document.getElementById('lp-back-content').innerHTML =
    `<div class="card-jp-natural">${card.japanese || '（未登録）'}</div>`
}

function renderLpFrontJP(card) {
  document.getElementById('lp-front-label').textContent = lpLabel(card)
  const contentEl = document.getElementById('lp-front-content')
  contentEl.innerHTML = ''

  const jpDiv = document.createElement('div')
  jpDiv.className = 'card-jp-natural'
  jpDiv.textContent = card.japanese || '（未登録）'
  contentEl.appendChild(jpDiv)

  const hasChunks = card.chunks && card.chunks.length > 0
  const chunkRevealWrap = document.getElementById('lp-front-chunk-reveal-wrap')
  const chunkRevealPanel = document.getElementById('lp-chunk-reveal-panel')
  const tokensEl = document.getElementById('lp-chunk-reveal-tokens')
  const bubble = document.getElementById('lp-chunk-reveal-bubble')
  const btnReveal = document.getElementById('lp-btn-chunk-reveal')

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

function renderLpBackES(card) {
  document.getElementById('lp-back-label').textContent = 'スペイン語'
  const contentEl = document.getElementById('lp-back-content')
  const bubble = document.getElementById('lp-back-bubble')
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

function updateLpProgress() {
  const doneCount = Object.values(lpResults).filter(r => r === '○').length
  const pct = lpTotal > 0 ? Math.round((doneCount / lpTotal) * 100) : 0
  document.getElementById('lp-progress-fill').style.width = pct + '%'
  const remaining = lpQueue.length - lpIndex
  document.getElementById('lp-progress-text').textContent = `残り ${remaining} 枚`
}

function judgeLpCard(result) {
  const card = lpQueue[lpIndex]
  lpResults[card.id] = result
  if (!(card.id in lpFirstResults)) lpFirstResults[card.id] = result

  if (result === '○') {
    nextLpCard()
  } else {
    lpQueue.push(card)
    nextLpCard()
  }
}

function nextLpCard() {
  lpIndex++
  if (lpIndex >= lpQueue.length) {
    showLpResult()
  } else {
    renderLpCard()
  }
}

function showLpResult() {
  stopLpAudio()
  document.getElementById('lp-card-mode-wrap').style.display = 'none'
  document.getElementById('lp-result-view').style.display = 'block'

  const maru    = Object.values(lpFirstResults).filter(r => r === '○').length
  const sankaku = Object.values(lpFirstResults).filter(r => r === '△').length
  const batsu   = Object.values(lpFirstResults).filter(r => r === '×').length

  document.getElementById('lp-result-stats').innerHTML = `
    <div><span class="stat-maru">${maru}</span> ○ わかった</div>
    <div><span class="stat-sankaku">${sankaku}</span> △ なんとなく</div>
    <div><span class="stat-batsu">${batsu}</span> × わからなかった</div>
  `

  const allFlat = lpActivePlan._sentencesFlat || []
  const reviewCards = allFlat.filter(c => {
    const r = lpFirstResults[c.id]
    return r === '△' || r === '×'
  })

  const missedEl = document.getElementById('lp-result-missed')
  missedEl.innerHTML = ''

  if (reviewCards.length > 0) {
    const title = document.createElement('div')
    title.className = 'result-missed-title'
    title.textContent = `△・× だったセンテンス（${reviewCards.length}件）`
    missedEl.appendChild(title)

    reviewCards.forEach(c => {
      const r = lpFirstResults[c.id] || ''
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
}

function backFromLpTraining() {
  stopLpAudio()
  document.getElementById('view-lp-training').style.display = 'none'
  document.getElementById('view-list').classList.remove('hidden')
  setTrainingFooterMode(false)
}

function initLpTrainingUI() {
  document.getElementById('lp-btn-flip').addEventListener('click', () => {
    if (lpActiveMode === 'jp_es') {
      const inputVal = document.getElementById('lp-card-input').value.trim()
      const wrapEl = document.getElementById('lp-user-answer-wrap')
      const textareaEl = document.getElementById('lp-user-answer-text')
      if (inputVal) {
        textareaEl.value = inputVal
        wrapEl.style.display = 'flex'
      } else {
        wrapEl.style.display = 'none'
      }
    }

    document.getElementById('lp-front').style.display = 'none'
    const back = document.getElementById('lp-back')
    back.style.display = 'flex'
    back.style.animation = 'none'
    requestAnimationFrame(() => { back.style.animation = 'fadeInCard 0.25s ease' })

    if (lpActiveMode === 'jp_es') renderLpBackES(lpQueue[lpIndex])
  })

  document.getElementById('lp-btn-maru').addEventListener('click', () => judgeLpCard('○'))
  document.getElementById('lp-btn-sankaku').addEventListener('click', () => judgeLpCard('△'))
  document.getElementById('lp-btn-batsu').addEventListener('click', () => judgeLpCard('×'))

  document.getElementById('lp-back-btn').addEventListener('click', backFromLpTraining)
  document.getElementById('lp-btn-back-list').addEventListener('click', backFromLpTraining)
  document.getElementById('lp-btn-retry-all').addEventListener('click', () => {
    startLpPass(lpActivePlan._sentencesFlat)
  })
}

/* ----- チャンク解析ユーティリティ(レッスンプレイ画面と同じロジック) ----- */
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
      while (j < raw.length && !' []()/\"'.includes(raw[j])) j++
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

/* =====================================================
   辞書検索パネル（フラッシュカード中に画面下からスライドイン）
   レッスンプレイ画面と同じ挙動。既存の canView()/getUserPlan() を再利用。
===================================================== */
let dictEntries = []
let dictLoaded = false

async function loadDictEntries() {
  if (dictLoaded) return
  const { data, error } = await db
    .from('dictionary_entries')
    .select('*, formats(name), parts_of_speech(name)')
    .neq('scope', 'draft')
    .order('spanish')

  if (error) {
    console.error(error)
    dictEntries = []
  } else {
    dictEntries = data || []
  }
  dictLoaded = true
}

function renderDictList(entries) {
  const list = document.getElementById('search-entry-list')
  const empty = document.getElementById('search-empty-msg')
  list.innerHTML = ''

  if (entries.length === 0) {
    empty.style.display = 'block'
    return
  }
  empty.style.display = 'none'

  entries.forEach(entry => {
    const li = document.createElement('li')
    li.className = 'entry-item'

    const formatName = entry.formats?.name || ''
    const posName = entry.parts_of_speech?.name || ''
    const locked = !canView(entry.scope)

    li.innerHTML = `
      <div class="entry-spanish">${entry.spanish}</div>
      <div class="entry-japanese">${entry.japanese}</div>
      <div class="entry-meta">
        ${formatName ? `<span class="format-badge">${formatName}</span>` : ''}
        ${posName ? `<span class="pos-badge">${posName}</span>` : ''}
        ${locked ? `<span class="lock-badge">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="10" rx="1"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
          ${entry.scope}
        </span>` : ''}
      </div>
    `

    li.addEventListener('click', () => openDictDetail(entry))
    list.appendChild(li)
  })
}

function applyDictFilter() {
  const q = document.getElementById('search-panel-input').value.trim().toLowerCase()
  let filtered = [...dictEntries]
  if (q) {
    filtered = filtered.filter(e =>
      e.spanish?.toLowerCase().includes(q) ||
      e.japanese?.toLowerCase().includes(q)
    )
  }
  renderDictList(filtered)
}

function openDictDetail(entry) {
  if (!canView(entry.scope)) {
    alert('この単語は上位プランで閲覧できます')
    return
  }

  const content = document.getElementById('search-detail-content')
  const formatName = entry.formats?.name || ''
  const posName = entry.parts_of_speech?.name || ''
  const data = entry.word_data || {}

  let html = `
    <div class="entry-meta" style="margin-bottom:8px">
      ${formatName ? `<span class="format-badge">${formatName}</span>` : ''}
      ${posName ? `<span class="pos-badge">${posName}</span>` : ''}
    </div>
    <div class="detail-spanish">${entry.spanish}</div>
    <div class="detail-japanese">${entry.japanese}</div>
  `

  if (entry.example) {
    html += `
      <div class="detail-section">
        <div class="detail-section-title">例文</div>
        <div class="detail-text">${entry.example}</div>
      </div>
    `
  }

  if (entry.hint) {
    html += `
      <div class="detail-section">
        <div class="detail-section-title">ヒント</div>
        <div class="detail-text">${entry.hint}</div>
      </div>
    `
  }

  if (data.noun) {
    html += `
      <div class="detail-section">
        <div class="detail-section-title">FORMAS CON ARTÍCULO</div>
        <table class="conjugation-table">
          <tr><th>単数</th><th>複数</th></tr>
          <tr><td>${data.noun.singular || ''}</td><td>${data.noun.plural || ''}</td></tr>
        </table>
      </div>
    `
  }

  if (data.adjective) {
    html += `
      <div class="detail-section">
        <div class="detail-section-title">FORMAS DEL ADJETIVO</div>
        <table class="conjugation-table">
          <tr><th></th><th>単数</th><th>複数</th></tr>
          <tr><td>男性</td><td>${data.adjective.ms || ''}</td><td>${data.adjective.mp || ''}</td></tr>
          <tr><td>女性</td><td>${data.adjective.fs || ''}</td><td>${data.adjective.fp || ''}</td></tr>
        </table>
      </div>
    `
  }

  if (data.article) {
    html += `
      <div class="detail-section">
        <div class="detail-section-title">使い方</div>
        <div class="detail-text">${data.article.usage || ''}</div>
      </div>
    `
  }

  if (data.pronoun) {
    html += `
      <div class="detail-section">
        <div class="detail-section-title">${data.pronoun.subtype || ''}</div>
        <div class="detail-text">${data.pronoun.memo || ''}</div>
      </div>
    `
  }

  const subjects = ['(yo)', '(tú)', '(él / ella / usted)', '(nosotros)', '(ellos / ellas / ustedes)']
  const renderConjugations = (list) => {
    list.forEach(tense => {
      if (!tense.rows || tense.rows.length === 0) return
      html += `
        <div class="detail-section">
          <div class="tense-title">${tense.tense}${tense.meaning ? ' — ' + tense.meaning : ''}</div>
          <table class="conjugation-table">
            <tr><th>主語</th><th>活用</th><th>例文</th><th>意味</th></tr>
            ${tense.rows.map((row, i) => `
              <tr>
                <td>${row.subject || subjects[i] || ''}</td>
                <td>${row.form || ''}</td>
                <td>${row.example || ''}</td>
                <td>${row.meaning || ''}</td>
              </tr>
            `).join('')}
          </table>
        </div>
      `
    })
  }

  if (data.conjugations && data.conjugations.length > 0) renderConjugations(data.conjugations)
  if (data.custom_conjugations && data.custom_conjugations.length > 0) renderConjugations(data.custom_conjugations)

  content.innerHTML = html
  document.getElementById('search-panel-body').style.display = 'none'
  document.getElementById('search-detail-body').style.display = 'block'
}

function showDictListView() {
  document.getElementById('search-detail-body').style.display = 'none'
  document.getElementById('search-panel-body').style.display = 'block'
}

async function openSearchPanel() {
  document.getElementById('search-panel-overlay').classList.add('open')
  showDictListView()
  if (!dictLoaded) {
    document.getElementById('search-empty-msg').style.display = 'none'
    await loadDictEntries()
    applyDictFilter()
  }
}

function closeSearchPanel() {
  document.getElementById('search-panel-overlay').classList.remove('open')
}

function toggleSearchPanel() {
  const isOpen = document.getElementById('search-panel-overlay').classList.contains('open')
  if (isOpen) {
    closeSearchPanel()
  } else {
    openSearchPanel()
  }
}

/* ----- レッスン フラッシュカード中のフッターナビ切り替え -----
   通常時: ホーム / レッスン / 質問 / 語彙 / 検索(辞書ページへのリンク)
   トレーニング中: ホーム / 語彙 / 検索(パネル開閉トグル) の3つに絞る */
let lpTrainingFooterActive = false

function setTrainingFooterMode(active) {
  lpTrainingFooterActive = active
  document.getElementById('footer-nav-lesson').style.display = active ? 'none' : ''
  document.getElementById('footer-nav-question').style.display = active ? 'none' : ''
  document.getElementById('footer-nav-dict').style.display = active ? 'none' : ''
  document.getElementById('footer-search-btn').style.display = active ? 'flex' : 'none'
  if (!active) closeSearchPanel()
}

function initDictSearchPanel() {
  document.getElementById('lp-search-btn').addEventListener('click', openSearchPanel)
  document.getElementById('footer-search-btn').addEventListener('click', toggleSearchPanel)
  document.getElementById('search-panel-close').addEventListener('click', closeSearchPanel)
  document.getElementById('search-panel-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'search-panel-overlay') closeSearchPanel()
  })
  document.getElementById('search-panel-input').addEventListener('input', applyDictFilter)
  document.getElementById('search-detail-back-btn').addEventListener('click', showDictListView)

  // トレーニング中に「語彙」タブを押した場合は、ページ遷移せず一覧に戻る
  document.getElementById('footer-nav-vocab').addEventListener('click', (e) => {
    if (lpTrainingFooterActive) {
      e.preventDefault()
      backFromLpTraining()
    }
  })
}

;(async () => {
  await checkAuth()
  initDrawer()
  initNotifButton()
  initTrainingUI()
  initLpModeSelectUI()
  initLpTrainingUI()
  initDictSearchPanel()
  await fetchAll()
  renderList()
  await fetchLessonPlans()
  renderLessonGroup()
  loadNotifBadge()
})()
