/**
 * ConnectPro — Auth Pages JS
 * Login, Register, Forgot Password, Reset Password
 */
'use strict';

document.addEventListener('DOMContentLoaded', () => {
  // If already logged in, redirect
  if (Auth.isLoggedIn() && !window.location.pathname.includes('logout')) {
    window.location.href = url('pages/dashboard/index.html');
    return;
  }

  const page = document.body.dataset.page || detectPage();

  if (page === 'login')           initLogin();
  else if (page === 'register')   initRegister();
  else if (page === 'forgot')     initForgot();
  else if (page === 'reset')      initReset();

  // Password visibility toggle
  document.querySelectorAll('.password-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = btn.closest('.input-group')?.querySelector('input[type="password"], input[type="text"]');
      if (input) {
        const isVisible = input.type === 'text';
        input.type = isVisible ? 'password' : 'text';
        btn.textContent = isVisible ? '👁️' : '🙈';
      }
    });
  });
});

function detectPage() {
  const path = window.location.pathname;
  if (path.includes('login'))          return 'login';
  if (path.includes('register'))       return 'register';
  if (path.includes('forgot'))         return 'forgot';
  if (path.includes('reset'))          return 'reset';
  return 'login';
}

// ─── Login ────────────────────────────────────────────────────────────────────
function initLogin() {
  const form = document.getElementById('login-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email    = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const remember = document.getElementById('remember-me')?.checked;

    if (!email || !password) return showFormError('Please fill in all fields');

    setLoading(true, 'login-btn', 'login-text', 'login-spinner');
    hideFormError();

    try {
      const res = await API.post('/api/auth/login', { email, password, remember_me: remember });
      API.setToken(res.data.access_token);
      Auth.setUser(res.data.user);

      Toast.success('Welcome back!', `Hello, ${res.data.user.full_name}`);

      const returnTo = new URLSearchParams(window.location.search).get('returnTo');
      setTimeout(() => {
        window.location.href = returnTo ? decodeURIComponent(returnTo) : url('pages/dashboard/index.html');
      }, 800);
    } catch (err) {
      showFormError(err.message || 'Login failed. Check your credentials.');
      setLoading(false, 'login-btn', 'login-text', 'login-spinner');
    }
  });

  // Enter key
  document.getElementById('email')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('password')?.focus();
  });
}

// ─── Register ────────────────────────────────────────────────────────────────
function initRegister() {
  const form = document.getElementById('register-form');
  if (!form) return;

  // Password strength
  const pwdInput = document.getElementById('password');
  const strengthBar = document.getElementById('pwd-strength');
  const strengthText = document.getElementById('pwd-strength-text');

  pwdInput?.addEventListener('input', () => {
    const score = getPasswordScore(pwdInput.value);
    if (strengthBar) { strengthBar.className = `password-strength strength-${score}`; }
    if (strengthText) {
      const labels = ['', 'Weak — add uppercase & number', 'Fair — add uppercase or number', 'Good', 'Strong'];
      const colors = ['', 'var(--red-400)', 'var(--orange-400)', 'var(--yellow-400)', 'var(--green-400)'];
      strengthText.textContent = pwdInput.value ? labels[score] : '';
      strengthText.style.color = colors[score];
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const full_name = document.getElementById('full_name').value.trim();
    const email     = document.getElementById('email').value.trim();
    const password  = document.getElementById('password').value;
    const confirm   = document.getElementById('confirm_password').value;
    const terms     = document.getElementById('terms').checked;

    if (!full_name) return showFormError('Full name is required');
    if (!email) return showFormError('Email is required');
    if (password.length < 8) return showFormError('Password must be at least 8 characters');
    if (!/[A-Z]/.test(password)) return showFormError('Password must contain at least one uppercase letter');
    if (!/[a-z]/.test(password)) return showFormError('Password must contain at least one lowercase letter');
    if (!/[0-9]/.test(password)) return showFormError('Password must contain at least one number');
    if (password !== confirm) return showFormError('Passwords do not match');
    if (!terms) return showFormError('Please accept the Terms of Service');

    setLoading(true, 'register-btn', 'register-text', 'register-spinner');
    hideFormError();

    try {
      const res = await API.post('/api/auth/register', { full_name, email, password });
      API.setToken(res.data.access_token);
      Auth.setUser(res.data.user);

      Toast.success('Account created! 🎉', 'Please verify your email address.');
      setTimeout(() => window.location.href = url('pages/dashboard/index.html'), 1200);
    } catch (err) {
      showFormError(err.message || 'Registration failed. Please try again.');
      setLoading(false, 'register-btn', 'register-text', 'register-spinner');
    }
  });
}

// ─── Forgot Password ──────────────────────────────────────────────────────────
function initForgot() {
  const form = document.getElementById('forgot-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    if (!email) return Toast.warning('Email required');

    setLoading(true, 'reset-btn', 'reset-text', 'reset-spinner');
    try {
      await API.post('/api/auth/forgot-password', { email });
      document.getElementById('form-state')?.classList.add('hidden');
      const successState = document.getElementById('success-state');
      if (successState) {
        successState.classList.add('visible');
        const msgEl = document.getElementById('success-message');
        if (msgEl) msgEl.textContent = `We sent a password reset link to ${email}.`;
      }
    } catch (err) {
      // Always show success for security
      document.getElementById('form-state')?.classList.add('hidden');
      document.getElementById('success-state')?.classList.add('visible');
    }
  });
}

// ─── Reset Password ───────────────────────────────────────────────────────────
function initReset() {
  const form = document.getElementById('reset-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('new-password').value;
    const confirm  = document.getElementById('confirm-password').value;
    const token    = new URLSearchParams(window.location.search).get('token') || '';

    if (password !== confirm) return Toast.error('Passwords do not match');
    if (password.length < 8) return Toast.error('Password too short', 'Minimum 8 characters required');

    try {
      await API.post('/api/auth/reset-password', { token, password });
      Toast.success('Password reset!', 'You can now sign in with your new password');
      setTimeout(() => window.location.href = url('pages/auth/login.html'), 2000);
    } catch (err) {
      Toast.error('Reset failed', err.message);
    }
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function setLoading(loading, btnId, textId, spinnerId) {
  const btn     = document.getElementById(btnId);
  const text    = document.getElementById(textId);
  const spinner = document.getElementById(spinnerId);
  if (btn)     btn.disabled = loading;
  if (text)    text.classList.toggle('hidden', loading);
  if (spinner) spinner.classList.toggle('hidden', !loading);
}

function showFormError(msg) {
  const banner = document.getElementById('error-banner');
  if (banner) { banner.textContent = msg; banner.classList.add('visible'); }
  else Toast.error('Error', msg);
}

function hideFormError() {
  const banner = document.getElementById('error-banner');
  banner?.classList.remove('visible');
}

function getPasswordScore(pwd) {
  let score = 0;
  if (pwd.length >= 8) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^a-zA-Z0-9]/.test(pwd)) score++;
  return score;
}

