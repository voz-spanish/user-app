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

/* =====================================================
   既読管理
   localStorageに既読IDを保存する簡易実装。
   TODO: 本実装ではSupabase側(例: announcement_reads テーブルで
   user_id, announcement_id)に保存し、複数端末でも既読が
   同期されるようにする。他ページのヘッダー通知ドットも
   このキー(voz_seen_announcements)を参照すれば連動する。
===================================================== */
const SEEN_KEY = 'voz_seen_announcements'

function getSeenIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'))
  } catch {
    return new Set()
  }
}

function markSeen(id) {
  const seen = getSeenIds()
  seen.add(id)
  localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]))
}

let allAnnouncements = []

function getStatus(item) {
  const now = new Date()
  const start = new Date(item.publish_start)
  const end = item.publish_end ? new Date(item.publish_end) : null
  if (now < start) return 'scheduled'
  if (end && now > end) return 'ended'
  return 'active'
}

function formatDatetime(str) {
  if (!str) return ''
  const d = new Date(str)
  return d.toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

async function fetchAnnouncements() {
  const { data, error } = await db
    .from('announcements')
    .select('*')
    .neq('scope', 'draft')
    .order('publish_start', { ascending: false })
  if (!error) {
    // 公開期間内、かつユーザーのプランで閲覧可能なもののみ
    allAnnouncements = data.filter(a => getStatus(a) === 'active' && canView(a.scope))
  }
}

function renderList(items) {
  const list = document.getElementById('announce-list')
  const empty = document.getElementById('empty-msg')
  list.innerHTML = ''

  if (items.length === 0) {
    empty.style.display = 'block'
    return
  }
  empty.style.display = 'none'

  const seen = getSeenIds()

  items.forEach(item => {
    const isUnread = !seen.has(item.id)
    const li = document.createElement('li')
    li.className = 'announce-item'
    li.innerHTML = `
      ${isUnread ? '<span class="unread-dot"></span>' : ''}
      <div class="announce-title">${item.title}</div>
      <div class="announce-content">${item.content || ''}</div>
      <div class="announce-meta">
        <span class="announce-period">${formatDatetime(item.publish_start)}</span>
      </div>
    `
    li.addEventListener('click', () => openDetail(item))
    list.appendChild(li)
  })
}

function applySearch() {
  const q = document.getElementById('search-input').value.trim().toLowerCase()
  if (!q) { renderList(allAnnouncements); return }
  const filtered = allAnnouncements.filter(a =>
    a.title?.toLowerCase().includes(q) ||
    a.content?.toLowerCase().includes(q)
  )
  renderList(filtered)
}

function openDetail(item) {
  document.getElementById('detail-title').textContent = item.title
  document.getElementById('detail-period').textContent = formatDatetime(item.publish_start)
  document.getElementById('detail-content').textContent = item.content || ''
  const urlEl = document.getElementById('detail-url')
  urlEl.textContent = item.url || ''
  urlEl.href = item.url || ''

  markSeen(item.id)
  renderList(allAnnouncements) // 未読ドットを消すため再描画

  openPopup('popup-detail-overlay')
}

function openPopup(id) { document.getElementById(id).classList.add('open') }
function closePopup(id) { document.getElementById(id).classList.remove('open') }

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

;(async () => {
  await checkAuth()
  initDrawer()
  document.getElementById('search-input').addEventListener('input', applySearch)
  document.getElementById('popup-detail-close').addEventListener('click', () => closePopup('popup-detail-overlay'))

  await fetchAnnouncements()
  renderList(allAnnouncements)
})()
