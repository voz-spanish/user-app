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
   今日の質問
   TODO: 本実装では questions テーブル(または類似)から
   ・today の日付、あるいは
   ・そのユーザーがまだ回答していない質問
   を1件取得するクエリに差し替える。
   今は「動作確認用のダミー質問」を表示している。
===================================================== */
async function loadTodayQuestion() {
  const card = document.getElementById('question-card')
  const textEl = document.getElementById('question-text')

  // --- ダミーデータ(差し替え予定) ---
  const dummyQuestion = {
    id: 'dummy-1',
    text: '¿Qué hiciste el fin de semana pasado?',
  }
  // ----------------------------------

  // 本実装イメージ(コメントアウト):
  // const today = new Date().toISOString().slice(0,10)
  // const { data, error } = await db.from('questions').select('*').eq('date', today).limit(1).single()

  textEl.textContent = dummyQuestion.text
  card.classList.remove('loading')

  card.addEventListener('click', () => {
    window.location.href = `../user-question/user-question.html?id=${dummyQuestion.id}`
  })
}

/* =====================================================
   レッスンおすすめ(続きから/最近完了)
   lesson_plan_progress を updated_at 降順で取得し、
   紐づく lesson_plan_sets(タイトル・BOX・センテンス構成)から
   user-lesson.js と同じロジックで進捗％を計算して表示する。
   →「進行中」「完了」どちらも updated_at が新しい順に並ぶので、
   　自然と「続きから／最近完了」の順になる。
===================================================== */
async function loadRecommendedLessons() {
  const scroll = document.getElementById('lesson-scroll')

  const { data: { user } } = await db.auth.getUser()

  const { data: progressRows, error } = await db
    .from('lesson_plan_progress')
    .select(`
      status, completed_sentence_ids, completed_flashcards, updated_at,
      lesson_plan_sets (
        id, title, flashcard_es_jp, flashcard_jp_es, status,
        lesson_plan_items ( id, lesson_plan_sentences ( id ) )
      )
    `)
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(5)

  if (error) {
    console.error(error)
    scroll.innerHTML = '<p class="empty-note">レッスンの読み込みに失敗しました</p>'
    return
  }

  // 削除済み/非公開になったプランや、プランと紐づかない行は除外
  const rows = (progressRows || []).filter(
    row => row.lesson_plan_sets && row.lesson_plan_sets.status === 'saved'
  )

  scroll.innerHTML = ''

  if (rows.length === 0) {
    scroll.innerHTML = '<p class="empty-note">まだレッスンの記録がありません</p>'
    return
  }

  rows.forEach(row => {
    const plan = row.lesson_plan_sets
    const items = plan.lesson_plan_items || []

    const doneSentenceIds = new Set(row.completed_sentence_ids || [])
    const doneFlashcards = row.completed_flashcards || {}

    // 総ユニット数(全センテンス＋各BOXのフラッシュカード)と完了済みユニット数を計算
    let totalUnits = 0
    let doneUnits = 0
    items.forEach(item => {
      const sentences = item.lesson_plan_sentences || []
      totalUnits += sentences.length
      sentences.forEach(s => { if (doneSentenceIds.has(s.id)) doneUnits++ })

      const modes = []
      if (plan.flashcard_es_jp) modes.push('es_jp')
      if (plan.flashcard_jp_es) modes.push('jp_es')
      modes.forEach(m => {
        totalUnits += 1
        if (doneFlashcards[`${item.id}:${m}`]) doneUnits += 1
      })
    })

    const pct = totalUnits > 0 ? Math.min(100, Math.round((doneUnits / totalUnits) * 100)) : 0
    const isDone = row.status === 'completed'

    const card = document.createElement('div')
    card.className = 'lesson-card'
    card.innerHTML = `
      <div class="lesson-card-tag${isDone ? ' done' : ''}">
        ${isDone ? '完了' : '進行中'}
      </div>
      <div class="lesson-card-title">${plan.title || '（タイトル未設定）'}</div>
      <div class="lesson-progress-track">
        <div class="lesson-progress-fill" style="width:${pct}%"></div>
      </div>
    `
    card.addEventListener('click', () => {
      window.location.href = `../user-lesson/play/play.html?plan_id=${plan.id}`
    })
    scroll.appendChild(card)
  })
}

/* =====================================================
   ヘッダー右上の通知ドット
   TODO: announce テーブルの「未読アナウンスの有無」に差し替える
===================================================== */
async function loadNotifBadge() {
  const hasUnread = true // ダミー: 本実装ではDBから判定
  document.getElementById('notif-dot').classList.toggle('show', hasUnread)
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

;(async () => {
  await checkAuth()
  initDrawer()
  initNotifButton()
  await Promise.all([
    loadTodayQuestion(),
    loadRecommendedLessons(),
    loadNotifBadge(),
  ])
})()
