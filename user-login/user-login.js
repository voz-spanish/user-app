const SUPABASE_URL = 'https://nsprbshgkxywtwmimkcy.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zcHJic2hna3h5d3R3bWlta2N5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzMzMxMDAsImV4cCI6MjA5MzkwOTEwMH0.g51y4rq3xEDYD9GJoux7UDBeOpXyqYLDptwQ3LHy6b8'

const { createClient } = supabase
const db = createClient(SUPABASE_URL, SUPABASE_KEY)

const emailInput = document.getElementById('email')
const passwordInput = document.getElementById('password')
const passwordToggle = document.getElementById('password-toggle')
const loginBtn = document.getElementById('login-btn')
const msg = document.getElementById('msg')
const msgLinks = document.getElementById('msg-links')
const linkReset = document.getElementById('link-reset')
const linkSignup = document.getElementById('link-signup')

// パスワード表示切り替え
passwordToggle.addEventListener('click', () => {
  const isHidden = passwordInput.type === 'password'
  passwordInput.type = isHidden ? 'text' : 'password'
  passwordToggle.textContent = isHidden ? '🙈' : '👁'
  passwordToggle.setAttribute('aria-label', isHidden ? 'パスワードを隠す' : 'パスワードを表示')
})

function resetMessages() {
  msg.className = 'msg'
  msg.textContent = ''
  msgLinks.style.display = 'none'
  linkReset.style.display = 'none'
  linkSignup.style.display = 'none'
}

function showError(text, { showReset = false, showSignup = false } = {}) {
  msg.className = 'msg msg--error'
  msg.textContent = text
  if (showReset || showSignup) {
    msgLinks.style.display = 'flex'
    linkReset.style.display = showReset ? 'inline' : 'none'
    linkSignup.style.display = showSignup ? 'inline' : 'none'
  }
}

loginBtn.addEventListener('click', async () => {
  const email = emailInput.value.trim()
  const password = passwordInput.value.trim()
  resetMessages()

  // 入力チェック
  if (!email || !password) {
    showError('メールアドレスとパスワードを入力してください')
    return
  }

  loginBtn.disabled = true
  loginBtn.textContent = '確認中...'

  const { error } = await db.auth.signInWithPassword({ email, password })

  if (error) {
    // メールアドレス自体が登録されているか確認する
    // (signInWithPasswordはセキュリティ上「メール未登録」と「パスワード誤り」を
    //  同じエラーで返すため、別途RPCで確認する)
    const { data: exists, error: rpcError } = await db.rpc('check_email_exists', {
      p_email: email
    })

    if (!rpcError && exists === false) {
      showError('このメールアドレスは登録されていません', { showSignup: true })
    } else {
      showError('メールアドレスまたはパスワードが正しくありません', { showReset: true })
    }

    loginBtn.disabled = false
    loginBtn.textContent = 'ログイン'
    return
  }

  // ログイン成功 → ホーム画面へ
  window.location.href = '../user-home/user-home.html'
})

// Enterキーでもログインできるように
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loginBtn.click()
})
