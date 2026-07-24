const SUPABASE_URL = 'https://nsprbshgkxywtwmimkcy.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zcHJic2hna3h5d3R3bWlta2N5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzMzMxMDAsImV4cCI6MjA5MzkwOTEwMH0.g51y4rq3xEDYD9GJoux7UDBeOpXyqYLDptwQ3LHy6b8'
const { createClient } = supabase
const db = createClient(SUPABASE_URL, SUPABASE_KEY)

async function checkAuth() {
  const { data: { session } } = await db.auth.getSession()
  if (!session) window.location.href = '../login/login.html'
  return session
}

let allPlans = []       // 公開済みレッスンプラン
let progressByPlan = {} // { plan_id: progressRow }

// ===== データ取得 =====
async function fetchAll() {
  const { data: { user } } = await db.auth.getUser()

  const { data: plans, error: plansError } = await db
    .from('lesson_plan_sets')
    .select(`
      id, title, flashcard_es_jp, flashcard_jp_es, updated_at,
      lesson_plan_items ( id, lesson_plan_sentences ( id ) )
    `)
    .eq('status', 'saved')
    .order('updated_at', { ascending: false })

  if (plansError) {
    console.error(plansError)
    allPlans = []
  } else {
    allPlans = plans || []
  }

  const { data: progressRows, error: progressError } = await db
    .from('lesson_plan_progress')
    .select('*')
    .eq('user_id', user.id)

  if (progressError) {
    console.error(progressError)
    progressByPlan = {}
  } else {
    progressByPlan = {}
    ;(progressRows || []).forEach(p => { progressByPlan[p.plan_id] = p })
  }
}

// ===== フィルター適用 =====
function applyFilter() {
  const q = document.getElementById('search-input').value.trim().toLowerCase()

  let filtered = [...allPlans]
  if (q) filtered = filtered.filter(p => p.title?.toLowerCase().includes(q))

  const inProgress = []
  const notStarted = []
  const done = []

  filtered.forEach(plan => {
    const progress = progressByPlan[plan.id]
    if (!progress) {
      notStarted.push(plan)
    } else if (progress.status === 'completed') {
      done.push(plan)
    } else {
      inProgress.push(plan)
    }
  })

  renderList('list-progress', 'empty-progress', inProgress, 'progress')
  renderList('list-new',      'empty-new',      notStarted, 'new')
  renderList('list-done',     'empty-done',     done,       'done')
}

// ===== リスト描画 =====
function renderList(listId, emptyId, plans, type) {
  const list  = document.getElementById(listId)
  const empty = document.getElementById(emptyId)
  list.innerHTML = ''

  if (plans.length === 0) {
    empty.style.display = 'block'
    return
  }
  empty.style.display = 'none'

  plans.forEach(plan => {
    const progress = progressByPlan[plan.id]
    const items = plan.lesson_plan_items || []
    const itemCount = items.length

    // 総ユニット数（全センテンス＋各レッスンのフラッシュカード）と、完了済みユニット数を計算
    const doneSentenceIds = new Set(progress?.completed_sentence_ids || [])
    const doneFlashcards = progress?.completed_flashcards || {}

    let totalUnits = 0
    let doneUnits = 0
    items.forEach(item => {
      const sentCount = item.lesson_plan_sentences?.length || 0
      totalUnits += sentCount
      ;(item.lesson_plan_sentences || []).forEach(s => {
        if (doneSentenceIds.has(s.id)) doneUnits++
      })
      const modes = []
      if (plan.flashcard_es_jp) modes.push('es_jp')
      if (plan.flashcard_jp_es) modes.push('jp_es')
      modes.forEach(m => {
        totalUnits += 1
        if (doneFlashcards[`${item.id}:${m}`]) doneUnits += 1
      })
    })

    const li = document.createElement('li')
    li.className = `plan-item ${type}`

    let metaLine = `レッスン ${itemCount}件`
    let actionLabel = 'はじめる'
    let progressBarHtml = ''

    if (type === 'progress') {
      const pct = totalUnits > 0 ? Math.min(100, Math.round((doneUnits / totalUnits) * 100)) : 0
      metaLine = `進捗 ${doneUnits} / ${totalUnits}`
      actionLabel = '開く'
      progressBarHtml = `
        <div class="plan-progress-track">
          <div class="plan-progress-fill" style="width:${pct}%"></div>
        </div>
      `
    } else if (type === 'done') {
      metaLine = `レッスン ${itemCount}件　／　完了`
      actionLabel = 'もう一度開く'
    }

    li.innerHTML = `
      <div class="plan-title">${plan.title || '（タイトル未設定）'}</div>
      <div class="plan-meta">${metaLine}</div>
      ${progressBarHtml}
      <div class="plan-actions">
        <button class="btn-plan-action">${actionLabel} →</button>
      </div>
    `

    li.querySelector('.btn-plan-action').addEventListener('click', () => {
      window.location.href = `play/play.html?plan_id=${plan.id}`
    })

    list.appendChild(li)
  })
}

// ===== イベント =====
document.getElementById('search-input').addEventListener('input', applyFilter)

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
  window.location.href = '../login/login.html'
})

// ===== 起動 =====
;(async () => {
  await checkAuth()
  await fetchAll()
  applyFilter()
})()
