;(function () {
'use strict'

const SUPABASE_URL = 'https://nsprbshgkxywtwmimkcy.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zcHJic2hna3h5d3R3bWlta2N5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzMzMxMDAsImV4cCI6MjA5MzkwOTEwMH0.g51y4rq3xEDYD9GJoux7UDBeOpXyqYLDptwQ3LHy6b8'
const { createClient } = supabase
const db = createClient(SUPABASE_URL, SUPABASE_KEY)

async function checkAuth() {
  const { data: { session } } = await db.auth.getSession()
  if (!session) window.location.href = '../login/login.html'
  return session
}

let currentUser = null
let allPlans = []       // 公開済みレッスンプラン
let progressByPlan = {} // { plan_id: progressRow }
let completions = []    // 完了履歴(同じプランを何度完了しても1回ごとに1件)
let currentTab = 'myplan'

// ===== データ取得 =====
async function fetchAll() {
  const { data: { user } } = await db.auth.getUser()
  currentUser = user

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

  await Promise.all([fetchProgress(), fetchCompletions()])
}

async function fetchProgress() {
  const { data: progressRows, error: progressError } = await db
    .from('lesson_plan_progress')
    .select('*')
    .eq('user_id', currentUser.id)

  if (progressError) {
    console.error(progressError)
    progressByPlan = {}
  } else {
    progressByPlan = {}
    ;(progressRows || []).forEach(p => { progressByPlan[p.plan_id] = p })
  }
}

async function fetchCompletions() {
  const { data, error } = await db
    .from('lesson_plan_completions')
    .select(`
      id, completed_at,
      lesson_plan_sets ( id, title )
    `)
    .eq('user_id', currentUser.id)
    .order('completed_at', { ascending: false })

  if (error) {
    console.error(error)
    completions = []
  } else {
    completions = data || []
  }
}

// ===== 進捗集計(センテンス＋フラッシュカード) =====
function computeUnits(plan, progress) {
  const items = plan.lesson_plan_items || []
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
  return { totalUnits, doneUnits }
}

// ===== タブ切り替え =====
function switchTab(tab) {
  currentTab = tab
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab)
  })
  document.getElementById('panel-myplan').style.display = tab === 'myplan' ? 'block' : 'none'
  document.getElementById('panel-find').style.display = tab === 'find' ? 'block' : 'none'
  document.getElementById('panel-completed').style.display = tab === 'completed' ? 'block' : 'none'
  applyFilter()
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab))
})

// ===== フィルター適用 =====
function applyFilter() {
  const q = document.getElementById('search-input').value.trim().toLowerCase()
  let filtered = [...allPlans]
  if (q) filtered = filtered.filter(p => p.title?.toLowerCase().includes(q))

  if (currentTab === 'myplan') {
    const myPlans = filtered.filter(p => progressByPlan[p.id]?.status === 'in_progress')
    renderMyPlanList(myPlans)
  } else if (currentTab === 'find') {
    renderFindList(filtered)
  } else if (currentTab === 'completed') {
    let filteredCompletions = [...completions]
    if (q) {
      filteredCompletions = filteredCompletions.filter(c =>
        c.lesson_plan_sets?.title?.toLowerCase().includes(q)
      )
    }
    renderCompletedList(filteredCompletions)
  }
}

document.getElementById('search-input').addEventListener('input', applyFilter)

// ===== マイプラン(進行中) =====
function renderMyPlanList(plans) {
  const list = document.getElementById('list-myplan')
  const empty = document.getElementById('empty-myplan')
  list.innerHTML = ''

  if (plans.length === 0) {
    empty.style.display = 'block'
    return
  }
  empty.style.display = 'none'

  plans.forEach(plan => {
    const progress = progressByPlan[plan.id]
    const items = plan.lesson_plan_items || []
    const { totalUnits, doneUnits } = computeUnits(plan, progress)
    const pct = totalUnits > 0 ? Math.min(100, Math.round((doneUnits / totalUnits) * 100)) : 0

    const li = document.createElement('li')
    li.className = 'plan-item progress'
    li.innerHTML = `
      <div class="plan-title">${plan.title || '（タイトル未設定）'}</div>
      <div class="plan-meta">進捗 ${doneUnits} / ${totalUnits}　(レッスン ${items.length}件)</div>
      <div class="plan-progress-track">
        <div class="plan-progress-fill" style="width:${pct}%"></div>
      </div>
      <div class="plan-actions">
        <button class="btn-plan-action">開く →</button>
      </div>
    `
    li.querySelector('.btn-plan-action').addEventListener('click', () => goToPlan(plan.id))
    list.appendChild(li)
  })
}

// ===== プランを見つける(全プラン・アコーディオン) =====
function renderFindList(plans) {
  const list = document.getElementById('list-find')
  const empty = document.getElementById('empty-find')
  list.innerHTML = ''

  if (plans.length === 0) {
    empty.style.display = 'block'
    return
  }
  empty.style.display = 'none'

  plans.forEach(plan => {
    const progress = progressByPlan[plan.id]
    const items = plan.lesson_plan_items || []
    const status = progress?.status === 'completed' ? 'completed'
      : progress?.status === 'in_progress' ? 'in_progress'
      : 'new'

    const statusClass = status === 'in_progress' ? 'progress' : status === 'completed' ? 'done' : 'new'
    const actionLabel = status === 'new' ? '開始する'
      : status === 'in_progress' ? '続ける'
      : 'もう一度挑戦する'

    let statsHtml = `レッスン ${items.length}件`
    if (status === 'in_progress') {
      const { totalUnits, doneUnits } = computeUnits(plan, progress)
      statsHtml += `<br>進捗 ${doneUnits} / ${totalUnits}`
    } else if (status === 'completed') {
      statsHtml += `<br>完了済み(もう一度挑戦すると最初からやり直せます)`
    }

    const li = document.createElement('li')
    li.className = `plan-item ${statusClass}`
    li.innerHTML = `
      <div class="plan-item-head">
        <div class="plan-title">${plan.title || '（タイトル未設定）'}</div>
        <div class="plan-meta">レッスン ${items.length}件${status === 'in_progress' ? '　／　進行中' : status === 'completed' ? '　／　完了済み' : ''}</div>
      </div>
      <div class="plan-expand" style="display:none">
        <div class="plan-expand-stats">${statsHtml}</div>
        <div class="plan-actions">
          <button class="btn-plan-action">${actionLabel} →</button>
        </div>
      </div>
    `

    const expandEl = li.querySelector('.plan-expand')
    li.querySelector('.plan-item-head').addEventListener('click', () => {
      expandEl.style.display = expandEl.style.display === 'none' ? 'flex' : 'none'
    })

    li.querySelector('.btn-plan-action').addEventListener('click', async (e) => {
      e.stopPropagation()
      const btn = e.currentTarget
      btn.disabled = true
      await startPlan(plan.id, progress)
      btn.disabled = false
    })

    list.appendChild(li)
  })
}

// ===== 完了日(完了履歴を完了日順に。同じプランでも完了するたびに1件ずつ表示) =====
function renderCompletedList(rows) {
  const list = document.getElementById('list-completed')
  const empty = document.getElementById('empty-completed')
  list.innerHTML = ''

  // 念のため取得後にも日付降順で並べ直す
  const sorted = [...rows].sort(
    (a, b) => new Date(b.completed_at || 0) - new Date(a.completed_at || 0)
  )

  if (sorted.length === 0) {
    empty.style.display = 'block'
    return
  }
  empty.style.display = 'none'

  sorted.forEach(row => {
    const plan = row.lesson_plan_sets
    if (!plan) return // プランが削除済みなどの場合はスキップ

    const dateStr = row.completed_at
      ? new Date(row.completed_at).toLocaleDateString('ja-JP')
      : '―'

    const li = document.createElement('li')
    li.className = 'plan-item completed completed-row'
    li.innerHTML = `
      <div class="plan-title">${plan.title || '（タイトル未設定）'}</div>
      <div class="plan-completed-date">${dateStr} 完了</div>
    `
    li.addEventListener('click', () => goToPlan(plan.id))
    list.appendChild(li)
  })
}

// ===== プラン開始/継続/再挑戦 =====
async function startPlan(planId, existingProgress) {
  try {
    if (existingProgress && existingProgress.status === 'in_progress') {
      // そのまま続きから
      goToPlan(planId)
      return
    }

    if (existingProgress) {
      // 完了済み → 0からやり直す
      const { data, error } = await db
        .from('lesson_plan_progress')
        .update({
          status: 'in_progress',
          completed_sentence_ids: [],
          completed_flashcards: {},
          completed_at: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingProgress.id)
        .select()
        .single()

      if (error) throw error
      progressByPlan[planId] = data
    } else {
      // 初めて開始
      const { data, error } = await db
        .from('lesson_plan_progress')
        .insert({
          plan_id: planId,
          user_id: currentUser.id,
          status: 'in_progress',
          completed_sentence_ids: [],
          completed_flashcards: {}
        })
        .select()
        .single()

      if (error) throw error
      progressByPlan[planId] = data
    }

    goToPlan(planId)
  } catch (err) {
    console.error(err)
    alert('プランの開始に失敗しました。もう一度お試しください。')
  }
}

function goToPlan(planId) {
  window.location.href = `play/play.html?plan_id=${planId}`
}

// ===== ドロワー / ログアウト =====
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
  switchTab('myplan')
})()

})();
