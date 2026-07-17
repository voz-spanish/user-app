const SUPABASE_URL = 'https://nsprbshgkxywtwmimkcy.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zcHJic2hna3h5d3R3bWlta2N5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzMzMxMDAsImV4cCI6MjA5MzkwOTEwMH0.g51y4rq3xEDYD9GJoux7UDBeOpXyqYLDptwQ3LHy6b8'
const { createClient } = supabase
const db = createClient(SUPABASE_URL, SUPABASE_KEY)

async function checkAuth() {
  const { data: { session } } = await db.auth.getSession()
  if (!session) window.location.href = '../user-login/user-login.html'
  return session
}

let allEntries = []
let allFormats = []
let allPOS = []
let filterOpen = false

/* =====================================================
   ユーザーのプラン判定
   TODO: 本実装ではユーザーのサブスクリプション状態
   (例: profiles テーブルの plan カラムなど)から取得する。
   今は仮に 'plus' 固定にしている。
===================================================== */
function getUserPlan() {
  return 'plus' // 'free' | 'plus' | 'max'
}

function canView(entryScope) {
  const order = { free: 0, plus: 1, max: 2 }
  const userPlan = getUserPlan()
  if (entryScope === 'draft') return false
  return order[entryScope] <= order[userPlan]
}

async function fetchAll() {
  const [entriesRes, formatsRes, posRes] = await Promise.all([
    db.from('dictionary_entries')
      .select('*, formats(name), parts_of_speech(name)')
      .neq('scope', 'draft')
      .order('spanish'),
    db.from('formats').select('*').order('name'),
    db.from('parts_of_speech').select('*').order('name')
  ])
  if (!entriesRes.error) allEntries = entriesRes.data
  if (!formatsRes.error) allFormats = formatsRes.data
  if (!posRes.error) allPOS = posRes.data
}

function populateFilters() {
  const formatSel = document.getElementById('filter-format')
  formatSel.innerHTML = '<option value="">すべて</option>'
  allFormats.forEach(f => {
    formatSel.innerHTML += `<option value="${f.id}">${f.name}</option>`
  })

  const posSel = document.getElementById('filter-pos')
  posSel.innerHTML = '<option value="">すべて</option>'
  allPOS.forEach(p => {
    posSel.innerHTML += `<option value="${p.id}">${p.name}</option>`
  })
}

function renderList(items) {
  const list = document.getElementById('entry-list')
  const empty = document.getElementById('empty-msg')
  list.innerHTML = ''

  if (items.length === 0) {
    empty.style.display = 'block'
    return
  }
  empty.style.display = 'none'

  items.forEach(entry => {
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

    li.addEventListener('click', () => openDetail(entry))
    list.appendChild(li)
  })
}

function openDetail(entry) {
  // TODO: 現プランで閲覧不可の場合は詳細を見せず、
  // アップグレード導線(プラン案内モーダルなど)に差し替える。
  if (!canView(entry.scope)) {
    alert('この単語は上位プランで閲覧できます')
    return
  }

  const content = document.getElementById('popup-detail-content')
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

  // 名詞：冠詞つき形式
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

  // 形容詞：性数変化
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

  // 冠詞：使い方
  if (data.article) {
    html += `
      <div class="detail-section">
        <div class="detail-section-title">使い方</div>
        <div class="detail-text">${data.article.usage || ''}</div>
      </div>
    `
  }

  // 代名詞：メモ
  if (data.pronoun) {
    html += `
      <div class="detail-section">
        <div class="detail-section-title">${data.pronoun.subtype || ''}</div>
        <div class="detail-text">${data.pronoun.memo || ''}</div>
      </div>
    `
  }

  // 動詞・助動詞：活用表
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
  openPopup('popup-detail-overlay')
}

function applyFilter() {
  const q = document.getElementById('search-input').value.trim().toLowerCase()
  const formatId = document.getElementById('filter-format').value
  const posId = document.getElementById('filter-pos').value

  let filtered = [...allEntries]
  if (q) {
    filtered = filtered.filter(e =>
      e.spanish?.toLowerCase().includes(q) ||
      e.japanese?.toLowerCase().includes(q)
    )
  }
  if (formatId) filtered = filtered.filter(e => e.format_id === formatId)
  if (posId) filtered = filtered.filter(e => e.pos_id === posId)

  renderList(filtered)
}

function openPopup(id) { document.getElementById(id).classList.add('open') }
function closePopup(id) { document.getElementById(id).classList.remove('open') }

function initFilterUI() {
  document.getElementById('search-input').addEventListener('input', applyFilter)
  document.getElementById('filter-format').addEventListener('change', applyFilter)
  document.getElementById('filter-pos').addEventListener('change', applyFilter)

  document.getElementById('filter-toggle-btn').addEventListener('click', () => {
    filterOpen = !filterOpen
    document.getElementById('filter-body').classList.toggle('open', filterOpen)
    document.getElementById('filter-toggle-btn').textContent = filterOpen ? '▼' : '▲'
  })

  document.getElementById('popup-detail-close').addEventListener('click', () => {
    closePopup('popup-detail-overlay')
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
  initFilterUI()
  await fetchAll()
  populateFilters()
  applyFilter()
  loadNotifBadge()
})()
