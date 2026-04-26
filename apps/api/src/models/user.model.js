import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, index: true },
  passwordHash: { type: String, required: true },
  name: { type: String, default: "" },
  role: { type: String, enum: ["user", "admin"], default: "user" },
  refreshTokenHash: { type: String },
  createdAt: { type: Date, default: Date.now }
});

export function getUserModel(conn = mongoose.connection) {
  return conn.models.User || conn.model("User", userSchema);
}

export const User = getUserModel();
