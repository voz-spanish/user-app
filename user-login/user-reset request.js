const SUPABASE_URL = 'https://nsprbshgkxywtwmimkcy.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zcHJic2hna3h5d3R3bWlta2N5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzMzMxMDAsImV4cCI6MjA5MzkwOTEwMH0.g51y4rq3xEDYD9GJoux7UDBeOpXyqYLDptwQ3LHy6b8'

const { createClient } = supabase
const db = createClient(SUPABASE_URL, SUPABASE_KEY)

const emailInput = document.getElementById('email')
const resetBtn = document.getElementById('reset-btn')
const msg = document.getElementById('msg')

// メール内リンクのリダイレクト先（新パスワード設定画面）
// 実際に配置するパスに合わせて調整してください
const REDIRECT_URL = new URL('user-reset-confirm.html', window.location.href).toString()

resetBtn.addEventListener('click', async () => {
  const email = emailInput.value.trim()
  msg.className = 'msg'
  msg.textContent = ''

  if (!email) {
    msg.className = 'msg msg--error'
    msg.textContent = 'メールアドレスを入力してください'
    return
  }

  resetBtn.disabled = true
  resetBtn.textContent = '送信中...'

  await db.auth.resetPasswordForEmail(email, { redirectTo: REDIRECT_URL })

  // セキュリティ上、メールが登録されているかどうかに関わらず
  // 同じメッセージを表示します（登録有無の推測を防ぐため）
  msg.className = 'msg msg--success'
  msg.textContent = '入力されたメールアドレスが登録されている場合、再設定用のメールをお送りしました。'

  resetBtn.disabled = false
  resetBtn.textContent = '再設定メールを送る'
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') resetBtn.click()
})
