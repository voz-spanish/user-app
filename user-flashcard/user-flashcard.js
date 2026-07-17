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
  const groups = [...allCategories, { id: null, name: 'その他' }]

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

;(async () => {
  await checkAuth()
  initDrawer()
  initNotifButton()
  initTrainingUI()
  await fetchAll()
  renderList()
  loadNotifBadge()
})()
