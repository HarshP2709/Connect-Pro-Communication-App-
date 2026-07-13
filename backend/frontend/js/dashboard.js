/**
 * ConnectPro — Dashboard JS
 */
'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  if (!Auth.requireAuth()) return;

  // Load user & update UI
  const user = Auth.getUser() || await Auth.fetchMe();
  if (!user) return;

  updateUserUI(user);
  loadDashboard(user);
  initGreeting(user);
  initModals();
  initDropdown();
  initMeetingsGrid();
  initNotificationsList();
});

// ─── User UI ──────────────────────────────────────────────────────────────────
function updateUserUI(user) {
  // Sidebar
  Utils.setAvatar(document.getElementById('nav-avatar'), user);
  const nameEl = document.getElementById('nav-name');
  const roleEl = document.getElementById('nav-role');
  if (nameEl) nameEl.textContent = user.full_name;
  if (roleEl) roleEl.textContent = user.role.charAt(0).toUpperCase() + user.role.slice(1);

  // Header
  Utils.setAvatar(document.getElementById('header-avatar'), user);
  const dName = document.getElementById('dropdown-name');
  const dEmail = document.getElementById('dropdown-email');
  if (dName) dName.textContent = user.full_name;
  if (dEmail) dEmail.textContent = user.email;

  // Admin nav
  if (user.role === 'admin') document.getElementById('admin-nav')?.classList.remove('hidden');
}

// ─── Greeting ─────────────────────────────────────────────────────────────────
function initGreeting(user) {
  const h = new Date().getHours();
  const greeting = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const el = document.getElementById('greeting');
  if (el) el.textContent = `${greeting}, ${user.full_name.split(' ')[0]} 👋`;
  const sub = document.getElementById('greeting-sub');
  if (sub) sub.textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

// ─── Dashboard Data ───────────────────────────────────────────────────────────
async function loadDashboard(user) {
  try {
    const [dashRes, storageRes] = await Promise.allSettled([
      API.get('/api/meetings/dashboard'),
      API.get('/api/files/storage-usage'),
    ]);

    if (dashRes.status === 'fulfilled') {
      const { upcoming, active, recent, stats } = dashRes.value.data;

      // Stats
      document.getElementById('stat-total').textContent = stats.total_meetings || 0;
      document.getElementById('stat-today').textContent = active.length;
      document.getElementById('stat-upcoming').textContent = upcoming.length;

      // Meetings grid
      renderMeetings([...active, ...upcoming, ...recent.slice(0, 3)]);

      // Activity
      renderActivity([...active, ...upcoming, ...recent].slice(0, 5));
    }

    if (storageRes.status === 'fulfilled') {
      const s = storageRes.value.data;
      document.getElementById('stat-storage').textContent = s.used_formatted;
      document.getElementById('storage-text').textContent = `${s.percentage}% used`;
      document.getElementById('storage-used').textContent = s.used_formatted;
      document.getElementById('storage-limit').textContent = `of ${s.limit_formatted}`;
      const bar = document.getElementById('storage-bar');
      if (bar) bar.style.width = `${Math.min(s.percentage, 100)}%`;
    }
  } catch (err) {
    console.error('Dashboard load error:', err);
    Toast.error('Load failed', 'Could not load dashboard data');
  }
}

// ─── Meetings Rendering ───────────────────────────────────────────────────────
function renderMeetings(meetings) {
  const grid = document.getElementById('meetings-grid');
  const empty = document.getElementById('meetings-empty');
  if (!grid) return;

  if (!meetings.length) {
    grid.classList.add('hidden');
    empty?.classList.remove('hidden');
    return;
  }

  grid.classList.remove('hidden');
  empty?.classList.add('hidden');

  grid.innerHTML = meetings.map(m => `
    <div class="meeting-card" data-meeting-id="${m.meeting_id}">
      <div class="meeting-status status-${m.status}">
        <span class="status-dot ${m.status}"></span>
        ${m.status.charAt(0).toUpperCase() + m.status.slice(1)}
      </div>
      <div class="meeting-title">${escHtml(m.title)}</div>
      <div class="meeting-meta">
        <span>🆔 ${m.meeting_id}</span>
        ${m.scheduled_at ? `<span>📅 ${Utils.formatDateTime(m.scheduled_at)}</span>` : ''}
      </div>
      <div class="meeting-actions">
        ${m.status !== 'ended' ? `
          <button class="btn btn-primary btn-sm btn-join">
            ${m.status === 'active' ? '▶ Join' : '🚀 Start'}
          </button>
        ` : '<span class="badge badge-gray">Ended</span>'}
        <button class="btn btn-ghost btn-icon btn-sm btn-copy" title="Copy link">
          🔗
        </button>
      </div>
    </div>
  `).join('');
}

// ─── Activity Feed ────────────────────────────────────────────────────────────
function renderActivity(items) {
  const list = document.getElementById('activity-list');
  if (!list) return;

  if (!items.length) {
    list.innerHTML = `<div style="color:var(--text-muted);font-size:var(--text-sm);text-align:center;padding:var(--space-6)">No recent activity</div>`;
    return;
  }

  list.innerHTML = items.map(m => `
    <div class="activity-item">
      <span class="activity-dot" style="background:${m.status === 'active' ? 'var(--green-400)' : m.status === 'scheduled' ? 'var(--yellow-400)' : 'var(--text-muted)'}"></span>
      <div>
        <div style="font-size:var(--text-sm);font-weight:600">${escHtml(m.title)}</div>
        <div style="font-size:var(--text-xs);color:var(--text-muted)">${m.status} ${m.scheduled_at ? '· ' + Utils.formatDateTime(m.scheduled_at) : ''}</div>
      </div>
    </div>
  `).join('');
}

// ─── Notifications ────────────────────────────────────────────────────────────
async function loadNotifications() {
  try {
    const res = await API.get('/api/notifications?unread_only=true');
    const count = res.data.unread_count;
    if (count > 0) {
      const countEls = [
        document.getElementById('notif-count'),
        document.getElementById('header-notif-count'),
      ];
      countEls.forEach(el => {
        if (el) { el.textContent = count > 99 ? '99+' : count; el.style.display = ''; }
      });
    }

    const list = document.getElementById('notif-list');
    if (list) {
      const notifs = res.data.notifications.slice(0, 4);
      if (!notifs.length) {
        list.innerHTML = `<div style="color:var(--text-muted);font-size:var(--text-sm);text-align:center;padding:var(--space-4)">All caught up! 🎉</div>`;
        return;
      }
      list.innerHTML = notifs.map(n => `
        <div class="activity-item" style="cursor:pointer" data-notif-id="${n.id}">
          <div style="font-size:18px">${getNotifIcon(n.type)}</div>
          <div>
            <div style="font-size:var(--text-sm);font-weight:${n.is_read ? '400' : '600'}">${escHtml(n.title)}</div>
            <div style="font-size:var(--text-xs);color:var(--text-muted)">${escHtml(n.message)} · ${Utils.timeAgo(n.created_at)}</div>
          </div>
        </div>
      `).join('');
    }
  } catch (err) {
    const list = document.getElementById('notif-list');
    if (list) list.innerHTML = '<div style="color:var(--text-muted);font-size:var(--text-sm)">Could not load notifications</div>';
  }
}

async function markNotifRead(id) {
  await API.patch(`/api/notifications/${id}/read`).catch(() => { });
  loadNotifications();
}

function getNotifIcon(type) {
  const icons = { meeting_join: '👥', file_shared: '📁', mention: '@', new_message: '💬', meeting_reminder: '⏰', system: 'ℹ️' };
  return icons[type] || '🔔';
}



// ─── Dropdown ────────────────────────────────────────────────────────────────
function initDropdown() {
  const headerAvatar = document.getElementById('header-avatar');
  const dropdown = document.getElementById('profile-dropdown');

  headerAvatar?.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown?.classList.toggle('hidden');
  });

  document.addEventListener('click', () => dropdown?.classList.add('hidden'));

  document.getElementById('logout-btn')?.addEventListener('click', () => {
    Auth.logout();
  });
}

// ─── Modals ───────────────────────────────────────────────────────────────────
function initModals() {
  // New Meeting
  const newMeetingModal = document.getElementById('new-meeting-modal');
  const openNewMeeting = () => {
    // Auto-fill date/time to current moment when modal opens
    const el = document.getElementById('meeting-scheduled');
    if (el && !el.value) {
      const now = new Date();
      const pad = n => String(n).padStart(2, '0');
      el.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
    }
    newMeetingModal?.classList.remove('hidden');
  };
  const closeNewMeeting = () => {
    newMeetingModal?.classList.add('hidden');
    document.getElementById('meeting-scheduled').value = ''; // reset so next open re-fills
  };

  ['new-meeting-header-btn', 'qa-new-meeting', 'empty-new-meeting-btn'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', openNewMeeting);
  });
  document.getElementById('close-new-meeting')?.addEventListener('click', closeNewMeeting);
  document.getElementById('cancel-new-meeting')?.addEventListener('click', closeNewMeeting);
  newMeetingModal?.addEventListener('click', (e) => { if (e.target === newMeetingModal) closeNewMeeting(); });

  document.getElementById('new-meeting-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('create-meeting-btn');
    btn.disabled = true;
    document.getElementById('create-text').classList.add('hidden');
    document.getElementById('create-spinner').classList.remove('hidden');

    try {
      const res = await API.post('/api/meetings', {
        title: document.getElementById('meeting-title').value.trim(),
        description: document.getElementById('meeting-desc').value.trim(),
        scheduled_at: document.getElementById('meeting-scheduled').value || new Date().toISOString(),
        max_participants: parseInt(document.getElementById('meeting-max').value),
        password: document.getElementById('meeting-password').value.trim() || null,
        enable_waiting_room: document.getElementById('waiting-room').checked,
      });
      Toast.success('Meeting created! 🎬', `ID: ${res.data.meeting_id}`);
      closeNewMeeting();
      setTimeout(() => window.location.href = url('pages/meeting/room.html') + '?id=' + res.data.meeting_id, 1000);
    } catch (err) {
      Toast.error('Failed to create meeting', err.message);
    } finally {
      btn.disabled = false;
      document.getElementById('create-text').classList.remove('hidden');
      document.getElementById('create-spinner').classList.add('hidden');
    }
  });

  // Join Meeting
  const joinModal = document.getElementById('join-meeting-modal');
  document.getElementById('qa-join-meeting')?.addEventListener('click', () => joinModal?.classList.remove('hidden'));
  document.getElementById('close-join-modal')?.addEventListener('click', () => joinModal?.classList.add('hidden'));

  document.getElementById('join-meeting-confirm')?.addEventListener('click', () => {
    const raw = document.getElementById('join-meeting-id').value.trim();
    if (!raw) return Toast.warning('Meeting ID required');
    const id = extractMeetingId(raw);
    window.location.href = url('pages/meeting/room.html') + '?id=' + encodeURIComponent(id);
  });

  // Quick Actions
  document.getElementById('qa-schedule')?.addEventListener('click', () => {
    window.location.href = url('pages/dashboard/schedule.html');
  });
  document.getElementById('qa-whiteboard')?.addEventListener('click', () => {
    window.location.href = url('pages/dashboard/whiteboard.html');
  });
}

// ─── Extract meeting ID from a plain ID or a full meeting room URL ────────────
function extractMeetingId(value) {
  try {
    const u = new URL(value);
    const fromParam = u.searchParams.get('id');
    if (fromParam) return extractMeetingId(fromParam); // handle double-encoded case
    return value;
  } catch {
    // Not a URL — use as-is
    return value;
  }
}

// ─── Meeting Actions ──────────────────────────────────────────────────────────
function joinMeeting(meetingId) {
  window.location.href = url('pages/meeting/room.html') + '?id=' + encodeURIComponent(meetingId);
}

function initMeetingsGrid() {
  const grid = document.getElementById('meetings-grid');
  if (!grid) return;

  grid.addEventListener('click', (e) => {
    const card = e.target.closest('.meeting-card');
    if (!card) return;

    const meetingId = card.getAttribute('data-meeting-id');
    if (!meetingId) return;

    const copyBtn = e.target.closest('.btn-copy');
    const joinBtn = e.target.closest('.btn-join');

    if (copyBtn) {
      e.stopPropagation();
      Utils.copyToClipboard(url('pages/meeting/room.html') + '?id=' + encodeURIComponent(meetingId));
      return;
    }

    if (joinBtn || card) {
      joinMeeting(meetingId);
    }
  });
}

function initNotificationsList() {
  // Bind click listener for list notifications
  const list = document.getElementById('notif-list');
  if (list) {
    list.addEventListener('click', (e) => {
      const item = e.target.closest('.activity-item');
      if (!item) return;
      const notifId = item.getAttribute('data-notif-id');
      if (notifId) {
        markNotifRead(notifId);
      }
    });
  }

  // Clean load of data
  loadNotifications();
}

function escHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}



