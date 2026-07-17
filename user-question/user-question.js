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

let allQuestions = []
let allCategories = []
let filterOpen = false

const params = new URLSearchParams(location.search)
const deepLinkId = params.get('id')

async function fetchAll() {
  const [qRes, catRes] = await Promise.all([
    db.from('questions').select('*, question_categories(name)').neq('scope', 'draft').order('created_at', { ascending: false }),
    db.from('question_categories').select('*').order('name')
  ])
  if (!qRes.error) allQuestions = qRes.data
  if (!catRes.error) allCategories = catRes.data
}

function populateFilterCategory() {
  const sel = document.getElementById('filter-category')
  sel.innerHTML = '<option value="">すべて</option>'
  allCategories.forEach(c => {
    sel.innerHTML += `<option value="${c.id}">${c.name}</option>`
  })
}

function applyFilter() {
  const q = document.getElementById('search-input').value.trim().toLowerCase()
  const catId = document.getElementById('filter-category').value

  let filtered = [...allQuestions]
  if (q) {
    filtered = filtered.filter(item =>
      item.spanish_display?.toLowerCase().includes(q) ||
      item.tags?.some(t => t.toLowerCase().includes(q))
    )
  }
  if (catId) filtered = filtered.filter(item => item.category_id === catId)
  renderList(filtered)
}

function renderList(items) {
  const list = document.getElementById('question-list')
  const empty = document.getElementById('empty-msg')
  list.innerHTML = ''

  if (items.length === 0) {
    empty.style.display = 'block'
    return
  }
  empty.style.display = 'none'

  items.forEach(item => {
    const li = document.createElement('li')
    li.className = 'question-item'
    const catName = item.question_categories?.name || ''
    const tagsHtml = (item.tags || []).map(t => `<span class="tag-badge">${t}</span>`).join('')
    const locked = !canView(item.scope)

    li.innerHTML = `
      <div class="question-spanish">${item.spanish_display || item.spanish_raw}</div>
      <div class="question-meta">
        ${catName ? `<span class="category-badge">${catName}</span>` : ''}
        ${tagsHtml}
        ${locked ? `<span class="lock-badge">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="10" rx="1"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
          ${item.scope}
        </span>` : ''}
      </div>
    `
    li.addEventListener('click', () => openDetail(item))
    list.appendChild(li)
  })
}

/* =====================================================
   詳細(答え合わせ)画面
===================================================== */
async function openDetail(item) {
  if (!canView(item.scope)) {
    alert('この質問は上位プランで利用できます')
    return
  }

  document.getElementById('view-list').classList.add('hidden')
  document.getElementById('view-detail').classList.add('active')

  const [vocabRes, grammarRes, hintsRes, answersRes] = await Promise.all([
    db.from('question_vocab').select('*').eq('question_id', item.id).order('sort_order'),
    db.from('question_grammar').select('*').eq('question_id', item.id).order('sort_order'),
    db.from('question_hints').select('*').eq('question_id', item.id).order('sort_order'),
    db.from('answer_examples').select('*').eq('question_id', item.id).order('sort_order')
  ])

  const vocab = vocabRes.data || []
  const grammar = grammarRes.data || []
  const hints = hintsRes.data || []
  const answers = answersRes.data || []

  const catName = item.question_categories?.name || ''
  const tagsHtml = (item.tags || []).map(t => `<span class="tag-badge">${t}</span>`).join('')
  document.getElementById('detail-meta').innerHTML = `
    ${catName ? `<span class="category-badge">${catName}</span>` : ''}
    ${tagsHtml}
  `

  // 日本語訳
  document.getElementById('detail-japanese').textContent = item.japanese || ''

  // 自分の回答欄(セッション内だけの簡易下書き保存)
  const ownAnswerInput = document.getElementById('own-answer-input')
  const draftKey = `voz_answer_draft_${item.id}`
  ownAnswerInput.value = sessionStorage.getItem(draftKey) || ''
  ownAnswerInput.oninput = () => {
    sessionStorage.setItem(draftKey, ownAnswerInput.value)
  }
  // TODO: 本実装ではセッション限りではなく、Supabaseに
  // (question_id, user_id, content) で保存し、後から見返せるようにする。

  // 語彙
  const vocabSection = document.getElementById('section-vocab')
  if (vocab.length > 0) {
    vocabSection.style.display = 'block'
    document.getElementById('body-vocab').innerHTML = vocab.map(v => `
      <div class="vocab-item">
        <span class="vocab-spanish">${v.spanish}</span>
        <span class="vocab-meaning">${v.selected_meaning || ''}</span>
      </div>
    `).join('')
  } else {
    vocabSection.style.display = 'none'
  }

  // 文法ポイント
  const grammarSection = document.getElementById('section-grammar')
  if (grammar.length > 0) {
    grammarSection.style.display = 'block'
    document.getElementById('body-grammar').innerHTML = grammar.map(g => `
      <div class="grammar-item">
        <div class="grammar-spanish">${g.spanish}</div>
        <div class="grammar-explanation">${g.explanation || ''}</div>
      </div>
    `).join('')
  } else {
    grammarSection.style.display = 'none'
  }

  // ヒント
  const hintsSection = document.getElementById('section-hints')
  if (hints.length > 0) {
    hintsSection.style.display = 'block'
    document.getElementById('body-hints').innerHTML = hints.map(h => `
      <div class="hint-item">
        <span class="vocab-spanish">${h.spanish || ''}</span>
        <span class="vocab-meaning">${h.japanese || ''}</span>
      </div>
    `).join('')
  } else {
    hintsSection.style.display = 'none'
  }

  // 回答例
  const answersSection = document.getElementById('section-answers')
  if (answers.length > 0) {
    answersSection.style.display = 'block'
    document.getElementById('body-answers').innerHTML = answers.map(a => `
      <div class="answer-item">
        <div class="answer-level">${a.level === 'simple' ? 'シンプル' : '詳細'}</div>
        <div>${a.content}</div>
      </div>
    `).join('')
  } else {
    answersSection.style.display = 'none'
  }

  // 答え合わせセクションは毎回閉じた状態からスタート
  ;['japanese', 'vocab', 'grammar', 'hints', 'answers'].forEach(key => {
    document.getElementById(`body-${key}`)?.classList.remove('open')
  })

  renderPreview(item, vocab)
}

function exitDetail() {
  document.getElementById('view-detail').classList.remove('active')
  document.getElementById('view-list').classList.remove('hidden')
  // URLにidが付いていた場合は消しておく(ブラウザバック対策)
  if (deepLinkId) history.replaceState(null, '', location.pathname)
}

/* =====================================================
   インタラクティブプレビュー(単語タップで意味表示)
===================================================== */
function renderPreview(item, vocab) {
  const container = document.getElementById('preview-wrap')
  const bubble = document.getElementById('preview-bubble')
  const raw = item.spanish_raw || ''
  const tokens = parseTokens(raw)
  const vocabMap = buildVocabMap(vocab)

  container.innerHTML = ''
  let activeToken = null

  tokens.forEach(token => {
    if (token.type === 'space') {
      container.appendChild(document.createTextNode(' '))
      return
    }
    const span = buildTokenSpan(token, vocabMap, bubble, container)
    container.appendChild(span)
  })

  container.onclick = () => {
    container.querySelectorAll('.preview-token').forEach(t => t.classList.remove('active'))
    bubble.style.display = 'none'
  }
}

function buildTokenSpan(token, vocabMap, bubble, container) {
  const span = document.createElement('span')
  span.className = `preview-token ${token.type}`
  span.textContent = token.text

  span.addEventListener('click', (e) => {
    e.stopPropagation()
    container.querySelectorAll('.preview-token').forEach(t => t.classList.remove('active'))
    span.classList.add('active')

    const meaning = vocabMap[token.text] || vocabMap[normalizeSpanish(token.text)] || ''

    if (token.type === 'phrase' && token.children) {
      span.innerHTML = ''
      token.children.forEach((child, i) => {
        if (i > 0) span.appendChild(document.createTextNode(' '))
        span.appendChild(buildTokenSpan(child, vocabMap, bubble, container))
      })
    }

    if (meaning) {
      bubble.textContent = `${token.text} — ${meaning}`
      bubble.style.display = 'inline-block'
    } else {
      bubble.style.display = 'none'
    }
  })

  return span
}

function parseTokens(raw) {
  const tokens = []
  let i = 0
  while (i < raw.length) {
    if (raw[i] === '[') {
      const end = findClosing(raw, i, '[', ']')
      const inner = raw.slice(i + 1, end)
      tokens.push({ type: 'phrase', text: stripSymbols(inner), children: parseTokens(inner) })
      i = end + 1
    } else if (raw[i] === '(') {
      const end = findClosing(raw, i, '(', ')')
      const inner = raw.slice(i + 1, end)
      tokens.push({ type: 'expression', text: stripSymbols(inner) })
      i = end + 1
    } else if (raw[i] === ' ') {
      tokens.push({ type: 'space', text: ' ' })
      i++
    } else {
      let j = i
      while (j < raw.length && !' []()'.includes(raw[j])) j++
      const text = raw.slice(i, j)
      if (text) tokens.push({ type: 'word', text })
      i = j
    }
  }
  return tokens
}

function findClosing(str, start, open, close) {
  let depth = 0
  for (let i = start; i < str.length; i++) {
    if (str[i] === open) depth++
    if (str[i] === close) { depth--; if (depth === 0) return i }
  }
  return str.length - 1
}

function stripSymbols(str) { return str.replace(/[\[\]()]/g, '').trim() }
function normalizeSpanish(text) { return text.toLowerCase().replace(/[¿?¡!.,;:]/g, '').trim() }

function buildVocabMap(vocab) {
  const map = {}
  vocab.forEach(v => { if (v.spanish && v.selected_meaning) map[v.spanish] = v.selected_meaning })
  return map
}

/* =====================================================
   段階的に見せる(答え合わせ)トグル
===================================================== */
function initRevealToggles() {
  const pairs = [
    ['toggle-japanese', 'body-japanese', '日本語訳を見る'],
    ['toggle-vocab', 'body-vocab', '語彙を見る'],
    ['toggle-grammar', 'body-grammar', '文法ポイントを見る'],
    ['toggle-hints', 'body-hints', '💡 ヒントを見る'],
    ['toggle-answers', 'body-answers', '回答例を見る'],
  ]
  pairs.forEach(([btnId, bodyId, label]) => {
    const btn = document.getElementById(btnId)
    const body = document.getElementById(bodyId)
    btn.addEventListener('click', () => {
      const isOpen = body.classList.toggle('open')
      btn.textContent = `${label} ${isOpen ? '▲' : '▼'}`
    })
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

async function loadNotifBadge() {
  const hasUnread = false // ダミー: 本実装ではDBから判定
  document.getElementById('notif-dot').classList.toggle('show', hasUnread)
}

;(async () => {
  await checkAuth()
  initDrawer()
  initNotifButton()
  initRevealToggles()
  document.getElementById('search-input').addEventListener('input', applyFilter)
  document.getElementById('filter-category').addEventListener('change', applyFilter)
  document.getElementById('filter-toggle-btn').addEventListener('click', () => {
    filterOpen = !filterOpen
    document.getElementById('filter-body').classList.toggle('open', filterOpen)
    document.getElementById('filter-toggle-btn').textContent = filterOpen ? '▼' : '▲'
  })
  document.getElementById('btn-exit-detail').addEventListener('click', exitDetail)

  await fetchAll()
  populateFilterCategory()
  applyFilter()
  loadNotifBadge()

  // ホーム画面などからの直リンク(?id=...)があれば自動で詳細を開く
  if (deepLinkId) {
    const target = allQuestions.find(q => q.id === deepLinkId)
    if (target) openDetail(target)
  }
})()
