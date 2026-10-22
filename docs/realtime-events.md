# Real-time events (Socket.IO)

Socket.IO is used for chat and live updates. **MongoDB is the source of truth** — every message is persisted before it is broadcast, and clients re-fetch from the REST API after reconnecting.

- Endpoint: same host as the API, path `/socket.io`, WebSocket transport.
- Authentication: `io(API_URL, { auth: { token: <accessToken> } })`. The token is fully re-validated (user status, session, token version). Invalid tokens are refused with a `connect_error`.
- When the access token expires the server emits `auth:expired` and disconnects; refresh the token and reconnect.
- Every client → server event takes an acknowledgement callback receiving `{ ok: true, data }` or `{ ok: false, error: { code, message } }`.
- Rate limit: 40 events per 10 seconds per socket (`RATE_LIMITED`).

## Rooms (server-managed)

| Room | Joined | Receives |
|---|---|---|
| `user:<userId>` | automatically on connect | `notification:new`, `order:updated`, `quotation:updated`, `message:new` for own conversations |
| `shop:<shopId>` | automatically, if owner or worker with chats/orders/quotations permission | shop-wide `order:updated`, `quotation:updated`, `message:new` |
| `conversation:<id>` | only via `conversation:join`, authorised each time | `message:new`, `message:read`, `conversation:typing`, `conversation:presence` |

A conversation id alone grants nothing: `conversation:join`, `message:send` and `message:read` each re-check that the caller is the conversation's customer, or the shop owner / a worker with `chats.manage`. Removing a worker drops them from the shop room immediately.

## Client → server

| Event | Payload | Ack data |
|---|---|---|
| `conversation:join` | `{ conversationId }` | `{ side: 'customer' \| 'shop', otherSideOnline: boolean }` |
| `conversation:leave` | `{ conversationId }` | `{ left: true }` |
| `message:send` | `{ conversationId, clientMessageId, type: 'text' \| 'product' \| 'order' \| 'quotation', text?, productId?, orderId?, quotationId? }` | `MessageDto` |
| `message:read` | `{ conversationId }` | `{ read: true }` |
| `conversation:typing` | `{ conversationId, typing: boolean }` (must have joined) | `{ sent: true }` |

`clientMessageId` (6–64 chars) makes sends idempotent: resending the same id after a reconnect returns the original message instead of creating a duplicate. Images are sent through `POST /api/v1/conversations/:id/images`.

## Server → client

| Event | Payload |
|---|---|
| `message:new` | `MessageDto` (see `packages/shared/src/types.ts`) |
| `message:read` | `{ conversationId, side, readAt }` — `side` is the side that read |
| `conversation:typing` | `{ conversationId, userId, side, typing }` |
| `conversation:presence` | `{ conversationId, userId, side, online }` |
| `order:updated` | `{ orderId, reference, status, paymentStatus?, updatedAt? }` |
| `quotation:updated` | `{ quotationId, reference, status }` |
| `notification:new` | `NotificationDto` |
| `auth:expired` | none |

## Recovery after network loss

1. Socket.IO reconnects automatically (1–15 s backoff); `connectionStateRecovery` replays missed events for disconnects under 2 minutes.
2. On every `connect`, the mobile app re-joins open conversations and calls `GET /conversations/:id/messages?after=<last seen>` to fill gaps.
3. Order / quotation / notification screens re-fetch on focus and on these events, so a missed event only delays an update.

Multiple API instances: add the Socket.IO Redis adapter (`@socket.io/redis-adapter`) so rooms span instances. See `docs/deployment.md`.
