// @ts-nocheck

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
  envelope: unknown;
};

const socketsByEvent = new Map<string, Set<ServerWebSocket<SocketData>>>();

const port = Number(process.env.PORT ?? 8787);

function getPeers(eventId: string) {
  const sockets = socketsByEvent.get(eventId) ?? new Set<ServerWebSocket<SocketData>>();
  return [...sockets]
    .filter((socket) => socket.data.userId && socket.data.alias)
    .map((socket) => ({
      id: socket.data.userId!,
      alias: socket.data.alias!,
      lastSeenAt: new Date().toISOString(),
      via: "internet-fallback" as const,
    }));
}

function broadcastPresence(eventId: string) {
  const sockets = socketsByEvent.get(eventId);
  if (!sockets) {
    return;
  }

  const peers = getPeers(eventId);
  const message = JSON.stringify({
    type: "presence",
    peers,
  });

  for (const socket of sockets) {
    socket.send(message);
  }
}

function removeSocket(socket: ServerWebSocket<SocketData>) {
  const eventId = socket.data.eventId;
  if (!eventId) {
    return;
  }

  const sockets = socketsByEvent.get(eventId);
  if (!sockets) {
    return;
  }

  sockets.delete(socket);
  if (sockets.size === 0) {
    socketsByEvent.delete(eventId);
    return;
  }

  broadcastPresence(eventId);
}

Bun.serve<SocketData>({
  hostname: "0.0.0.0",
  port,
  fetch(req, server) {
    if (server.upgrade(req, { data: {} })) {
      return undefined;
    }

    return new Response("Concert Togather relay server", { status: 200 });
  },
  websocket: {
    open() {},
    message(socket, rawMessage) {
      try {
        const message = JSON.parse(String(rawMessage)) as JoinMessage | EnvelopeMessage;

        if (message.type === "join") {
          socket.data.eventId = message.eventId;
          socket.data.userId = message.userId;
          socket.data.alias = message.alias;

          const sockets = socketsByEvent.get(message.eventId) ?? new Set<ServerWebSocket<SocketData>>();
          sockets.add(socket);
          socketsByEvent.set(message.eventId, sockets);
          broadcastPresence(message.eventId);
          return;
        }

        if (message.type === "envelope" && socket.data.eventId) {
          const sockets = socketsByEvent.get(socket.data.eventId) ?? new Set<ServerWebSocket<SocketData>>();
          const payload = JSON.stringify(message);
          for (const peer of sockets) {
            peer.send(payload);
          }
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

console.log(`Concert Togather relay listening on ws://0.0.0.0:${port}`);
