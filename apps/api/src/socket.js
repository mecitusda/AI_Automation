import { Server } from "socket.io";

export function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  io.on("connection", (socket) => {
    // run detay sayfası bu odaya join olacak
    socket.on("run:join", ({ runId }) => {
      if (!runId) return;
      socket.join(`run:${runId}`);
    });

    socket.on("run:leave", ({ runId }) => {
      if (!runId) return;
      socket.leave(`run:${runId}`);
    });
  });

  return io;
}