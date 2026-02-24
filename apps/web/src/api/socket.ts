import { io, Socket } from "socket.io-client";

const API_URL =
  import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export const socket: Socket = io(API_URL, {
  transports: ["websocket"],
  autoConnect: true,
});

socket.on("connect", () => {
  console.log("WS connected:", socket.id);
});

socket.on("disconnect", (reason) => {
  console.log("WS disconnected:", reason);
});

socket.on("connect_error", (err) => {
  console.error("WS error:", err.message);
});