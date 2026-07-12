/**
 * ConnectPro — WebRTC Manager
 * Handles peer connections, media streams, ICE negotiation
 */
'use strict';

class WebRTCManager {
  constructor(socket, userId, iceServers) {
    this.socket = socket;
    this.userId = userId;
    this.localStream = null;
    this.screenStream = null;
    this.peers = new Map(); // socketId => RTCPeerConnection
    this.iceServers = iceServers || [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ];
    this.onRemoteStream = null;  // callback(socketId, stream, user)
    this.onPeerDisconnect = null; // callback(socketId)
    this.audioEnabled = true;
    this.videoEnabled = true;
  }

  // ── Local Media ──────────────────────────────────────────
  async initLocalStream(constraints = { video: true, audio: true }) {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      return this.localStream;
    } catch (err) {
      console.error('getUserMedia failed:', err);
      if (err.name === 'NotAllowedError') throw new Error('Camera/microphone permission denied');
      if (err.name === 'NotFoundError') throw new Error('No camera or microphone found');
      throw err;
    }
  }

  async initAudioOnly() {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.videoEnabled = false;
      return this.localStream;
    } catch (err) {
      throw new Error('Microphone permission denied');
    }
  }

  async getDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      cameras:  devices.filter(d => d.kind === 'videoinput'),
      mics:     devices.filter(d => d.kind === 'audioinput'),
      speakers: devices.filter(d => d.kind === 'audiooutput'),
    };
  }

  async switchCamera(deviceId) {
    if (!this.localStream) return;
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: deviceId } },
      audio: false,
    });
    const newTrack = newStream.getVideoTracks()[0];
    const oldTrack = this.localStream.getVideoTracks()[0];
    if (oldTrack) this.localStream.removeTrack(oldTrack);
    this.localStream.addTrack(newTrack);
    // Replace track in all peer connections
    this.peers.forEach(pc => {
      const sender = pc.getSenders().find(s => s.track?.kind === 'video');
      if (sender) sender.replaceTrack(newTrack);
    });
  }

  async switchMic(deviceId) {
    if (!this.localStream) return;
    const newStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } }, video: false });
    const newTrack = newStream.getAudioTracks()[0];
    const oldTrack = this.localStream.getAudioTracks()[0];
    if (oldTrack) this.localStream.removeTrack(oldTrack);
    this.localStream.addTrack(newTrack);
    this.peers.forEach(pc => {
      const sender = pc.getSenders().find(s => s.track?.kind === 'audio');
      if (sender) sender.replaceTrack(newTrack);
    });
  }

  // ── Audio/Video Toggle ───────────────────────────────────
  toggleAudio(enabled) {
    if (!this.localStream) return;
    this.localStream.getAudioTracks().forEach(t => t.enabled = enabled);
    this.audioEnabled = enabled;
  }

  toggleVideo(enabled) {
    if (!this.localStream) return;
    this.localStream.getVideoTracks().forEach(t => t.enabled = enabled);
    this.videoEnabled = enabled;
  }

  // ── Screen Share ─────────────────────────────────────────
  async startScreenShare() {
    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' },
        audio: true,
      });
      const screenTrack = this.screenStream.getVideoTracks()[0];

      // Replace video track in all peers
      this.peers.forEach(pc => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(screenTrack);
      });

      // Handle user stopping share from browser UI
      screenTrack.onended = () => this.stopScreenShare();
      return this.screenStream;
    } catch (err) {
      if (err.name === 'NotAllowedError') throw new Error('Screen share permission denied');
      throw err;
    }
  }

  async stopScreenShare() {
    if (!this.screenStream) return;
    this.screenStream.getTracks().forEach(t => t.stop());
    this.screenStream = null;

    // Restore camera track
    if (this.localStream && this.videoEnabled) {
      const camTrack = this.localStream.getVideoTracks()[0];
      if (camTrack) {
        this.peers.forEach(pc => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video');
          if (sender) sender.replaceTrack(camTrack);
        });
      }
    }
  }

  // ── Peer Connection ──────────────────────────────────────
  createPeerConnection(socketId, user) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });

    // Add local tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => pc.addTrack(track, this.localStream));
    }

    // ICE candidates
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.socket.emit('webrtc-ice-candidate', { to: socketId, candidate });
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (['failed', 'disconnected'].includes(pc.iceConnectionState)) {
        console.warn(`ICE ${pc.iceConnectionState} for ${socketId} — attempting restart`);
        pc.restartIce();
      }
      if (pc.iceConnectionState === 'closed') {
        this.removePeer(socketId);
      }
    };

    // Remote track
    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (this.onRemoteStream) this.onRemoteStream(socketId, remoteStream, user);
    };

    this.peers.set(socketId, pc);
    return pc;
  }

  async initiateCall(socketId, user) {
    const pc = this.createPeerConnection(socketId, user);
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await pc.setLocalDescription(offer);
    this.socket.emit('webrtc-offer', { to: socketId, offer });
  }

  async handleOffer(socketId, offer, user) {
    let pc = this.peers.get(socketId);
    if (!pc) pc = this.createPeerConnection(socketId, user);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.socket.emit('webrtc-answer', { to: socketId, answer });
  }

  async handleAnswer(socketId, answer) {
    const pc = this.peers.get(socketId);
    if (pc && pc.signalingState !== 'stable') {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
  }

  async handleIceCandidate(socketId, candidate) {
    const pc = this.peers.get(socketId);
    if (pc) {
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); }
      catch (e) { console.warn('ICE candidate error:', e); }
    }
  }

  removePeer(socketId) {
    const pc = this.peers.get(socketId);
    if (pc) { pc.close(); this.peers.delete(socketId); }
    if (this.onPeerDisconnect) this.onPeerDisconnect(socketId);
  }

  cleanup() {
    this.peers.forEach(pc => pc.close());
    this.peers.clear();
    this.localStream?.getTracks().forEach(t => t.stop());
    this.screenStream?.getTracks().forEach(t => t.stop());
    this.localStream = null;
    this.screenStream = null;
  }

  // ── Voice Activity Detection ─────────────────────────────
  startVAD(callback) {
    if (!this.localStream) return;
    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(this.localStream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    const check = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((s, v) => s + v, 0) / data.length;
      callback(avg > 15);
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }
}

window.WebRTCManager = WebRTCManager;
