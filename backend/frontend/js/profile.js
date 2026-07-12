/**
 * ConnectPro — Profile Page JS
 */
'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  if (!Auth.requireAuth()) return;

  const user = await Auth.fetchMe();
  if (!user) return;

  populateProfile(user);
  initSidebarUser(user);
  initAvatarUpload();
  initProfileForm(user);
  initPasswordForm();
});

function populateProfile(user) {
  document.getElementById('profile-fullname').textContent = user.full_name || '—';
  document.getElementById('profile-email').textContent    = user.email || '—';
  document.getElementById('profile-jobtitle').textContent = user.job_title || 'No job title set';
  document.getElementById('profile-role').textContent     = user.role || 'user';
  if (user.created_at) document.getElementById('profile-joined').textContent = 'Joined ' + Utils.formatDate(user.created_at);
  if (user.is_verified) document.getElementById('verify-badge').style.display = 'inline-flex';

  Utils.setAvatar(document.getElementById('profile-avatar'), user);
  Utils.setAvatar(document.getElementById('nav-avatar'), user);
  document.getElementById('nav-name').textContent = user.full_name;
  document.getElementById('nav-role').textContent = user.role;

  // Prefill form
  document.getElementById('f-fullname').value   = user.full_name || '';
  document.getElementById('f-jobtitle').value   = user.job_title || '';
  document.getElementById('f-company').value    = user.company || '';
  document.getElementById('f-phone').value      = user.phone || '';
  document.getElementById('f-location').value   = user.location || '';
  document.getElementById('f-bio').value        = user.bio || '';
  const tzSel = document.getElementById('f-timezone');
  if (tzSel && user.timezone) tzSel.value = user.timezone;
}

function initSidebarUser(user) {
  Utils.setAvatar(document.getElementById('nav-avatar'), user);
  document.getElementById('nav-name').textContent = user.full_name;
  document.getElementById('nav-role').textContent = user.role;
}

function initAvatarUpload() {
  const input = document.getElementById('avatar-upload');
  input?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return Toast.error('File too large', 'Max 5MB');

    const fd = new FormData();
    fd.append('avatar', file);

    try {
      const res = await API.upload('/api/users/me/avatar', fd);
      Toast.success('Avatar updated!');
      const el = document.getElementById('profile-avatar');
      const navEl = document.getElementById('nav-avatar');
      el.innerHTML = `<img src="${res.data.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"><div class="avatar-hover" onclick="document.getElementById('avatar-upload').click()">📷</div>`;
      if (navEl) navEl.innerHTML = `<img src="${res.data.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`;
    } catch (err) {
      Toast.error('Upload failed', err.message);
    }
  });
}

function initProfileForm(user) {
  document.getElementById('profile-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('save-profile-btn');
    btn.disabled = true;
    document.getElementById('save-text').classList.add('hidden');
    document.getElementById('save-spinner').classList.remove('hidden');

    try {
      await API.patch('/api/users/me', {
        full_name: document.getElementById('f-fullname').value.trim(),
        job_title: document.getElementById('f-jobtitle').value.trim(),
        company:   document.getElementById('f-company').value.trim(),
        phone:     document.getElementById('f-phone').value.trim(),
        location:  document.getElementById('f-location').value.trim(),
        timezone:  document.getElementById('f-timezone').value,
        bio:       document.getElementById('f-bio').value.trim(),
      });
      Toast.success('Profile updated!');
      Auth.fetchMe(); // refresh
    } catch (err) {
      Toast.error('Update failed', err.message);
    } finally {
      btn.disabled = false;
      document.getElementById('save-text').classList.remove('hidden');
      document.getElementById('save-spinner').classList.add('hidden');
    }
  });

  document.getElementById('discard-btn')?.addEventListener('click', () => Auth.fetchMe().then(populateProfile));
}

function initPasswordForm() {
  document.getElementById('password-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const newPwd    = document.getElementById('new-pwd').value;
    const confirmPwd = document.getElementById('confirm-pwd').value;

    if (newPwd !== confirmPwd) return Toast.error('Passwords do not match');
    if (newPwd.length < 8) return Toast.error('Password too short');

    try {
      await API.post('/api/auth/change-password', {
        current_password: document.getElementById('current-pwd').value,
        new_password: newPwd,
      });
      Toast.success('Password changed!');
      document.getElementById('password-form').reset();
    } catch (err) {
      Toast.error('Password change failed', err.message);
    }
  });
}
