# LiveConnect — Real-Time Messaging & 1-to-1 WebRTC Calling

LiveConnect is a full-stack, real-time communication application powered by a persistent local **SQLite (`node:sqlite`)** database, Express API backend, and direct 1-to-1 WebRTC peer-to-peer audio/video calling.

---

## 1. Technology Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS, Lucide Icons, Web Audio API Sound Synthesizer
- **Backend / API**: Express + Vite Middleware / Node.js (`server.ts`)
- **Database**: Persistent local SQLite (`data/liveconnect.db` via Node's built-in `node:sqlite`)
- **Audio & Video WebRTC**: Direct 1-to-1 P2P WebRTC (`WebRTCP2PSession`) with backend call signaling
- **Mobile**: Capacitor Android integration

---

## 2. Database Schema (`data/liveconnect.db`)

Initialized and migrated automatically in `/server/db.ts`:

- `users` & `sessions` — Email/password & OAuth accounts, bearer session tokens, ban/lock state
- `profiles` — Display name, unique username, avatar, bio, country, gender, online status, last seen
- `follows` & `blocked_users` — Follow / follow-back social graph and block enforcement
- `conversations` & `conversation_members` — 1-to-1 direct chats and group chats with roles & removal tracking
- `messages` & `message_reads` — Text/media messages, replies, reactions, system events, and read receipts
- `calls` & `deleted_calls` — 1-to-1 audio/video call signaling records and per-user call history
- `notifications` — Activity, follow, and message notifications
- `problem_reports` — User support tickets and bug reports

---

## 3. Running the Application

### Development Mode
```bash
npm run dev
```
Runs Express + Vite on `http://localhost:3000`.

### Production Build
```bash
npm run build
npm run start
```
