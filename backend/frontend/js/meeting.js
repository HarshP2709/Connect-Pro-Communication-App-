/**
 * ConnectPro — Meeting Room JS
 * Full WebRTC + Socket.io signaling
 */
'use strict';

// ─── State ─────────────────────────────────────────────────────────────────
const Room = {
  socket: null,
  localStream: null,
  screenStream: null,
  peerConnections: {},   // socketId → RTCPeerConnection
  participants: {},      // socketId → participant data
  meetingId: null,
  meetingDbId: null,
  isHost: false,
  initialized: false,    // true after first room-joined (prevents re-init on reconnect)
  audioEnabled: true,
  videoEnabled: true,
  screenSharing: false,
  handRaised: false,
  view: 'grid',           // 'grid' | 'speaker'
  timerStart: null,
  timerInterval: null,
  chatUnread: 0,
  panelOpen: false,
  activeTab: 'chat',
  locked: false,
  recording: false,
  audioContext: null,
  analyserNodes: {},     // socketId → analyser for voice detection
};

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

// ─── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (!Auth.requireAuth()) return;

  // Register cancel button handler immediately so it works in the waiting room
  document.getElementById('btn-cancel-waiting')?.addEventListener('click', leaveMeeting);

  const params = new URLSearchParams(window.location.search);
  let rawId = params.get('id') || '';
  // If someone pasted a full meeting URL into the join field, extract just the ID
  try {
    const u = new URL(rawId);
    rawId = u.searchParams.get('id') || rawId;
  } catch { /* not a URL, use as-is */ }
  Room.meetingId = rawId || null;
  const password = params.get('pwd') || '';

  if (!Room.meetingId) {
    showLoading('Meeting ID missing');
    setTimeout(() => window.location.href = url('pages/dashboard/index.html'), 2000);
    return;
  }

  try {
    showLoading('Requesting camera & microphone...');
    await initLocalMedia();

    showLoading('Joining meeting...');
    const res = await API.post(`/api/meetings/${Room.meetingId}/join`, { password });
    if (!res?.data) throw new Error('Failed to join meeting');

    const { meeting, is_host } = res.data;
    Room.meetingDbId = meeting.id;
    Room.isHost = is_host;
    document.getElementById('room-title').textContent = meeting.title;
    document.getElementById('meeting-id-display').textContent = meeting.meeting_id;

    showLoading('Connecting to real-time server...');
    initSocket();
  } catch (err) {
    showLoading(`Error: ${err.message}`);
    setTimeout(() => window.location.href = url('pages/dashboard/index.html'), 3000);
  }
});

// ─── Local Media ────────────────────────────────────────────────────────────
async function initLocalMedia() {
  try {
    Room.localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    // Fallback: audio only
    try {
      Room.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      Room.videoEnabled = false;
    } catch {
      Room.localStream = new MediaStream();
    }
  }
}

// ─── Socket.io ──────────────────────────────────────────────────────────────
function initSocket() {
  Room.socket = io(CONFIG.BACKEND_URL, {
    auth: { token: API.token },
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 5,
  });

  Room.socket.on('connect', () => {
    Room.socket.emit('join-room', {
      meetingId: Room.meetingId,
      password: new URLSearchParams(window.location.search).get('pwd') || '',
    });
  });

  Room.socket.on('room-joined', ({ meeting, participants, isHost, waitingRoom }) => {
    Room.isHost = isHost;
    const localUserId = Auth.getUser()?.id;

    // Only run one-time setup on first join (not on reconnect)
    if (!Room.initialized) {
      Room.initialized = true;
      hideLoading();
      document.getElementById('room-layout').style.display = 'grid';
      startTimer();
      initControls();
      initKeyboardShortcuts();
      updateControlStates();
      addLocalVideoTile();
      loadSharedFiles();
    }

    // Populate waiting room if host
    if (isHost && waitingRoom && waitingRoom.length > 0) {
      waitingRoom.forEach(p => {
        if (!document.getElementById(`waiting-${p.socketId}`)) {
          addWaitingParticipant(p.user, p.socketId);
        }
      });
    }

    // Connect to existing participants — skip self (by socketId OR userId)
    participants.forEach(p => {
      if (p.socketId === Room.socket.id) return;
      if (localUserId && p.id === localUserId) return;
      if (document.getElementById(`tile-${p.socketId}`)) return; // already rendered
      Room.participants[p.socketId] = p;
      addRemoteVideoTile(p.socketId, p);
      createPeerConnection(p.socketId, true); // initiator
    });

    updateParticipantList();
    updateGridLayout();
  });

  Room.socket.on('user-joined', ({ user, socketId, participants }) => {
    Room.participants[socketId] = { ...user, socketId };
    addRemoteVideoTile(socketId, user);
    createPeerConnection(socketId, false);
    updateParticipantList();
    updateGridLayout();
    Toast.info(`${user.full_name} joined`, null, null, 3000);
  });

  Room.socket.on('participant-left', ({ socketId, user }) => {
    closePeerConnection(socketId);
    removeVideoTile(socketId);
    delete Room.participants[socketId];
    updateParticipantList();
    updateGridLayout();
    if (user) Toast.info(`${user.full_name} left`, null, null, 2500);
  });

  Room.socket.on('waiting-room', () => {
    hideLoading();
    document.getElementById('waiting-screen').classList.remove('hidden');
  });

  Room.socket.on('admitted', ({ room }) => {
    document.getElementById('waiting-screen').classList.add('hidden');
    Room.socket.emit('join-room', { meetingId: Room.meetingId });
  });

  Room.socket.on('join-rejected', ({ message }) => {
    hideLoading();
    Toast.error(message || 'Access denied by host');
    setTimeout(() => window.location.href = url('pages/dashboard/index.html'), 3000);
  });

  Room.socket.on('participant-waiting-left', ({ socketId }) => {
    document.getElementById(`waiting-${socketId}`)?.remove();
    const counter = document.getElementById('waiting-count');
    if (counter) {
      const current = parseInt(counter.textContent) || 0;
      counter.textContent = Math.max(0, current - 1);
    }
    const list = document.getElementById('waiting-list');
    if (list && list.children.length === 0) {
      const section = document.getElementById('waiting-room-section');
      if (section) section.style.display = 'none';
    }
  });

  // WebRTC signaling
  Room.socket.on('webrtc-offer', async ({ from, offer, user }) => {
    if (!Room.peerConnections[from]) createPeerConnection(from, false);
    const pc = Room.peerConnections[from];
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    Room.socket.emit('webrtc-answer', { to: from, answer });
  });

  Room.socket.on('webrtc-answer', async ({ from, answer }) => {
    const pc = Room.peerConnections[from];
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
  });

  Room.socket.on('webrtc-ice-candidate', async ({ from, candidate }) => {
    const pc = Room.peerConnections[from];
    if (pc && candidate) {
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch { }
    }
  });

  // Media state updates
  Room.socket.on('participant-audio-changed', ({ socketId, enabled }) => {
    const tile = document.getElementById(`tile-${socketId}`);
    const badge = tile?.querySelector('.mic-badge');
    if (badge) badge.style.display = enabled ? 'none' : 'flex';
    if (Room.participants[socketId]) Room.participants[socketId].audioEnabled = enabled;
    updateParticipantList();
  });

  Room.socket.on('participant-video-changed', ({ socketId, enabled }) => {
    const tile = document.getElementById(`tile-${socketId}`);
    if (tile) {
      const video = tile.querySelector('video');
      const overlay = tile.querySelector('.tile-overlay.hidden-bg');
      if (video) video.style.display = enabled ? 'block' : 'none';
    }
    if (Room.participants[socketId]) Room.participants[socketId].videoEnabled = enabled;
  });

  Room.socket.on('screen-share-started', ({ socketId, user }) => {
    const tile = document.getElementById(`tile-${socketId}`);
    tile?.classList.add('screen-share');
    if (tile) {
      const video = tile.querySelector('video');
      const avatar = tile.querySelector('.tile-overlay.hidden-bg');
      if (video) video.style.display = 'block';
      if (avatar) avatar.style.display = 'none';
    }
    Toast.info(`${user.full_name} is sharing their screen`);
  });

  Room.socket.on('screen-share-stopped', ({ socketId }) => {
    const tile = document.getElementById(`tile-${socketId}`);
    tile?.classList.remove('screen-share');
    if (tile) {
      const participant = Room.participants[socketId];
      const cameraEnabled = participant ? participant.videoEnabled : false;
      const video = tile.querySelector('video');
      const avatar = tile.querySelector('.tile-overlay.hidden-bg');
      if (video) video.style.display = cameraEnabled ? 'block' : 'none';
      if (avatar) avatar.style.display = cameraEnabled ? 'none' : 'flex';
    }
  });

  Room.socket.on('hand-raised', ({ socketId, user, raised }) => {
    const tile = document.getElementById(`tile-${socketId}`);
    if (raised) {
      if (!tile?.querySelector('.hand-badge')) {
        const badge = document.createElement('div');
        badge.className = 'tile-badge hand-badge';
        badge.style.cssText = 'position:absolute;top:10px;right:10px;font-size:16px';
        badge.textContent = '✋';
        tile?.appendChild(badge);
      }
      Toast.info(`${user.full_name} raised their hand ✋`);
    } else {
      tile?.querySelector('.hand-badge')?.remove();
    }
  });

  Room.socket.on('chat-message', (msg) => {
    appendChatMessage(msg);
    if (msg.type === 'file' || msg.message_type === 'file') {
      let fileInfo = {};
      try {
        fileInfo = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;
      } catch { }
      if (fileInfo && fileInfo.id) {
        addToFilePaneList(fileInfo);
        const user = Auth.getUser();
        const isOwn = msg.sender_id === user?.id || msg.sender?.id === user?.id;
        if (!isOwn) {
          Toast.info(`${msg.sender?.full_name || 'Participant'} shared a file: ${fileInfo.name}`);
        }
      }
    }
    if (!Room.panelOpen || Room.activeTab !== 'chat') {
      Room.chatUnread++;
      const badge = document.getElementById('chat-badge');
      if (badge) { badge.textContent = Room.chatUnread; badge.style.display = 'block'; }
    }
  });

  Room.socket.on('typing-start', ({ user }) => {
    let typing = document.getElementById('typing-indicator');
    if (!typing) {
      typing = document.createElement('div');
      typing.id = 'typing-indicator';
      typing.style.cssText = 'font-size:11px;color:rgba(255,255,255,0.4);padding:0 16px 8px';
      document.getElementById('chat-messages')?.appendChild(typing);
    }
    typing.textContent = `${user.full_name} is typing...`;
  });

  Room.socket.on('typing-stop', () => {
    document.getElementById('typing-indicator')?.remove();
  });

  Room.socket.on('emoji-reaction', ({ user, emoji }) => {
    showEmojiReaction(emoji, user.full_name);
  });

  Room.socket.on('force-mute', () => {
    setAudio(false);
    Toast.warning('Muted by host');
  });

  Room.socket.on('removed-from-meeting', () => {
    Toast.error('Removed from meeting', 'You were removed by the host');
    setTimeout(() => window.location.href = url('pages/dashboard/index.html'), 2000);
  });

  Room.socket.on('room-locked', ({ locked }) => {
    Room.locked = locked;
    const lockOpt = document.getElementById('opt-lock');
    if (lockOpt) lockOpt.textContent = locked ? '🔓 Unlock Meeting' : '🔒 Lock Meeting';
    Toast.info(locked ? 'Meeting locked 🔒' : 'Meeting unlocked 🔓');
  });

  Room.socket.on('participant-waiting', ({ user, socketId }) => {
    addWaitingParticipant(user, socketId);
  });

  Room.socket.on('disconnect', () => {
    Toast.warning('Disconnected', 'Attempting to reconnect...');
  });

  Room.socket.on('reconnect', () => {
    Toast.success('Reconnected!');
    Room.socket.emit('join-room', { meetingId: Room.meetingId });
  });

  Room.socket.on('error', ({ message }) => {
    Toast.error('Meeting error', message);
    setTimeout(() => window.location.href = url('pages/dashboard/index.html'), 3000);
  });
}

// ─── WebRTC Peer Connection ──────────────────────────────────────────────────
function createPeerConnection(targetSocketId, isInitiator) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  Room.peerConnections[targetSocketId] = pc;

  // Add local tracks - use screen share video track if sharing
  const videoTrack = Room.screenSharing && Room.screenStream
    ? Room.screenStream.getVideoTracks()[0]
    : Room.localStream.getVideoTracks()[0];
  const audioTrack = Room.localStream.getAudioTracks()[0];

  if (audioTrack) pc.addTrack(audioTrack, Room.localStream);
  if (videoTrack) pc.addTrack(videoTrack, Room.localStream);

  // ICE candidates
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) {
      Room.socket.emit('webrtc-ice-candidate', { to: targetSocketId, candidate });
    }
  };

  // Connection state
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') {
      pc.restartIce();
    }
  };

  // Remote tracks
  pc.ontrack = ({ streams: [stream] }) => {
    const video = document.getElementById(`video-${targetSocketId}`);
    if (video) video.srcObject = stream;
    setupVoiceDetection(targetSocketId, stream);
  };

  // If initiator, create offer
  if (isInitiator) {
    pc.onnegotiationneeded = async () => {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      Room.socket.emit('webrtc-offer', { to: targetSocketId, offer });
    };
  }

  return pc;
}

function closePeerConnection(socketId) {
  const pc = Room.peerConnections[socketId];
  if (pc) { pc.close(); delete Room.peerConnections[socketId]; }
}

// ─── Voice Activity Detection ───────────────────────────────────────────────
function setupVoiceDetection(socketId, stream) {
  try {
    if (!Room.audioContext) Room.audioContext = new AudioContext();
    const analyser = Room.audioContext.createAnalyser();
    analyser.fftSize = 256;
    const source = Room.audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    Room.analyserNodes[socketId] = analyser;

    const data = new Uint8Array(analyser.frequencyBinCount);
    const detect = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const tile = document.getElementById(`tile-${socketId}`);
      tile?.classList.toggle('speaking', avg > 20);
      requestAnimationFrame(detect);
    };
    detect();
  } catch { }
}

// ─── Video Tiles ─────────────────────────────────────────────────────────────
function addLocalVideoTile() {
  const user = Auth.getUser();
  const tileId = 'local';
  if (document.getElementById(`tile-${tileId}`)) return;

  const tile = document.createElement('div');
  tile.className = 'video-tile';
  tile.id = `tile-${tileId}`;

  const video = document.createElement('video');
  video.id = `video-${tileId}`;
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = Room.localStream;
  if (!Room.videoEnabled) video.style.display = 'none';

  const overlay = document.createElement('div');
  overlay.className = 'tile-overlay';

  const avatarWrap = document.createElement('div');
  avatarWrap.className = 'tile-overlay hidden-bg';
  avatarWrap.style.display = Room.videoEnabled ? 'none' : 'flex';
  const avatar = document.createElement('div');
  avatar.className = 'tile-avatar';
  avatar.textContent = Utils.generateInitials(user?.full_name);
  avatarWrap.appendChild(avatar);

  const info = document.createElement('div');
  info.className = 'tile-info';
  info.innerHTML = `
    <span class="tile-name">${user?.full_name || 'You'} (You)</span>
    <div class="tile-badges">
      <span class="tile-badge muted mic-badge" style="display:none">🔇</span>
    </div>
  `;

  tile.appendChild(video);
  tile.appendChild(overlay);
  tile.appendChild(avatarWrap);
  tile.appendChild(info);

  document.getElementById('video-grid').appendChild(tile);

  // Set up PiP video
  const pipVideo = document.getElementById('pip-video');
  if (pipVideo) pipVideo.srcObject = Room.localStream;
}

function addRemoteVideoTile(socketId, user) {
  if (document.getElementById(`tile-${socketId}`)) return;

  const tile = document.createElement('div');
  tile.className = 'video-tile';
  tile.id = `tile-${socketId}`;

  const video = document.createElement('video');
  video.id = `video-${socketId}`;
  video.autoplay = true;
  video.playsInline = true;

  const overlay = document.createElement('div');
  overlay.className = 'tile-overlay';

  const avatarWrap = document.createElement('div');
  avatarWrap.className = 'tile-overlay hidden-bg';
  avatarWrap.style.display = 'flex';
  const avatar = document.createElement('div');
  avatar.className = 'tile-avatar';
  avatar.textContent = Utils.generateInitials(user?.full_name);
  avatarWrap.appendChild(avatar);

  const info = document.createElement('div');
  info.className = 'tile-info';
  info.innerHTML = `
    <span class="tile-name">${escHtml(user?.full_name || 'Participant')}</span>
    <div class="tile-badges">
      <span class="tile-badge muted mic-badge" style="display:none">🔇</span>
    </div>
  `;

  video.addEventListener('loadedmetadata', () => { avatarWrap.style.display = 'none'; });

  tile.appendChild(video);
  tile.appendChild(overlay);
  tile.appendChild(avatarWrap);
  tile.appendChild(info);

  document.getElementById('video-grid').appendChild(tile);
}

function removeVideoTile(socketId) {
  document.getElementById(`tile-${socketId}`)?.remove();
}

// ─── Grid Layout ─────────────────────────────────────────────────────────────
function updateGridLayout() {
  const grid = document.getElementById('video-grid');
  const count = document.querySelectorAll('.video-tile').length;

  grid.className = 'video-grid ' + (
    count === 1 ? 'grid-1' :
      count === 2 ? 'grid-2' :
        count <= 4 ? 'grid-4' :
          count <= 6 ? 'grid-6' :
            count <= 9 ? 'grid-9' : 'grid-12'
  );

  document.getElementById('participant-count').textContent = count;
}

// ─── Controls ────────────────────────────────────────────────────────────────
function initControls() {
  // Mic
  document.getElementById('btn-mic').addEventListener('click', () => setAudio(!Room.audioEnabled));

  // Camera
  document.getElementById('btn-camera').addEventListener('click', () => setVideo(!Room.videoEnabled));

  // Screen Share
  document.getElementById('btn-screen').addEventListener('click', toggleScreenShare);

  // Emoji
  const emojiPicker = document.getElementById('emoji-picker');
  document.getElementById('btn-emoji').addEventListener('mousedown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (emojiPicker.classList.contains('hidden')) {
      emojiPicker.classList.remove('hidden');
    } else {
      emojiPicker.classList.add('hidden');
    }
    const moreMenu = document.getElementById('more-options'); if (moreMenu) moreMenu.style.display = 'none';
  });
  document.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      sendEmojiReaction(btn.dataset.emoji);
      emojiPicker.classList.add('hidden');
    });
  });

  // Raise Hand
  document.getElementById('btn-hand').addEventListener('click', toggleHand);

  // End Call
  document.getElementById('btn-end').addEventListener('click', () => {
    if (Room.isHost) {
      if (confirm('End meeting for all participants?')) endMeeting();
      else leaveMeeting();
    } else {
      leaveMeeting();
    }
  });

  // Chat panel
  document.getElementById('btn-chat').addEventListener('click', () => togglePanel('chat'));

  // Participants panel
  document.getElementById('btn-participants').addEventListener('click', () => togglePanel('participants'));

  // Close panel
  document.getElementById('close-panel')?.addEventListener('click', closePanel);

  // Panel tabs
  document.querySelectorAll('.panel-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Attach File Button
  const attachBtn = document.getElementById('chat-attach-btn');
  const fileInput = document.getElementById('chat-file-input');
  const panelUploadBtn = document.getElementById('panel-upload-btn');

  attachBtn?.addEventListener('click', () => {
    fileInput?.click();
  });

  panelUploadBtn?.addEventListener('click', () => {
    fileInput?.click();
  });

  fileInput?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await uploadAndShareFile(file);
    fileInput.value = '';
  });

  // Whiteboard
  document.getElementById('btn-whiteboard')?.addEventListener('click', () => {
    const pwd = new URLSearchParams(window.location.search).get('pwd') || '';
    window.open(url('pages/dashboard/whiteboard.html') + `?meeting=${Room.meetingId}&pwd=${pwd}`, '_blank');
  });

  // View toggle
  document.getElementById('btn-view').addEventListener('click', toggleView);

  // Close emoji picker when clicking anywhere outside
  document.addEventListener('click', (e) => {
    if (!emojiPicker.contains(e.target) && !document.getElementById('btn-emoji').contains(e.target)) {
      emojiPicker.classList.add('hidden');
    }
  });

  // Chat input
  const chatInput = document.getElementById('chat-input');
  let typingTimer;

  chatInput?.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
    Room.socket.emit('typing-start');
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => Room.socket.emit('typing-stop'), 1500);
  });

  chatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });

  document.getElementById('send-message-btn')?.addEventListener('click', sendChatMessage);

  // Meeting ID copy
  document.getElementById('meeting-id-badge')?.addEventListener('click', () => {
    Utils.copyToClipboard(`${window.location.origin}/pages/meeting/room.html?id=${Room.meetingId}`);
  });

  // Notes
  document.getElementById('close-notes')?.addEventListener('click', () => document.getElementById('notes-modal').classList.add('hidden'));
  document.getElementById('close-notes-btn')?.addEventListener('click', () => document.getElementById('notes-modal').classList.add('hidden'));
  document.getElementById('save-notes-btn')?.addEventListener('click', saveNotes);

  // Host controls visibility
  if (!Room.isHost) {
    document.getElementById('opt-lock')?.remove();
    document.getElementById('waiting-room-section')?.remove();
  }

  // CSP click event listeners
  const partList = document.getElementById('participant-list');
  partList?.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const socketId = btn.dataset.socketId;
    const action = btn.dataset.action;
    if (!socketId || !action) return;
    if (action === 'mute') {
      hostMute(socketId);
    } else if (action === 'remove') {
      hostRemove(socketId);
    }
  });

  // Chat file download click listener
  const chatMessages = document.getElementById('chat-messages');
  chatMessages?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action="download-file"]');
    if (!btn) return;
    const fileId = btn.dataset.fileId;
    const fileName = btn.dataset.fileName;
    if (fileId) {
      downloadFile(fileId, fileName);
    }
  });

  // Files list download click listener
  const filesList = document.getElementById('meeting-files-list');
  filesList?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action="download-file"]');
    if (!btn) return;
    const fileId = btn.dataset.fileId;
    const fileName = btn.dataset.fileName;
    if (fileId) {
      downloadFile(fileId, fileName);
    }
  });
}

function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'm' || e.key === 'M') setAudio(!Room.audioEnabled);
    if (e.key === 'v' || e.key === 'V') setVideo(!Room.videoEnabled);
    if (e.key === 's' || e.key === 'S') toggleScreenShare();
    if (e.key === 'h' || e.key === 'H') toggleHand();
    if (e.key === 'c' || e.key === 'C') togglePanel('chat');
    if (e.key === 'p' || e.key === 'P') togglePanel('participants');
    if (e.key === 'Escape') closePanel();
  });
}

// ─── Audio / Video Controls ──────────────────────────────────────────────────
function setAudio(enabled) {
  Room.audioEnabled = enabled;
  Room.localStream?.getAudioTracks().forEach(t => t.enabled = enabled);
  const btn = document.getElementById('btn-mic');
  btn?.classList.toggle('off', !enabled);
  // Update only the icon text node — preserve the <span class="ctrl-btn-label"> child
  const micIconNode = btn && Array.from(btn.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
  if (micIconNode) micIconNode.textContent = enabled ? '🎤\n          ' : '🔇\n          ';
  const localMicBadge = document.querySelector('#tile-local .mic-badge');
  if (localMicBadge) localMicBadge.style.display = enabled ? 'none' : 'flex';
  Room.socket.emit('toggle-audio', { enabled });
}

function setVideo(enabled) {
  Room.videoEnabled = enabled;
  Room.localStream?.getVideoTracks().forEach(t => t.enabled = enabled);
  const btn = document.getElementById('btn-camera');
  btn?.classList.toggle('off', !enabled);
  // Update only the icon text node — preserve the <span class="ctrl-btn-label"> child
  const camIconNode = btn && Array.from(btn.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
  if (camIconNode) camIconNode.textContent = enabled ? '📹\n          ' : '🚫\n          ';

  const localVideo = document.getElementById('video-local');
  const localAvatar = document.querySelector('#tile-local .tile-overlay.hidden-bg');
  if (localVideo) localVideo.style.display = enabled ? 'block' : 'none';
  if (localAvatar) localAvatar.style.display = enabled ? 'none' : 'flex';

  Room.socket.emit('toggle-video', { enabled });
}

async function toggleScreenShare() {
  if (Room.screenSharing) {
    Room.screenSharing = false;
    Room.screenStream?.getTracks().forEach(t => t.stop());
    Room.screenStream = null;

    // Restore camera track in peer connections
    const videoTrack = Room.localStream.getVideoTracks()[0];
    Object.values(Room.peerConnections).forEach(pc => {
      const sender = pc.getSenders().find(s => s.track?.kind === 'video');
      if (sender) {
        if (videoTrack) {
          sender.replaceTrack(videoTrack);
        } else {
          pc.removeTrack(sender);
        }
      }
    });

    const localVideo = document.getElementById('video-local');
    if (localVideo) localVideo.srcObject = Room.localStream;

    document.getElementById('btn-screen')?.classList.remove('active');
    Room.socket.emit('screen-share-stopped');
    Toast.info('Screen sharing stopped');
  } else {
    try {
      Room.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      Room.screenSharing = true;

      const screenTrack = Room.screenStream.getVideoTracks()[0];

      // Replace video track in peer connections
      Object.values(Room.peerConnections).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) {
          sender.replaceTrack(screenTrack);
        } else {
          pc.addTrack(screenTrack, Room.localStream);
        }
      });

      const localVideo = document.getElementById('video-local');
      if (localVideo) localVideo.srcObject = Room.screenStream;

      document.getElementById('btn-screen')?.classList.add('active');
      Room.socket.emit('screen-share-started');
      Toast.success('Screen sharing started');

      screenTrack.addEventListener('ended', () => {
        if (Room.screenSharing) toggleScreenShare();
      });
    } catch (err) {
      if (err.name !== 'NotAllowedError') Toast.error('Screen share failed', err.message);
    }
  }
}

// ─── Raise Hand ──────────────────────────────────────────────────────────────
function toggleHand() {
  Room.handRaised = !Room.handRaised;
  document.getElementById('btn-hand')?.classList.toggle('active', Room.handRaised);
  Room.socket.emit('raise-hand', { raised: Room.handRaised });
  if (Room.handRaised) Toast.info('Hand raised ✋', 'Waiting for host to call on you');
}

// ─── Chat ─────────────────────────────────────────────────────────────────────
function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const content = input?.value.trim();
  if (!content) return;

  Room.socket.emit('chat-message', { content, type: 'text' });
  input.value = '';
  input.style.height = 'auto';
  Room.socket.emit('typing-stop');
}

function appendChatMessage(msg) {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  const user = Auth.getUser();
  const isOwn = msg.sender_id === user?.id || msg.sender?.id === user?.id;

  const wrapper = document.createElement('div');
  wrapper.className = `chat-message ${isOwn ? 'flex-col' : ''}`;
  wrapper.style.alignItems = isOwn ? 'flex-end' : 'flex-start';

  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${isOwn ? 'own' : ''}`;

  const isFile = msg.type === 'file' || msg.message_type === 'file';
  let contentHtml = '';
  if (isFile) {
    let fileInfo = {};
    try {
      fileInfo = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;
    } catch {
      fileInfo = { name: 'Shared File', public_url: '#' };
    }
    let icon = '📄';
    if (fileInfo.mime_type?.startsWith('image/')) icon = '🖼️';
    else if (fileInfo.mime_type?.startsWith('video/')) icon = '🎥';
    else if (fileInfo.mime_type?.startsWith('audio/')) icon = '🎵';
    else if (fileInfo.mime_type?.includes('pdf')) icon = '📕';

    contentHtml = `
      <div class="chat-file-card" style="display:flex;align-items:center;gap:8px;padding:8px;border-radius:6px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);margin-top:4px">
        <span style="font-size:20px">${icon}</span>
        <div style="flex:1;min-width:0;text-align:left">
          <div style="font-size:12px;font-weight:600;color:white;text-overflow:ellipsis;white-space:nowrap;overflow:hidden">${escHtml(fileInfo.name)}</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.4)">${fileInfo.size ? ((fileInfo.size / 1024).toFixed(1) + ' KB') : '0 KB'}</div>
        </div>
        <button data-action="download-file" data-file-id="${fileInfo.id}" data-file-name="${escHtml(fileInfo.name)}" title="Download" style="color:var(--primary-color);font-size:14px;text-decoration:none;background:none;border:none;padding:0;outline:none;cursor:pointer">⬇</button>
      </div>
    `;
  } else {
    contentHtml = `<div class="chat-text">${escHtml(msg.content)}</div>`;
  }

  bubble.innerHTML = `
    ${!isOwn ? `<div class="chat-sender">${escHtml(msg.sender?.full_name || 'Participant')}</div>` : ''}
    ${contentHtml}
    <div class="chat-time">${formatChatTime(msg.created_at || new Date())}</div>
  `;

  wrapper.appendChild(bubble);
  container.appendChild(wrapper);
  container.scrollTop = container.scrollHeight;
}

function formatChatTime(dt) {
  return new Date(dt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

// ─── Panel ────────────────────────────────────────────────────────────────────
function togglePanel(tab) {
  if (Room.panelOpen && Room.activeTab === tab) {
    closePanel();
  } else {
    openPanel(tab);
  }
}

function openPanel(tab) {
  Room.panelOpen = true;
  document.getElementById('side-panel').classList.add('open');
  switchTab(tab);
  if (tab === 'chat') {
    Room.chatUnread = 0;
    const badge = document.getElementById('chat-badge');
    if (badge) badge.style.display = 'none';
  }
}

function closePanel() {
  Room.panelOpen = false;
  document.getElementById('side-panel').classList.remove('open');
}

function switchTab(tab) {
  Room.activeTab = tab;
  document.querySelectorAll('.panel-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('chat-tab').style.display = tab === 'chat' ? 'flex' : 'none';
  document.getElementById('participants-tab').style.display = tab === 'participants' ? 'flex' : 'none';
  document.getElementById('files-tab').style.display = tab === 'files' ? 'flex' : 'none';
}

// ─── Participants List ────────────────────────────────────────────────────────
function updateParticipantList() {
  const list = document.getElementById('participant-list');
  if (!list) return;

  const user = Auth.getUser();
  const allParticipants = [
    { id: user?.id, full_name: user?.full_name || 'You', avatar_url: user?.avatar_url, isLocal: true },
    ...Object.values(Room.participants),
  ];

  list.innerHTML = allParticipants.map(p => `
    <div class="participant-item">
      <div class="avatar avatar-sm avatar-purple">${Utils.generateInitials(p.full_name)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;color:white">${escHtml(p.full_name)}${p.isLocal ? ' (You)' : ''}</div>
      </div>
      ${Room.isHost && !p.isLocal ? `
        <button data-action="mute" data-socket-id="${p.socketId}" title="Mute" style="background:none;border:none;cursor:pointer;font-size:14px;color:rgba(255,255,255,0.5)">🔇</button>
        <button data-action="remove" data-socket-id="${p.socketId}" title="Remove" style="background:none;border:none;cursor:pointer;font-size:14px;color:rgba(239,68,68,0.7)">✕</button>
      ` : ''}
    </div>
  `).join('');
}

function addWaitingParticipant(user, socketId) {
  const section = document.getElementById('waiting-room-section');
  const list = document.getElementById('waiting-list');
  const counter = document.getElementById('waiting-count');
  if (!section || !list) return;

  section.style.display = 'block';
  const current = parseInt(counter.textContent) || 0;
  counter.textContent = current + 1;

  const item = document.createElement('div');
  item.className = 'waiting-room-item';
  item.id = `waiting-${socketId}`;

  const nameSpan = document.createElement('span');
  nameSpan.style.cssText = 'font-size:13px;font-weight:600;color:white';
  nameSpan.textContent = user.full_name;

  const btnGroup = document.createElement('div');
  btnGroup.style.display = 'flex';
  btnGroup.style.gap = '8px';

  const admitBtn = document.createElement('button');
  admitBtn.className = 'btn btn-success btn-sm';
  admitBtn.textContent = 'Admit';
  admitBtn.addEventListener('click', () => admitParticipant(socketId));

  const denyBtn = document.createElement('button');
  denyBtn.className = 'btn btn-danger btn-sm';
  denyBtn.textContent = 'Deny';
  denyBtn.addEventListener('click', () => denyParticipant(socketId));

  btnGroup.appendChild(admitBtn);
  btnGroup.appendChild(denyBtn);

  item.appendChild(nameSpan);
  item.appendChild(btnGroup);
  list.appendChild(item);
}

function hostMute(socketId) {
  Room.socket.emit('mute-participant', { targetSocketId: socketId });
}

function hostRemove(socketId) {
  if (confirm('Remove this participant from the meeting?')) {
    Room.socket.emit('remove-participant', { targetSocketId: socketId });
  }
}

function admitParticipant(socketId) {
  Room.socket.emit('admit-participant', { targetSocketId: socketId });
  document.getElementById(`waiting-${socketId}`)?.remove();
  const counter = document.getElementById('waiting-count');
  if (counter) counter.textContent = Math.max(0, (parseInt(counter.textContent) || 0) - 1);
  const list = document.getElementById('waiting-list');
  if (list && list.children.length === 0) {
    const section = document.getElementById('waiting-room-section');
    if (section) section.style.display = 'none';
  }
}

function denyParticipant(socketId) {
  Room.socket.emit('reject-participant', { targetSocketId: socketId });
  document.getElementById(`waiting-${socketId}`)?.remove();
  const counter = document.getElementById('waiting-count');
  if (counter) counter.textContent = Math.max(0, (parseInt(counter.textContent) || 0) - 1);
  const list = document.getElementById('waiting-list');
  if (list && list.children.length === 0) {
    const section = document.getElementById('waiting-room-section');
    if (section) section.style.display = 'none';
  }
}

// ─── Emoji Reactions ──────────────────────────────────────────────────────────
function sendEmojiReaction(emoji) {
  Room.socket.emit('emoji-reaction', { emoji });
  showEmojiReaction(emoji, 'You');
}

function showEmojiReaction(emoji, name) {
  const overlay = document.getElementById('emoji-overlay');
  if (!overlay) return;

  const el = document.createElement('div');
  el.className = 'emoji-float';
  el.textContent = emoji;
  el.style.left = (Math.random() * 80 + 10) + '%';
  el.title = name;
  overlay.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

// ─── View Toggle ─────────────────────────────────────────────────────────────
function toggleView() {
  Room.view = Room.view === 'grid' ? 'speaker' : 'grid';

  // Update icon without clobbering the label span
  const btn = document.getElementById('btn-view');
  if (btn) {
    // Replace only the first text node (the icon)
    const iconNode = Array.from(btn.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
    const icon = Room.view === 'grid' ? '⊞' : '⊟';
    if (iconNode) {
      iconNode.textContent = icon + '\n          ';
    } else {
      btn.prepend(document.createTextNode(icon + '\n          '));
    }
  }

  const videoArea = document.getElementById('video-area');
  const videoGrid = document.getElementById('video-grid');
  if (!videoArea || !videoGrid) return;

  if (Room.view === 'speaker') {
    // Speaker view: largest tile pinned, rest in sidebar
    videoArea.classList.add('speaker-view');
    videoGrid.classList.add('hidden');

    let speakerWrap = document.getElementById('speaker-wrap');
    if (!speakerWrap) {
      speakerWrap = document.createElement('div');
      speakerWrap.id = 'speaker-wrap';
      speakerWrap.className = 'speaker-view';
      speakerWrap.style.cssText = 'display:grid;grid-template-columns:1fr 200px;width:100%;height:100%;gap:8px;padding:8px;box-sizing:border-box;';

      const main = document.createElement('div');
      main.id = 'speaker-main';
      main.className = 'speaker-main';
      main.style.cssText = 'position:relative;border-radius:12px;overflow:hidden;background:#0d0d14;';

      const sidebar = document.createElement('div');
      sidebar.id = 'speaker-sidebar';
      sidebar.className = 'speaker-sidebar';
      sidebar.style.cssText = 'display:flex;flex-direction:column;gap:8px;overflow-y:auto;';

      speakerWrap.appendChild(main);
      speakerWrap.appendChild(sidebar);
      videoArea.appendChild(speakerWrap);
    }

    const speakerMain = document.getElementById('speaker-main');
    const speakerSidebar = document.getElementById('speaker-sidebar');
    speakerMain.innerHTML = '';
    speakerSidebar.innerHTML = '';

    const tiles = Array.from(document.querySelectorAll('.video-tile'));
    tiles.forEach((tile, i) => {
      const clone = tile.cloneNode(true);
      clone.style.cssText = i === 0
        ? 'width:100%;height:100%;border-radius:12px;overflow:hidden;'
        : 'width:100%;aspect-ratio:4/3;border-radius:8px;overflow:hidden;flex-shrink:0;';
      if (i === 0) speakerMain.appendChild(clone);
      else speakerSidebar.appendChild(clone);
    });

    document.getElementById('speaker-wrap').classList.remove('hidden');
  } else {
    // Back to grid view
    videoArea.classList.remove('speaker-view');
    videoGrid.classList.remove('hidden');
    document.getElementById('speaker-wrap')?.classList.add('hidden');
  }

  Toast.info(`Switched to ${Room.view} view`);
}

// ─── PiP ─────────────────────────────────────────────────────────────────────
function togglePiP() {
  const pip = document.getElementById('pip-container');
  const video = document.getElementById('pip-video');

  if (document.pictureInPictureElement) {
    document.exitPictureInPicture().catch(() => { });
    pip?.classList.remove('visible');
    return;
  }

  if (video && document.pictureInPictureEnabled) {
    video.requestPictureInPicture().catch(() => {
      pip?.classList.toggle('visible');
    });
  } else {
    pip?.classList.toggle('visible');
  }
}

// ─── Notes ───────────────────────────────────────────────────────────────────
function openNotes() {
  document.getElementById('notes-modal')?.classList.remove('hidden');
}

async function saveNotes() {
  const content = document.getElementById('notes-content')?.value;
  Room.socket.emit('meeting-note', { content });
  Toast.success('Notes saved');
  document.getElementById('notes-modal')?.classList.add('hidden');
}

// ─── Timer ───────────────────────────────────────────────────────────────────
function startTimer() {
  Room.timerStart = Date.now();
  Room.timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - Room.timerStart) / 1000);
    const h = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60);
    const s = elapsed % 60;
    const str = h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    document.getElementById('meeting-timer').textContent = str;
    document.getElementById('meeting-timer-mobile').textContent = str;
  }, 1000);
}

// ─── Control State UI ────────────────────────────────────────────────────────
function updateControlStates() {
  setAudio(Room.audioEnabled);
  setVideo(Room.videoEnabled);
}

// ─── End / Leave Meeting ──────────────────────────────────────────────────────
async function leaveMeeting() {
  cleanup();
  try { await API.post(`/api/meetings/${Room.meetingDbId}/join`); } catch { }
  window.location.href = url('pages/dashboard/index.html');
}

async function endMeeting() {
  cleanup();
  try { await API.post(`/api/meetings/${Room.meetingDbId}/end`); } catch { }
  window.location.href = url('pages/dashboard/index.html');
}

function cleanup() {
  clearInterval(Room.timerInterval);
  Room.localStream?.getTracks().forEach(t => t.stop());
  Room.screenStream?.getTracks().forEach(t => t.stop());
  Object.values(Room.peerConnections).forEach(pc => pc.close());
  Room.socket?.emit('leave-room');
  Room.socket?.disconnect();
}

// ─── Loading Helpers ──────────────────────────────────────────────────────────
function showLoading(msg) {
  document.getElementById('loading-screen').style.display = 'flex';
  document.getElementById('loading-msg').textContent = msg || 'Loading...';
}

function hideLoading() {
  document.getElementById('loading-screen').style.display = 'none';
}

function escHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function loadSharedFiles() {
  try {
    const res = await API.get(`/api/files?meeting_id=${encodeURIComponent(Room.meetingDbId)}`);
    const files = res.data?.files || res.data || [];
    const list = document.getElementById('meeting-files-list');
    const emptyState = document.getElementById('files-empty-state');
    if (!list) return;

    const items = list.querySelectorAll('.file-item');
    items.forEach(it => it.remove());

    if (files.length > 0) {
      if (emptyState) emptyState.style.display = 'none';
      files.forEach(file => {
        list.appendChild(renderFileItem(file));
      });
    } else {
      if (emptyState) emptyState.style.display = 'block';
    }
  } catch (err) {
    console.error('Failed to load shared files:', err);
  }
}

function addToFilePaneList(fileInfo) {
  const list = document.getElementById('meeting-files-list');
  const emptyState = document.getElementById('files-empty-state');
  if (!list) return;

  if (list.querySelector(`[data-file-id="${fileInfo.id}"]`)) return;

  if (emptyState) emptyState.style.display = 'none';
  const item = renderFileItem(fileInfo);
  item.setAttribute('data-file-id', fileInfo.id);
  list.appendChild(item);
}

function renderFileItem(file) {
  const item = document.createElement('div');
  item.className = 'file-item';
  item.style.cssText = 'padding:10px 12px;border:1px solid rgba(255,255,255,0.06);background:rgba(255,255,255,0.02);border-radius:6px;margin-bottom:8px;position:relative;display:flex;align-items:center;gap:10px';

  let icon = '📄';
  if (file.mime_type?.startsWith('image/')) icon = '🖼️';
  else if (file.mime_type?.startsWith('video/')) icon = '🎥';
  else if (file.mime_type?.startsWith('audio/')) icon = '🎵';
  else if (file.mime_type?.includes('pdf')) icon = '📕';

  const sizeStr = file.size ? ((file.size / 1024).toFixed(1) + ' KB') : '0 KB';
  const uploaderName = file.uploader?.full_name || 'Participant';

  item.innerHTML = `
    <div style="font-size:20px">${icon}</div>
    <div style="flex:1;min-width:0;text-align:left">
      <div style="font-size:13px;font-weight:600;color:white;text-overflow:ellipsis;white-space:nowrap;overflow:hidden">${escHtml(file.name)}</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.4)">
        ${sizeStr} • ${escHtml(uploaderName)}
      </div>
    </div>
    <button data-action="download-file" data-file-id="${file.id}" data-file-name="${escHtml(file.name)}" class="btn btn-ghost btn-icon btn-sm" title="Download" style="font-size:14px;color:var(--primary-color);text-decoration:none;background:none;border:none;padding:0;outline:none;cursor:pointer">⬇</button>
  `;
  return item;
}

async function uploadAndShareFile(file) {
  Toast.show('info', 'Uploading File', `Starting upload for ${file.name}...`);
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('meeting_id', Room.meetingDbId);

    const res = await API.post('/api/files/upload', formData);
    if (!res || !res.data) {
      throw new Error('Upload request failed');
    }

    const fileRecord = res.data;
    Room.socket.emit('chat-message', {
      content: JSON.stringify(fileRecord),
      type: 'file'
    });

    Toast.show('success', 'File Uploaded', `${file.name} successfully shared.`);
  } catch (err) {
    console.error('File upload error:', err);
    Toast.show('error', 'Upload Failed', err.message || 'Failed to upload/share file');
  }
}

async function downloadFile(id, name) {
  try {
    const res = await API.get(`/api/files/${id}/download`);
    const { url } = res.data;
    const a = document.createElement('a');
    a.href = url;
    a.download = name || 'download';
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (e) {
    Toast.show('error', 'Download Failed', e.message || 'Failed to download file');
  }
}

window.addEventListener('beforeunload', cleanup);

