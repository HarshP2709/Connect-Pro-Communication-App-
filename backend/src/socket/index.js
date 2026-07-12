'use strict';

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('../config/supabase');
const { jwtSecret } = require('../config');
const logger = require('../utils/logger');

// Room state in memory (for production use Redis)
const rooms = new Map(); // meetingId => { participants, host, locked }

let io;

const SOCKET_ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL,
  'https://connect-pro-communication-app.vercel.app',
  'https://connect-pro-communication-r58ut0gqb.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5500',    // VS Code Live Server
  'http://127.0.0.1:5500',
  'http://localhost:5173',    // Vite dev server
  'http://127.0.0.1:5173',
].filter(Boolean);

const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (origin.endsWith('.vercel.app')) return callback(null, true);
        if (SOCKET_ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
        callback(new Error(`Socket CORS: origin '${origin}' not allowed`));
      },
      credentials: true,
      methods: ['GET', 'POST'],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // ─── Auth Middleware ────────────────────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
      if (!token) return next(new Error('Authentication required'));

      const decoded = jwt.verify(token, jwtSecret);
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, avatar_url, role, is_active')
        .eq('id', decoded.sub)
        .single();

      if (!profile || !profile.is_active) return next(new Error('User not found'));

      socket.user = profile;
      socket.userId = profile.id;
      next();
    } catch (err) {
      logger.warn(`Socket auth failed: ${err.message}`);
      next(new Error('Invalid token'));
    }
  });

  // ─── Connection ─────────────────────────────────────────────────────────────
  io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.user.full_name} (${socket.id})`);

    // Update online status
    supabaseAdmin.from('profiles').update({ last_seen: new Date().toISOString(), is_online: true }).eq('id', socket.userId);

    // ─── Meeting Room ───────────────────────────────────────────────────────
    socket.on('join-room', async ({ meetingId, password }) => {
      try {
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const isUUID = UUID_RE.test(meetingId);

        let meetingQuery = supabaseAdmin.from('meetings').select('*');
        meetingQuery = isUUID
          ? meetingQuery.or(`id.eq.${meetingId},meeting_id.eq.${meetingId}`)
          : meetingQuery.eq('meeting_id', meetingId);

        const { data: meeting } = await meetingQuery.maybeSingle();

        if (!meeting) return socket.emit('error', { message: 'Meeting not found' });
        if (meeting.status === 'ended') return socket.emit('error', { message: 'Meeting has ended' });
        if (meeting.password && meeting.password !== password) {
          return socket.emit('error', { message: 'Incorrect meeting password' });
        }

        const roomId = meeting.meeting_id;

        // Init room
        if (!rooms.has(roomId)) {
          rooms.set(roomId, {
            meetingId: meeting.id,
            host: meeting.host_id,
            participants: new Map(),
            locked: false,
            waitingRoom: [],
          });
        }

        const room = rooms.get(roomId);

        // Waiting room check
        if (room.locked && socket.userId !== room.host) {
          socket.emit('waiting-room', { message: 'Waiting for host to admit you' });
          room.waitingRoom.push({ socketId: socket.id, user: socket.user });
          io.to(room.host).emit('participant-waiting', { user: socket.user, socketId: socket.id });
          return;
        }

        socket.join(roomId);
        socket.currentRoom = roomId;

        room.participants.set(socket.id, {
          ...socket.user,
          socketId: socket.id,
          audioEnabled: true,
          videoEnabled: true,
          screenSharing: false,
          handRaised: false,
        });

        // Notify others
        socket.to(roomId).emit('user-joined', {
          user: socket.user,
          socketId: socket.id,
          participants: Array.from(room.participants.values()),
        });

        // Send current participants to joiner
        socket.emit('room-joined', {
          meeting,
          participants: Array.from(room.participants.values()),
          isHost: meeting.host_id === socket.userId,
        });

        // Create notification for host
        if (meeting.host_id !== socket.userId) {
          await supabaseAdmin.from('notifications').insert({
            user_id: meeting.host_id,
            type: 'meeting_join',
            title: 'Participant joined',
            message: `${socket.user.full_name} joined your meeting`,
            data: { meeting_id: meeting.id, user_id: socket.userId },
          });
        }

        logger.info(`${socket.user.full_name} joined room ${roomId}`);
      } catch (err) {
        logger.error('join-room error:', err);
        socket.emit('error', { message: 'Failed to join meeting' });
      }
    });

    // ─── WebRTC Signaling ───────────────────────────────────────────────────
    socket.on('webrtc-offer', ({ to, offer }) => {
      io.to(to).emit('webrtc-offer', { from: socket.id, offer, user: socket.user });
    });

    socket.on('webrtc-answer', ({ to, answer }) => {
      io.to(to).emit('webrtc-answer', { from: socket.id, answer });
    });

    socket.on('webrtc-ice-candidate', ({ to, candidate }) => {
      io.to(to).emit('webrtc-ice-candidate', { from: socket.id, candidate });
    });

    // ─── Media State ────────────────────────────────────────────────────────
    socket.on('toggle-audio', ({ enabled }) => {
      if (!socket.currentRoom) return;
      const room = rooms.get(socket.currentRoom);
      if (room?.participants.has(socket.id)) {
        room.participants.get(socket.id).audioEnabled = enabled;
      }
      socket.to(socket.currentRoom).emit('participant-audio-changed', { socketId: socket.id, enabled });
    });

    socket.on('toggle-video', ({ enabled }) => {
      if (!socket.currentRoom) return;
      const room = rooms.get(socket.currentRoom);
      if (room?.participants.has(socket.id)) {
        room.participants.get(socket.id).videoEnabled = enabled;
      }
      socket.to(socket.currentRoom).emit('participant-video-changed', { socketId: socket.id, enabled });
    });

    socket.on('screen-share-started', () => {
      if (!socket.currentRoom) return;
      socket.to(socket.currentRoom).emit('screen-share-started', { socketId: socket.id, user: socket.user });
    });

    socket.on('screen-share-stopped', () => {
      if (!socket.currentRoom) return;
      socket.to(socket.currentRoom).emit('screen-share-stopped', { socketId: socket.id });
    });

    // ─── Raise Hand ─────────────────────────────────────────────────────────
    socket.on('raise-hand', ({ raised }) => {
      if (!socket.currentRoom) return;
      const room = rooms.get(socket.currentRoom);
      if (room?.participants.has(socket.id)) {
        room.participants.get(socket.id).handRaised = raised;
      }
      io.to(socket.currentRoom).emit('hand-raised', { socketId: socket.id, user: socket.user, raised });
    });

    // ─── Chat ────────────────────────────────────────────────────────────────
    socket.on('chat-message', async (messageData) => {
      if (!socket.currentRoom) return;
      try {
        const { data: msg } = await supabaseAdmin
          .from('meeting_messages')
          .insert({
            meeting_id: rooms.get(socket.currentRoom)?.meetingId,
            sender_id: socket.userId,
            content: messageData.content,
            message_type: messageData.type || 'text',
            reply_to: messageData.reply_to || null,
          })
          .select('*, sender:profiles!meeting_messages_sender_id_fkey(id, full_name, avatar_url)')
          .single();

        io.to(socket.currentRoom).emit('chat-message', msg);
      } catch (err) {
        logger.error('chat-message error:', err);
      }
    });

    socket.on('typing-start', () => {
      socket.to(socket.currentRoom).emit('typing-start', { user: socket.user });
    });

    socket.on('typing-stop', () => {
      socket.to(socket.currentRoom).emit('typing-stop', { socketId: socket.id });
    });

    // ─── Emoji Reactions ────────────────────────────────────────────────────
    socket.on('emoji-reaction', ({ emoji }) => {
      if (!socket.currentRoom) return;
      io.to(socket.currentRoom).emit('emoji-reaction', { user: socket.user, emoji });
    });

    // ─── Host Controls ───────────────────────────────────────────────────────
    socket.on('mute-participant', ({ targetSocketId }) => {
      if (!socket.currentRoom) return;
      const room = rooms.get(socket.currentRoom);
      if (room?.host !== socket.userId) return;
      io.to(targetSocketId).emit('force-mute');
    });

    socket.on('remove-participant', ({ targetSocketId }) => {
      if (!socket.currentRoom) return;
      const room = rooms.get(socket.currentRoom);
      if (room?.host !== socket.userId) return;
      io.to(targetSocketId).emit('removed-from-meeting');
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) targetSocket.leave(socket.currentRoom);
      room.participants.delete(targetSocketId);
      io.to(socket.currentRoom).emit('participant-left', { socketId: targetSocketId });
    });

    socket.on('toggle-lock-room', ({ locked }) => {
      if (!socket.currentRoom) return;
      const room = rooms.get(socket.currentRoom);
      if (room?.host !== socket.userId) return;
      room.locked = locked;
      io.to(socket.currentRoom).emit('room-locked', { locked });
    });

    socket.on('admit-participant', ({ targetSocketId }) => {
      if (!socket.currentRoom) return;
      const room = rooms.get(socket.currentRoom);
      if (room?.host !== socket.userId) return;
      const waiting = room.waitingRoom.find((p) => p.socketId === targetSocketId);
      if (waiting) {
        room.waitingRoom = room.waitingRoom.filter((p) => p.socketId !== targetSocketId);
        io.to(targetSocketId).emit('admitted', { room: socket.currentRoom });
      }
    });

    // ─── Whiteboard Sync ─────────────────────────────────────────────────────
    socket.on('whiteboard-draw', (data) => {
      if (!socket.currentRoom) return;
      socket.to(socket.currentRoom).emit('whiteboard-draw', { ...data, user: socket.user });
    });

    socket.on('whiteboard-clear', () => {
      if (!socket.currentRoom) return;
      io.to(socket.currentRoom).emit('whiteboard-clear');
    });

    socket.on('whiteboard-undo', (data) => {
      if (!socket.currentRoom) return;
      socket.to(socket.currentRoom).emit('whiteboard-undo', data);
    });

    // ─── Meeting Notes ────────────────────────────────────────────────────────
    socket.on('meeting-note', async ({ content }) => {
      if (!socket.currentRoom) return;
      const room = rooms.get(socket.currentRoom);
      if (room?.meetingId) {
        await supabaseAdmin.from('meetings').update({ notes: content }).eq('id', room.meetingId);
      }
      socket.to(socket.currentRoom).emit('meeting-note-updated', { content, user: socket.user });
    });

    // ─── Disconnect ──────────────────────────────────────────────────────────
    socket.on('leave-room', () => handleLeave(socket));
    socket.on('disconnect', () => handleLeave(socket));
  });

  return io;
};

const handleLeave = (socket) => {
  if (socket.currentRoom) {
    const room = rooms.get(socket.currentRoom);
    if (room) {
      room.participants.delete(socket.id);
      if (room.participants.size === 0) {
        rooms.delete(socket.currentRoom);
      }
    }
    socket.to(socket.currentRoom).emit('participant-left', { socketId: socket.id, user: socket.user });
    socket.leave(socket.currentRoom);
    logger.info(`${socket.user?.full_name} left room ${socket.currentRoom}`);
  }
  supabaseAdmin.from('profiles').update({ last_seen: new Date().toISOString(), is_online: false }).eq('id', socket.userId);
};

const getIO = () => io;

module.exports = { initSocket, getIO };
