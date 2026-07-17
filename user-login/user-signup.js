const SUPABASE_URL = 'https://nsprbshgkxywtwmimkcy.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zcHJic2hna3h5d3R3bWlta2N5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzMzMxMDAsImV4cCI6MjA5MzkwOTEwMH0.g51y4rq3xEDYD9GJoux7UDBeOpXyqYLDptwQ3LHy6b8'

const { createClient } = supabase
const db = createClient(SUPABASE_URL, SUPABASE_KEY)

const emailInput = document.getElementById('email')
const passwordInput = document.getElementById('password')
const passwordConfirmInput = document.getElementById('password-confirm')
const signupBtn = document.getElementById('signup-btn')
const msg = document.getElementById('msg')
const msgLinks = document.getElementById('msg-links')
const linkLogin = document.getElementById('link-login')

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

function resetMessages() {
  msg.className = 'msg'
  msg.textContent = ''
  msgLinks.style.display = 'none'
  linkLogin.style.display = 'none'
}

function showMsg(text, type) {
  msg.className = `msg msg--${type}`
  msg.textContent = text
}

signupBtn.addEventListener('click', async () => {
  const email = emailInput.value.trim()
  const password = passwordInput.value.trim()
  const passwordConfirm = passwordConfirmInput.value.trim()
  resetMessages()

  if (!email || !password || !passwordConfirm) {
    showMsg('すべての項目を入力してください', 'error')
    return
  }
  if (password.length < 8) {
    showMsg('パスワードは8文字以上で入力してください', 'error')
    return
  }
  if (password !== passwordConfirm) {
    showMsg('パスワードが一致しません', 'error')
    return
  }

  signupBtn.disabled = true
  signupBtn.textContent = '登録中...'

  const { error } = await db.auth.signUp({ email, password })

  if (error) {
    if (error.message && error.message.toLowerCase().includes('already registered')) {
      showMsg('このメールアドレスは既に登録されています', 'error')
      msgLinks.style.display = 'flex'
      linkLogin.style.display = 'inline'
    } else {
      showMsg('登録に失敗しました。時間をおいて再度お試しください', 'error')
    }
    signupBtn.disabled = false
    signupBtn.textContent = '登録する'
    return
  }

  // 登録成功
  // ※ Supabaseの設定で「メール確認」が有効な場合、確認メールのリンクを
  //   クリックするまでログインできません
  showMsg('登録が完了しました。確認メールが届いている場合はリンクをクリックしてください。', 'success')
  signupBtn.disabled = true
  signupBtn.textContent = '登録済み'

  setTimeout(() => {
    window.location.href = 'user-login.html'
  }, 2500)
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') signupBtn.click()
})
