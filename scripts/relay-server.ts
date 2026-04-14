// @ts-nocheck

import { Database } from "bun:sqlite";

type SocketData = {
  eventId?: string;
  userId?: string;
  alias?: string;
};

type JoinMessage = {
  type: "join";
  eventId: string;
  userId: string;
  alias: string;
};

type EnvelopeMessage = {
  type: "envelope";
  envelope: {
    id: string;
    eventId: string;
    senderId: string;
    recipientIds: string[];
  };
};

const port = Number(process.env.PORT ?? 8787);
const db = new Database("backend.sqlite", { create: true });

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    phone_number TEXT NOT NULL UNIQUE,
    phone_number_display TEXT NOT NULL,
    display_name TEXT NOT NULL,
    public_key TEXT NOT NULL,
    encryption_public_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS envelopes (
    row_id INTEGER PRIMARY KEY AUTOINCREMENT,
    envelope_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    envelope_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    delivered_at TEXT
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_envelopes_unique_recipient
  ON envelopes (envelope_id, recipient_id);
`);

const upsertUserStatement = db.query(`
  INSERT INTO users (
    user_id,
    phone_number,
    phone_number_display,
    display_name,
    public_key,
    encryption_public_key,
    created_at,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    phone_number = excluded.phone_number,
    phone_number_display = excluded.phone_number_display,
    display_name = excluded.display_name,
    public_key = excluded.public_key,
    encryption_public_key = excluded.encryption_public_key,
    updated_at = excluded.updated_at
`);

const lookupUserByPhoneStatement = db.query(`
  SELECT
    user_id AS userId,
    phone_number AS phoneNumber,
    phone_number_display AS phoneNumberDisplay,
    display_name AS displayName,
    public_key AS publicKey,
    encryption_public_key AS encryptionPublicKey
  FROM users
  WHERE phone_number = ?
`);

const insertEnvelopeStatement = db.query(`
  INSERT OR IGNORE INTO envelopes (
    envelope_id,
    event_id,
    sender_id,
    recipient_id,
    envelope_json,
    created_at
  ) VALUES (?, ?, ?, ?, ?, ?)
`);

const pendingEnvelopeStatement = db.query(`
  SELECT row_id AS rowId, envelope_json AS envelopeJson
  FROM envelopes
  WHERE recipient_id = ? AND delivered_at IS NULL
  ORDER BY created_at ASC, row_id ASC
`);

const markEnvelopeDeliveredStatement = db.query(`
  UPDATE envelopes
  SET delivered_at = ?
  WHERE row_id = ?
`);

const socketsByEvent = new Map<string, Set<ServerWebSocket<SocketData>>>();
const socketsByUser = new Map<string, Set<ServerWebSocket<SocketData>>>();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

async function readJson(req: Request) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

function addSocketToIndexes(socket: ServerWebSocket<SocketData>) {
  if (!socket.data.userId || !socket.data.eventId) {
    return;
  }

  const userSockets = socketsByUser.get(socket.data.userId) ?? new Set<ServerWebSocket<SocketData>>();
  userSockets.add(socket);
  socketsByUser.set(socket.data.userId, userSockets);

  const eventSockets = socketsByEvent.get(socket.data.eventId) ?? new Set<ServerWebSocket<SocketData>>();
  eventSockets.add(socket);
  socketsByEvent.set(socket.data.eventId, eventSockets);
}

function removeSocket(socket: ServerWebSocket<SocketData>) {
  const { eventId, userId } = socket.data;

  if (userId) {
    const userSockets = socketsByUser.get(userId);
    if (userSockets) {
      userSockets.delete(socket);
      if (userSockets.size === 0) {
        socketsByUser.delete(userId);
      }
    }
  }

  if (eventId) {
    const eventSockets = socketsByEvent.get(eventId);
    if (eventSockets) {
      eventSockets.delete(socket);
      if (eventSockets.size === 0) {
        socketsByEvent.delete(eventId);
      } else {
        broadcastPresence(eventId);
      }
    }
  }
}

function getPeers(eventId: string) {
  const sockets = socketsByEvent.get(eventId) ?? new Set<ServerWebSocket<SocketData>>();

  return [...sockets]
    .filter((socket) => socket.data.userId && socket.data.alias)
    .map((socket) => ({
      id: socket.data.userId,
      alias: socket.data.alias,
      phoneNumber: socket.data.userId,
      phoneNumberDisplay: socket.data.alias,
      lastSeenAt: new Date().toISOString(),
      via: "internet-fallback",
    }))
    .filter((peer, index, peers) => peers.findIndex((item) => item.id === peer.id) === index);
}

function broadcastPresence(eventId: string) {
  const sockets = socketsByEvent.get(eventId);
  if (!sockets) {
    return;
  }

  const payload = JSON.stringify({
    type: "presence",
    peers: getPeers(eventId),
  });

  for (const socket of sockets) {
    socket.send(payload);
  }
}

function deliverPendingEnvelopes(socket: ServerWebSocket<SocketData>) {
  if (!socket.data.userId) {
    return;
  }

  const pending = pendingEnvelopeStatement.all(socket.data.userId) as Array<{
    rowId: number;
    envelopeJson: string;
  }>;

  for (const item of pending) {
    socket.send(
      JSON.stringify({
        type: "envelope",
        envelope: JSON.parse(item.envelopeJson),
      }),
    );
    markEnvelopeDeliveredStatement.run(new Date().toISOString(), item.rowId);
  }
}

function persistEnvelopeForRecipients(envelope: EnvelopeMessage["envelope"]) {
  for (const recipientId of envelope.recipientIds) {
    if (!recipientId || recipientId === envelope.senderId) {
      continue;
    }

    insertEnvelopeStatement.run(
      envelope.id,
      envelope.eventId,
      envelope.senderId,
      recipientId,
      JSON.stringify(envelope),
      new Date().toISOString(),
    );
  }
}

function deliverEnvelopeToOnlineRecipients(envelope: EnvelopeMessage["envelope"]) {
  for (const recipientId of envelope.recipientIds) {
    const sockets = socketsByUser.get(recipientId);
    if (!sockets) {
      continue;
    }

    for (const socket of sockets) {
      socket.send(
        JSON.stringify({
          type: "envelope",
          envelope,
        }),
      );
    }
  }
}

Bun.serve<SocketData>({
  hostname: "0.0.0.0",
  port,
  async fetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === "/ws") {
      if (server.upgrade(req, { data: {} })) {
        return undefined;
      }

      return new Response("Unable to upgrade websocket", { status: 400 });
    }

    if (req.method === "GET" && url.pathname === "/health") {
      return jsonResponse({ ok: true });
    }

    if (req.method === "POST" && url.pathname === "/users/register") {
      const body = await readJson(req);
      if (
        !body?.userId ||
        !body?.phoneNumber ||
        !body?.phoneNumberDisplay ||
        !body?.displayName ||
        !body?.publicKey ||
        !body?.encryptionPublicKey
      ) {
        return new Response("Missing required user fields", { status: 400 });
      }

      const now = new Date().toISOString();
      upsertUserStatement.run(
        body.userId,
        body.phoneNumber,
        body.phoneNumberDisplay,
        body.displayName,
        body.publicKey,
        body.encryptionPublicKey,
        now,
        now,
      );

      const registeredUser = lookupUserByPhoneStatement.get(body.phoneNumber);
      return jsonResponse(registeredUser);
    }

    if (req.method === "POST" && url.pathname === "/users/lookup-by-phone") {
      const body = await readJson(req);
      if (!body?.phoneNumber) {
        return new Response("Missing phone number", { status: 400 });
      }

      const user = lookupUserByPhoneStatement.get(body.phoneNumber);
      if (!user) {
        return new Response("User not found", { status: 404 });
      }

      return jsonResponse(user);
    }

    return jsonResponse({ ok: false, message: "Concert Mesh backend" }, 404);
  },
  websocket: {
    open() {},
    message(socket, rawMessage) {
      try {
        const message = JSON.parse(String(rawMessage)) as JoinMessage | EnvelopeMessage;

        if (message.type === "join") {
          removeSocket(socket);
          socket.data.eventId = message.eventId;
          socket.data.userId = message.userId;
          socket.data.alias = message.alias;

          addSocketToIndexes(socket);
          deliverPendingEnvelopes(socket);
          broadcastPresence(message.eventId);
          return;
        }

        if (message.type === "envelope") {
          persistEnvelopeForRecipients(message.envelope);
          deliverEnvelopeToOnlineRecipients(message.envelope);
        }
      } catch {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "Invalid payload",
          }),
        );
      }
    },
    close(socket) {
      removeSocket(socket);
    },
  },
});

console.log(`Concert Mesh backend listening on http://0.0.0.0:${port} and ws://0.0.0.0:${port}/ws`);
