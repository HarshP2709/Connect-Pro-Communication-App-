/**
 * ConnectPro — Settings JS
 */
'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  if (!Auth.requireAuth()) return;

  const user = await Auth.fetchMe();
  if (!user) return;

  Utils.setAvatar(document.getElementById('nav-avatar'), user);
  document.getElementById('nav-name').textContent = user.full_name;
  document.getElementById('nav-role').textContent = user.role;

  // Load settings
  try {
    const res = await API.get('/api/users/me/settings');
    const s = res?.data;
    if (s) {
      document.getElementById('setting-dark-mode').checked       = s.theme !== 'light';
      document.getElementById('setting-all-notifs').checked      = s.notifications_enabled !== false;
      document.getElementById('setting-meeting-notifs').checked  = s.meeting_notifications !== false;
      document.getElementById('setting-msg-notifs').checked      = s.message_notifications !== false;
      document.getElementById('setting-sound').checked           = s.sound_enabled !== false;
      document.getElementById('setting-noise').checked           = s.noise_suppression !== false;
      document.getElementById('setting-vbg').checked             = s.blur_background === true;
      document.getElementById('setting-online-status').checked   = true;
      const vq = document.getElementById('setting-video-quality');
      if (vq && s.video_quality) vq.value = s.video_quality;
    }
  } catch {}

  // Live theme toggle
  document.getElementById('setting-dark-mode')?.addEventListener('change', (e) => {
    if (!e.target.checked) { Theme.current = 'light'; } else { Theme.current = 'dark'; }
    Theme.toggle();
  });

  // Save settings
  document.getElementById('save-settings-btn')?.addEventListener('click', async () => {
    const payload = {
      theme:                  document.getElementById('setting-dark-mode').checked ? 'dark' : 'light',
      notifications_enabled:  document.getElementById('setting-all-notifs').checked,
      meeting_notifications:  document.getElementById('setting-meeting-notifs').checked,
      message_notifications:  document.getElementById('setting-msg-notifs').checked,
      sound_enabled:          document.getElementById('setting-sound').checked,
      noise_suppression:      document.getElementById('setting-noise').checked,
      blur_background:        document.getElementById('setting-vbg').checked,
      video_quality:          document.getElementById('setting-video-quality').value,
    };
    try {
      await API.patch('/api/users/me/settings', payload);
      Toast.success('Settings saved!');
    } catch (err) {
      Toast.error('Save failed', err.message);
    }
  });

  // Delete account
  document.getElementById('delete-account-btn')?.addEventListener('click', async () => {
    const confirmed = prompt('Type DELETE to confirm account deletion:');
    if (confirmed === 'DELETE') {
      try {
        await API.delete('/api/users/me');
        Toast.info('Account deleted');
        setTimeout(() => Auth.logout(), 1500);
      } catch (err) {
        Toast.error('Deletion failed', err.message);
      }
    } else if (confirmed !== null) {
      Toast.warning('Confirmation text incorrect');
    }
  });
});
