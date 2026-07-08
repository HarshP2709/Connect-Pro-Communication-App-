/**
 * ConnectPro — Core App JS
 * Shared utilities: auth, API, toast, theme, helpers
 */

'use strict';

// ─── Base URL helper ─────────────────────────────────────────────────────────
// Works with Live Server (127.0.0.1:5500/frontend/public/) and any static host.
// Finds the "public/" root by walking up from the current page URL.
const _findBase = () => {
  const path = window.location.pathname;
  // If we're at /frontend/public/... strip back to /frontend/public/
  const match = path.match(/^(.*\/frontend\/public\/|.*\/public\/)/);
  if (match) return window.location.origin + match[1];
  // Fallback: treat the directory of index.html as base
  const parts = path.split('/');
  // remove filename
  parts.pop();
  // if inside pages/xxx, go up two levels
  const pIdx = parts.lastIndexOf('pages');
  if (pIdx !== -1) {
    return window.location.origin + parts.slice(0, pIdx).join('/') + '/';
  }
  return window.location.origin + parts.join('/') + '/';
};
const BASE = _findBase();

// Helper: build a URL relative to the public root
const url = (relPath) => BASE + relPath.replace(/^\//, '');

// ─── Config ──────────────────────────────────────────────────────────────────
const CONFIG = {
  // Override by setting window.__CP_BACKEND_URL__ before this script loads,
  // e.g. <script>window.__CP_BACKEND_URL__ = 'https://api.yourapp.com';</script>
  // Default targets the local backend server on port 5000.
  BACKEND_URL: (typeof window !== 'undefined' && window.__CP_BACKEND_URL__) || 'http://localhost:5000',
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
};

// ─── API Helper ──────────────────────────────────────────────────────────────
const API = {
  token: localStorage.getItem('cp_token') || null,

  setToken(t) {
    this.token = t;
    if (t) localStorage.setItem('cp_token', t);
    else localStorage.removeItem('cp_token');
  },

  async request(method, endpoint, data = null, opts = {}) {
    const url = `${CONFIG.BACKEND_URL}${endpoint}`;
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const config = { method, headers, credentials: 'include', ...opts };
    if (data && !(data instanceof FormData)) config.body = JSON.stringify(data);
    if (data instanceof FormData) { delete headers['Content-Type']; config.body = data; }

    try {
      const res = await fetch(url, config);
      if (res.status === 401) {
        // Try to refresh token
        const refreshed = await this.refreshToken();
        if (refreshed) return this.request(method, endpoint, data, opts);
        Auth.logout();
        return null;
      }
      const json = await res.json();
      if (!res.ok) throw Object.assign(new Error(json.message || 'Request failed'), { status: res.status, errors: json.errors });
      return json;
    } catch (err) {
      if (err.name === 'TypeError') throw new Error('Network error — check your connection');
      throw err;
    }
  },

  async refreshToken() {
    try {
      const res = await fetch(`${CONFIG.BACKEND_URL}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return false;
      const json = await res.json();
      if (json.data?.access_token) { this.setToken(json.data.access_token); return true; }
      return false;
    } catch { return false; }
  },

  get:    (ep, opts)    => API.request('GET',    ep, null, opts),
  post:   (ep, data)    => API.request('POST',   ep, data),
  put:    (ep, data)    => API.request('PUT',    ep, data),
  patch:  (ep, data)    => API.request('PATCH',  ep, data),
  delete: (ep)          => API.request('DELETE', ep),
  upload: (ep, fd)      => API.request('POST',   ep, fd),
};

// ─── Auth Helpers ─────────────────────────────────────────────────────────────
const Auth = {
  user: null,

  getUser() {
    const stored = localStorage.getItem('cp_user');
    return stored ? JSON.parse(stored) : null;
  },

  setUser(u) {
    this.user = u;
    if (u) localStorage.setItem('cp_user', JSON.stringify(u));
    else localStorage.removeItem('cp_user');
  },

  isLoggedIn() {
    return !!API.token && !!this.getUser();
  },

  requireAuth() {
    if (!this.isLoggedIn()) {
      const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = url('pages/auth/login.html') + '?returnTo=' + returnTo;
      return false;
    }
    return true;
  },

  async fetchMe() {
    try {
      const res = await API.get('/api/auth/me');
      if (res?.data) { this.setUser(res.data); return res.data; }
    } catch (e) { console.error('fetchMe failed', e); }
    return null;
  },

  logout() {
    API.post('/api/auth/logout').catch(() => {});
    API.setToken(null);
    this.setUser(null);
    window.location.href = url('pages/auth/login.html');
  },
};

// ─── Toast Notifications ──────────────────────────────────────────────────────
const Toast = {
  icons: { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' },
  durations: { success: 4000, error: 6000, warning: 5000, info: 4000 },

  show(type = 'info', title, message, duration) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const d = duration || this.durations[type];
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <div class="toast-icon">${this.icons[type]}</div>
      <div class="toast-content">
        <div class="toast-title">${title}</div>
        ${message ? `<div class="toast-message">${message}</div>` : ''}
      </div>
      <button onclick="this.closest('.toast').remove()" style="background:none;border:none;color:var(--text-muted);cursor:pointer;padding:4px;line-height:1">✕</button>
      <div class="toast-progress" style="animation-duration:${d}ms"></div>
    `;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('removing');
      toast.addEventListener('animationend', () => toast.remove());
    }, d);
    return toast;
  },

  success: (title, msg) => Toast.show('success', title, msg),
  error:   (title, msg) => Toast.show('error', title, msg),
  warning: (title, msg) => Toast.show('warning', title, msg),
  info:    (title, msg) => Toast.show('info', title, msg),
};

// ─── Theme ────────────────────────────────────────────────────────────────────
const Theme = {
  current: localStorage.getItem('cp_theme') || 'dark',

  init() {
    document.documentElement.setAttribute('data-theme', this.current);
    this.updateToggles();
  },

  toggle() {
    this.current = this.current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', this.current);
    localStorage.setItem('cp_theme', this.current);
    this.updateToggles();
  },

  updateToggles() {
    document.querySelectorAll('#theme-toggle').forEach(btn => {
      btn.textContent = this.current === 'dark' ? '☀️' : '🌙';
      btn.title = `Switch to ${this.current === 'dark' ? 'light' : 'dark'} mode`;
    });
  },
};

// ─── Ripple Effect ────────────────────────────────────────────────────────────
const addRipple = (btn) => {
  btn.addEventListener('click', function(e) {
    const rect = this.getBoundingClientRect();
    const ripple = document.createElement('span');
    ripple.className = 'ripple-wave';
    const size = Math.max(rect.width, rect.height);
    ripple.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - rect.left - size/2}px;top:${e.clientY - rect.top - size/2}px`;
    this.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove());
  });
};

// ─── Utility Helpers ─────────────────────────────────────────────────────────
const Utils = {
  formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  },

  formatTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  },

  formatDateTime(iso) {
    if (!iso) return '—';
    return `${this.formatDate(iso)} at ${this.formatTime(iso)}`;
  },

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
  },

  timeAgo(iso) {
    const seconds = Math.floor((Date.now() - new Date(iso)) / 1000);
    const intervals = [
      [60, 'second'], [3600, 'minute'], [86400, 'hour'], [604800, 'day'],
      [2592000, 'week'], [31536000, 'month'],
    ];
    for (const [secs, unit] of intervals) {
      const interval = Math.floor(seconds / (secs / 60));
      if (secs > seconds) return `${Math.floor(seconds / (secs / intervals[0][0]))} ${unit}${Math.floor(seconds / (secs / intervals[0][0])) !== 1 ? 's' : ''} ago`;
    }
    return 'just now';
  },

  debounce(fn, ms = 300) {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  },

  copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => Toast.success('Copied!', 'Link copied to clipboard'));
  },

  generateInitials(name) {
    return name?.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || '?';
  },

  setAvatar(el, user) {
    if (!el) return;
    if (user?.avatar_url) {
      el.innerHTML = `<img src="${user.avatar_url}" alt="${user.full_name}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`;
    } else {
      el.textContent = this.generateInitials(user?.full_name || '?');
    }
  },
};

// ─── DOM Ready ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  Theme.init();

  // Theme toggles
  document.querySelectorAll('#theme-toggle').forEach(btn => {
    btn.addEventListener('click', () => Theme.toggle());
  });

  // Ripple buttons
  document.querySelectorAll('.btn-ripple').forEach(addRipple);

  // Hamburger (landing)
  const hamburger = document.getElementById('hamburger');
  const mobileNav = document.getElementById('mobile-nav');
  if (hamburger && mobileNav) {
    hamburger.addEventListener('click', () => {
      mobileNav.classList.toggle('open');
    });
  }
});

// Expose globals
window.API = API;
window.Auth = Auth;
window.Toast = Toast;
window.Theme = Theme;
window.Utils = Utils;
