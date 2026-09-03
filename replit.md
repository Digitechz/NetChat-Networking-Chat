# NetChat

NetChat is a real-time one-to-one messaging application that makes client-server networking visible for a college project demonstration.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — development PostgreSQL connection string
- Required env: `SESSION_SECRET` — session token hashing secret

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/netchat/src/App.tsx` — authenticated UI, auth screens, and WebSocket client
- `artifacts/netchat/src/index.css` — NetChat visual tokens and global styles
- `artifacts/api-server/src/routes/` — REST routes for auth, users, and history
- `artifacts/api-server/src/lib/realtime.ts` — WebSocket protocol, routing, delivery, presence, and file messages
- `artifacts/api-server/src/lib/objectStorage.ts` and `routes/storage.ts` — private App Storage uploads and conversation-authorized downloads
- `artifacts/api-server/src/lib/auth.ts` — password hashing and cookie-backed sessions
- `lib/db/src/schema/` — users, sessions, and messages tables, including file metadata
- `lib/api-spec/openapi.yaml` — REST contract source of truth
- `README.md` — runbook, demo accounts, protocol, and networking explanations

## Architecture decisions

- The workspace-provided PostgreSQL database is used through Drizzle so the app runs in the hosted project without introducing a second database service.
- Authentication is intentionally local because the project requires username/password registration; passwords use Node `scrypt` and sessions use HttpOnly cookies.
- WebSocket messages use a small `{ type, payload }` envelope so the protocol is easy to explain during a networking viva.
- The server keeps a set of sockets per user, allowing reconnects and multiple demonstration windows without incorrectly marking a user offline.
- Group chat remains deferred; small text-file sharing is supported in one-to-one conversations.

## Product

Users can register or use seeded demo accounts, browse other registered users,
open persisted direct conversations, send messages over WebSocket, see delivery
and read states, observe typing and presence changes, and inspect live network
connection details.

## User preferences

- Keep the project focused on a dependable, easy-to-explain college networking demonstration rather than speculative features.

## Gotchas

- The API server owns both REST (`/api`) and WebSocket (`/ws`) traffic; the WebSocket path must remain listed in the API artifact routing configuration.
- Run API schema codegen after OpenAPI changes before using generated hooks or validators.
- Demo accounts are seeded on API startup and use `password123` only for local demonstration.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
