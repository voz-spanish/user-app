const SUPABASE_URL = 'https://nsprbshgkxywtwmimkcy.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zcHJic2hna3h5d3R3bWlta2N5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzMzMxMDAsImV4cCI6MjA5MzkwOTEwMH0.g51y4rq3xEDYD9GJoux7UDBeOpXyqYLDptwQ3LHy6b8'

// resetPasswordForEmail のメールリンクには access_token が含まれており、
// supabase-jsがURLから自動でセッションを復元します(detectSessionInUrl: true がデフォルト)
const { createClient } = supabase
const db = createClient(SUPABASE_URL, SUPABASE_KEY)

const passwordInput = document.getElementById('password')
const passwordConfirmInput = document.getElementById('password-confirm')
const updateBtn = document.getElementById('update-btn')
const msg = document.getElementById('msg')

function setupToggle(toggleId, inputEl) {
  const toggle = document.getElementById(toggleId)
  toggle.addEventListener('click', () => {
    const isHidden = inputEl.type === 'password'
    inputEl.type = isHidden ? 'text' : 'password'
    toggle.textContent = isHidden ? '🙈' : '👁'
  })
}
setupToggle('password-toggle', passwordInput)
setupToggle('password-confirm-toggle', passwordConfirmInput)

let recoverySessionReady = false

db.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') {
    recoverySessionReady = true
  }
})

// リンク経由でのアクセスかどうかを一応チェック(念のためのフォールバック)
setTimeout(async () => {
  const { data } = await db.auth.getSession()
  if (data && data.session) recoverySessionReady = true

  if (!recoverySessionReady) {
    msg.className = 'msg msg--error'
    msg.textContent = 'リンクの有効期限が切れているか、無効なリンクです。もう一度パスワード再設定をお試しください。'
    updateBtn.disabled = true
  }
}, 800)

updateBtn.addEventListener('click', async () => {
  const password = passwordInput.value.trim()
  const passwordConfirm = passwordConfirmInput.value.trim()
  msg.className = 'msg'
  msg.textContent = ''

  if (!password || !passwordConfirm) {
    msg.className = 'msg msg--error'
    msg.textContent = 'すべての項目を入力してください'
    return
  }
  if (password.length < 8) {
    msg.className = 'msg msg--error'
    msg.textContent = 'パスワードは8文字以上で入力してください'
    return
  }
  if (password !== passwordConfirm) {
    msg.className = 'msg msg--error'
    msg.textContent = 'パスワードが一致しません'
    return
  }

  updateBtn.disabled = true
  updateBtn.textContent = '更新中...'

  const { error } = await db.auth.updateUser({ password })

  if (error) {
    msg.className = 'msg msg--error'
    msg.textContent = 'パスワードの更新に失敗しました。もう一度お試しください。'
    updateBtn.disabled = false
    updateBtn.textContent = 'パスワードを更新する'
    return
  }

  msg.className = 'msg msg--success'
  msg.textContent = 'パスワードを更新しました。ログイン画面に移動します。'

  setTimeout(() => {
    window.location.href = 'user-login.html'
  }, 2000)
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') updateBtn.click()
})
