# NetChat

NetChat is a small, real-time one-to-one messaging application built for a
college Computer Networking project. It demonstrates client-server
architecture, WebSocket communication, server-side message routing, presence,
delivery states, authentication, and database persistence.

## Architecture

```text
Client A (React + Vite)
        |
        | WebSocket: /ws
        v
Node.js API + WebSocket server
        |
        | Drizzle ORM
        v
PostgreSQL database
        ^
        |
Client B (React + Vite)
```

The server is the source of truth for identity, routing, message storage, and
presence. A client never gets to choose its own sender ID: the server derives
the sender from the authenticated session cookie.

## Features

- Registration and login with salted `scrypt` password hashes
- Cookie-backed server sessions
- User directory with online/offline indicators and last-seen timestamps
- One-to-one chat history that survives refreshes
- Real-time WebSocket messaging and server-side recipient routing
- Sent, delivered, and read message states
- Real-time typing indicator
- Automatic WebSocket reconnection with visible connection state
- Network Info panel showing connection state, WebSocket path, server address,
  server port, current user ID, active user count, and last received message
- Structured server logs for connect, disconnect, receive, store, and delivery
  events

## Demo accounts

The API server seeds these accounts on first startup:

| Username | Password | Display name |
| --- | --- | --- |
| `alice` | `password123` | Alice Chen |
| `bob` | `password123` | Bob Martinez |
| `charlie` | `password123` | Charlie Okafor |

Open two browser windows and log in as different accounts to demonstrate
real-time delivery and presence.

## Run locally

The Replit workspace provides `DATABASE_URL` for the development PostgreSQL
database and `SESSION_SECRET` for session hashing. In another local
environment, set those variables before running the commands below.

```bash
pnpm install
pnpm --filter @workspace/db run push
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/netchat run dev
```

The API server listens on port `8080` and the frontend uses the port assigned
by its workflow. When using the Replit preview, start both managed workflows
and open the root NetChat preview.

Useful checks:

```bash
pnpm run typecheck
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/netchat run typecheck
```

## Application-level protocol

Every WebSocket frame is JSON with a `type` and a `payload` object:

```json
{
  "type": "SEND_MESSAGE",
  "payload": {
    "receiverId": 2,
    "message": "Hello from Alice"
  }
}
```

The server authenticates the connection before accepting frames. Supported
messages include:

| Type | Direction | Purpose |
| --- | --- | --- |
| `LOGIN` | server → client | Confirms the authenticated socket and active-user count |
| `SEND_MESSAGE` | client → server | Validates, stores, and routes a message |
| `RECEIVE_MESSAGE` | server → client | Delivers a stored message |
| `MESSAGE_DELIVERED` | server → sender | Confirms the recipient was online |
| `MESSAGE_READ` | both directions | Marks a received message as read |
| `TYPING_START` / `TYPING_STOP` | both directions | Relays typing state |
| `USER_ONLINE` / `USER_OFFLINE` | server → clients | Broadcasts presence changes |
| `GET_CHAT_HISTORY` | client → server | Requests history over the socket |
| `CHAT_HISTORY` | server → client | Returns chronological history |
| `RECONNECTING` | client → UI | Indicates the client is retrying a socket |
| `ERROR` | server → client | Reports an invalid frame or server-side error |

Example server response:

```json
{
  "type": "RECEIVE_MESSAGE",
  "payload": {
    "id": 45,
    "senderId": 1,
    "receiverId": 2,
    "message": "Hello from Alice",
    "timestamp": "2026-09-02T04:12:00.000Z",
    "status": "delivered"
  }
}
```

## Networking concepts demonstrated

- **Client-server architecture:** browser clients connect to one central Node
  server instead of communicating directly.
- **WebSocket:** a persistent, bidirectional TCP-backed application channel
  for immediate events without polling for each message.
- **IP address and port:** the browser reaches the server through its host and
  port; the app exposes the WebSocket route at `/ws` and REST routes at
  `/api`.
- **Message routing:** the server looks up the authenticated sender, validates
  the receiver, stores the message, then sends it only to the receiver's
  active socket(s).
- **Persistence:** users, sessions, and messages are stored in the database,
  so history remains after refresh or reconnect.
- **Online/offline detection:** the server maintains active socket sets and
  updates `online` and `last_seen` when the final socket disconnects.

## Project structure

```text
artifacts/netchat/       React/Vite client and WebSocket client
artifacts/api-server/    Express REST API and WebSocket server
lib/db/                  Drizzle schema and database client
lib/api-spec/            OpenAPI source of truth
lib/api-client-react/    Generated React Query hooks
lib/api-zod/             Generated request/response validators
```

## Security notes

- Passwords are never logged or stored in plaintext.
- Passwords are hashed with a per-password random salt using Node `scrypt`.
- Session tokens are random, stored only as hashes, and sent via HttpOnly
  cookies.
- REST and WebSocket inputs are validated on the server.
- Message size is limited to 2,000 characters.
- Sender identity is derived from the session rather than trusted from input.