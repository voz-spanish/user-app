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
   TODO: 本実装では lessons テーブルと、ユーザーごとの
   進捗テーブル(例: user_lesson_progress)を join し、
   ・進行中のレッスン
   ・最近完了したレッスン
   の順で数件取得するクエリに差し替える。
===================================================== */
async function loadRecommendedLessons() {
  const scroll = document.getElementById('lesson-scroll')

  // --- ダミーデータ(差し替え予定) ---
  const dummyLessons = [
    { id: 1, title: '基本の挨拶と自己紹介', progress: 60, status: 'progress' },
    { id: 2, title: '過去形の使い方(規則動詞)', progress: 100, status: 'done' },
    { id: 3, title: 'レストランでの注文', progress: 20, status: 'progress' },
  ]
  // ----------------------------------

  // 本実装イメージ(コメントアウト):
  // const { data, error } = await db
  //   .from('user_lesson_progress')
  //   .select('progress, lessons(id, title)')
  //   .order('updated_at', { ascending: false })
  //   .limit(5)

  scroll.innerHTML = ''

  if (dummyLessons.length === 0) {
    scroll.innerHTML = '<p class="empty-note">まだレッスンの記録がありません</p>'
    return
  }

  dummyLessons.forEach(lesson => {
    const card = document.createElement('div')
    card.className = 'lesson-card'
    card.innerHTML = `
      <div class="lesson-card-tag${lesson.status === 'done' ? ' done' : ''}">
        ${lesson.status === 'done' ? '完了' : '進行中'}
      </div>
      <div class="lesson-card-title">${lesson.title}</div>
      <div class="lesson-progress-track">
        <div class="lesson-progress-fill" style="width:${lesson.progress}%"></div>
      </div>
    `
    card.addEventListener('click', () => {
      window.location.href = `../user-lesson/user-lesson.html?id=${lesson.id}`
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
