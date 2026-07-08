# ConnectPro 🎥
### Premium Real-Time Video Meeting & Collaboration Platform

> **Built as a Final Year / Internship-Level Project — Production Quality**

A complete, full-stack, real-time communication platform comparable to **Google Meet**, **Zoom**, **Microsoft Teams**, and **Discord**. Built with WebRTC, Socket.io, Supabase, and a premium Glassmorphism UI.

---

## ✨ Features

| Category | Features |
|---|---|
| 🎥 **Video** | HD WebRTC video, multiple participants, gallery/speaker view, voice detection |
| 🔒 **Security** | JWT auth, bcrypt, Helmet, rate limiting, Supabase RLS, CORS |
| 💬 **Chat** | Real-time messaging, emoji reactions, replies, mentions, file attachments |
| 🎨 **Whiteboard** | Canvas drawing, shapes, text, undo/redo, live sync, PNG export |
| 📁 **Files** | Drag-drop upload, Supabase Storage, preview, sharing |
| 🔔 **Notifications** | Real-time, push notifications, email reminders |
| 🎭 **UI/UX** | Glassmorphism, dark/light mode, animations, fully responsive |
| 👑 **Admin** | User management, meeting oversight, analytics, activity logs |

---

## 🛠️ Tech Stack

### Frontend
- HTML5, CSS3, Vanilla JavaScript (ES6+)
- Glassmorphism Design System with CSS Variables
- WebRTC (peer connections, screen sharing, camera/mic)
- Socket.io client for real-time features
- HTML5 Canvas whiteboard

### Backend
- Node.js + Express.js
- Socket.io (WebRTC signaling + real-time events)
- JWT + bcrypt (authentication)
- Multer (file uploads)
- Helmet + Rate Limiter (security)
- Winston (logging)

### Database & Storage
- **Supabase PostgreSQL** (database)
- **Supabase Auth** (authentication)
- **Supabase Storage** (files, avatars, recordings)
- **Row Level Security (RLS)** policies

---

## 📁 Project Structure

```
connectpro/
├── backend/
│   ├── server.js                    # Entry point
│   ├── .env.example                 # Environment template
│   ├── package.json
│   └── src/
│       ├── app.js                   # Express app
│       ├── config/
│       │   ├── index.js             # Config exports
│       │   └── supabase.js          # Supabase clients
│       ├── controllers/
│       │   ├── auth.controller.js
│       │   ├── meeting.controller.js
│       │   ├── message.controller.js
│       │   ├── user.controller.js
│       │   ├── file.controller.js
│       │   ├── whiteboard.controller.js
│       │   ├── notification.controller.js
│       │   └── admin.controller.js
│       ├── middleware/
│       │   ├── auth.middleware.js
│       │   ├── errorHandler.js
│       │   ├── upload.middleware.js
│       │   └── validation.middleware.js
│       ├── routes/
│       │   ├── auth.routes.js
│       │   ├── user.routes.js
│       │   ├── meeting.routes.js
│       │   ├── message.routes.js
│       │   ├── file.routes.js
│       │   ├── whiteboard.routes.js
│       │   ├── notification.routes.js
│       │   └── admin.routes.js
│       ├── services/
│       │   └── email.service.js
│       ├── socket/
│       │   └── index.js             # Socket.io + WebRTC signaling
│       └── utils/
│           ├── helpers.js
│           └── logger.js
│
├── frontend/
│   ├── package.json
│   └── public/
│       ├── index.html               # Landing page
│       ├── css/
│       │   ├── design-system.css    # Variables, components, utilities
│       │   ├── landing.css          # Landing page styles
│       │   └── meeting.css          # Meeting room styles
│       ├── js/
│       │   ├── app.js               # Core: API, Auth, Toast, Theme, Utils
│       │   ├── auth.js              # Auth pages logic
│       │   ├── dashboard.js         # Dashboard page logic
│       │   ├── meeting.js           # Meeting room logic
│       │   ├── webrtc.js            # WebRTC manager class
│       │   ├── whiteboard.js        # Canvas whiteboard
│       │   ├── profile.js           # Profile page
│       │   ├── settings.js          # Settings page
│       │   └── landing.js           # Landing page
│       └── pages/
│           ├── auth/
│           │   ├── login.html
│           │   ├── register.html
│           │   └── forgot-password.html
│           ├── dashboard/
│           │   ├── index.html       # Main dashboard
│           │   ├── meetings.html
│           │   ├── profile.html
│           │   ├── settings.html
│           │   ├── whiteboard.html
│           │   ├── files.html
│           │   └── notifications.html
│           └── meeting/
│               └── room.html        # Meeting room (WebRTC)
│
├── supabase/
│   └── schema.sql                   # Complete DB schema
│
└── README.md
```

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- A [Supabase](https://supabase.com) project

### 1. Clone the Repository
```bash
git clone https://github.com/your-username/connectpro.git
cd connectpro
```

### 2. Set Up Supabase
1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** → paste and run `supabase/schema.sql`
3. Enable **Email** authentication in Authentication > Providers
4. Copy your Project URL and API keys

### 3. Configure Backend
```bash
cd backend
cp .env.example .env
# Edit .env with your Supabase credentials
npm install
```

### 4. Configure Frontend
```bash
cd frontend
cp .env.example .env
# Edit .env with your Supabase credentials and backend URL
```

### 5. Start Backend
```bash
cd backend
npm run dev    # Development (nodemon)
# or
npm start      # Production
```

### 6. Serve Frontend
```bash
cd frontend
# Open public/index.html in browser directly, OR:
npx serve public -p 3000
```

---

## 🔑 Environment Variables

### Backend (`backend/.env`)

| Variable | Description | Example |
|---|---|---|
| `SUPABASE_URL` | Your Supabase project URL | `https://xxx.supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase anon/public key | `eyJ...` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | `eyJ...` |
| `JWT_SECRET` | Secret for signing JWTs (32+ chars) | `your-super-secret` |
| `SMTP_HOST` | SMTP server for emails | `smtp.gmail.com` |
| `SMTP_USER` | SMTP email address | `your@email.com` |
| `SMTP_PASS` | SMTP app password | `app-password` |
| `FRONTEND_URL` | Frontend URL for CORS | `http://localhost:3000` |
| `PORT` | Backend port | `5000` |

---

## 🗄️ Database

The complete schema (`supabase/schema.sql`) includes:

| Table | Description |
|---|---|
| `profiles` | User profiles, extends Supabase auth |
| `user_settings` | Per-user preferences |
| `meetings` | Meeting rooms with metadata |
| `meeting_participants` | Who joined each meeting |
| `meeting_messages` | Real-time chat messages |
| `files` | Uploaded files with storage references |
| `whiteboards` | Whiteboard sessions |
| `whiteboard_elements` | Individual drawing elements |
| `notifications` | User notifications |
| `meeting_invitations` | Email invites to meetings |
| `meeting_recordings` | Recording metadata |
| `activity_logs` | Audit trail of all actions |
| `reports` | User content reports |

All tables include: UUID PKs, `created_at`, `updated_at`, indexes, FK constraints, cascade deletes, and RLS policies.

---

## 🔐 Authentication

Authentication uses **Supabase Auth** with:
- Email + Password registration/login
- Email verification flow
- Forgot/reset password via Supabase magic link
- JWT tokens issued by backend for API auth
- Remember Me (30-day sessions)
- Role-based access: `admin`, `moderator`, `user`

---

## 📡 WebRTC

The meeting room implements full WebRTC:
- STUN servers (Google free servers)
- TURN server support (configurable)
- ICE candidate exchange via Socket.io
- Audio/video tracks with toggle
- Screen sharing (getDisplayMedia)
- Voice activity detection (Web Audio API)
- Auto-reconnect on connection failure
- Multiple participant grid layouts

---

## 🎨 UI Features

- **Glassmorphism** design with blur effects
- **Dark mode** (default) and **light mode** toggle
- **Theme persistence** via localStorage
- **Smooth animations** (page transitions, card hover, modals)
- **Toast notifications** with progress bars
- **Skeleton loading** states
- **Empty states** with CTAs
- **Fully responsive** (mobile, tablet, desktop)

---

## 📺 Pages

| Page | URL |
|---|---|
| Landing | `/index.html` |
| Login | `/pages/auth/login.html` |
| Register | `/pages/auth/register.html` |
| Forgot Password | `/pages/auth/forgot-password.html` |
| Dashboard | `/pages/dashboard/index.html` |
| Meetings | `/pages/dashboard/meetings.html` |
| Profile | `/pages/dashboard/profile.html` |
| Settings | `/pages/dashboard/settings.html` |
| Whiteboard | `/pages/dashboard/whiteboard.html` |
| Files | `/pages/dashboard/files.html` |
| Notifications | `/pages/dashboard/notifications.html` |
| Meeting Room | `/pages/meeting/room.html?id=<meeting-id>` |

---

## 🔧 API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/logout` | Logout |
| POST | `/api/auth/refresh` | Refresh JWT |
| POST | `/api/auth/forgot-password` | Send reset email |
| GET | `/api/auth/me` | Get current user |
| GET | `/api/users/me` | Get own profile |
| PATCH | `/api/users/me` | Update profile |
| POST | `/api/users/me/avatar` | Upload avatar |
| GET | `/api/meetings` | List meetings |
| POST | `/api/meetings` | Create meeting |
| GET | `/api/meetings/dashboard` | Dashboard data |
| POST | `/api/meetings/:id/join` | Join meeting |
| POST | `/api/meetings/:id/end` | End meeting |
| GET | `/api/messages/:meetingId` | Get chat messages |
| POST | `/api/messages` | Send message |
| POST | `/api/files/upload` | Upload file |
| GET | `/api/files` | List files |
| GET | `/api/notifications` | Get notifications |
| GET | `/api/admin/dashboard` | Admin overview |
| GET | `/api/admin/users` | Manage users |

---

## 📡 Socket.io Events

| Event | Direction | Description |
|---|---|---|
| `join-room` | Client → Server | Join a meeting room |
| `room-joined` | Server → Client | Successfully joined |
| `user-joined` | Server → All | New participant joined |
| `participant-left` | Server → All | Participant left |
| `webrtc-offer` | Client ↔ Client | SDP offer (via server) |
| `webrtc-answer` | Client ↔ Client | SDP answer |
| `webrtc-ice-candidate` | Client ↔ Client | ICE candidate |
| `toggle-audio` | Client → All | Mute/unmute |
| `toggle-video` | Client → All | Camera on/off |
| `screen-share-started` | Client → All | Screen sharing |
| `raise-hand` | Client → All | Hand raised |
| `chat-message` | Client → All | Chat message |
| `emoji-reaction` | Client → All | Emoji reaction |
| `whiteboard-draw` | Client → All | Drawing event |
| `whiteboard-clear` | Client → All | Clear canvas |
| `mute-participant` | Host → Target | Force mute |
| `remove-participant` | Host → Target | Remove from meeting |
| `toggle-lock-room` | Host → All | Lock/unlock |
| `admit-participant` | Host → Waiting | Admit from waiting room |

---

## 🚢 Deployment

### Backend (Node.js)
Deploy to **Railway**, **Render**, **Heroku**, or **VPS**:
```bash
# Set environment variables on your hosting platform
# Then:
npm start
```

### Frontend
Deploy to **Vercel**, **Netlify**, **GitHub Pages**, or any static host:
```bash
# Upload the frontend/public directory
# Set BACKEND_URL in your config
```

### Supabase
- Already cloud-hosted — just run the SQL schema
- Enable Row Level Security (already configured in schema)
- Set up email authentication in Auth settings

---

## 🛡️ Security Features

- ✅ Helmet.js HTTP headers
- ✅ CORS with allowed origins whitelist
- ✅ Express rate limiting (100 req/15min, 10 auth req/15min)
- ✅ JWT with short expiry + refresh tokens
- ✅ bcrypt password hashing (rounds: 12)
- ✅ Input validation with express-validator
- ✅ Supabase Row Level Security policies
- ✅ Secure HttpOnly cookies
- ✅ XSS protection via content sanitization
- ✅ SQL injection prevention via Supabase parameterized queries
- ✅ File type validation and size limits

---

## 👨‍💻 Development

```bash
# Run backend in development mode
cd backend && npm run dev

# Watch for CSS changes (optional)
cd frontend && npm run dev

# Run tests
cd backend && npm test
```

---

## 📄 License

MIT License — Free to use, modify, and distribute.

---

## 🙏 Acknowledgements

- [Supabase](https://supabase.com) — Database, Auth & Storage
- [Socket.io](https://socket.io) — Real-time communication
- [WebRTC](https://webrtc.org) — Peer-to-peer media
- [Express.js](https://expressjs.com) — Backend framework
- [Google STUN Servers](https://webrtc.org/getting-started/turn-server) — ICE servers

---

<div align="center">
  <strong>ConnectPro</strong> — Built with ❤️ for modern teams
</div>
