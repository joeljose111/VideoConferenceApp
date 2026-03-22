# MeetUp Video Chat

This app has 2 deployable services:

- Frontend: Next.js app in the project root
- Backend: Socket.IO signaling server in `socket/`

## 1) Local Setup

### Frontend env

Copy `.env.example` to `.env.local` and fill values:

```bash
cp .env.example .env.local
```

Required frontend variables:

- `NEXT_PUBLIC_SOCKET_URL`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`

### Backend env

Copy `socket/.env.example` to `socket/.env` and fill values:

```bash
cp socket/.env.example socket/.env
```

Required backend variables:

- `PORT` (default: `8000`)
- `CLIENT_ORIGIN` (frontend URL, or comma-separated URLs)

### Run both services

Terminal 1:

```bash
cd socket
npm install
npm run dev
```

Terminal 2:

```bash
npm install
npm run dev
```

## 2) Separate Deployment (Recommended)

Deploy frontend and backend as separate services.

### Backend service (Socket.IO)

- Root directory: `socket`
- Build command: `npm install`
- Start command: `npm run start`

Backend environment variables:

- `PORT` (set by most platforms automatically)
- `CLIENT_ORIGIN=https://your-frontend-domain.com`

Health endpoint:

- `GET /health` returns `{ "status": "ok" }`

### Frontend service (Next.js)

- Root directory: project root
- Build command: `npm install && npm run build`
- Start command: `npm run start`

Frontend environment variables:

- `NEXT_PUBLIC_SOCKET_URL=https://your-backend-domain.com`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...`
- `CLERK_SECRET_KEY=...`

## 3) Render Blueprint (Optional)

If you want both services provisioned in one action on Render, use `render.yaml`.
It still creates two separate services, but from one deploy flow.
