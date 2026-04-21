import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, index: true },
  passwordHash: { type: String, required: true },
  name: { type: String, default: "" },
  role: { type: String, enum: ["user", "admin"], default: "user" },
  refreshTokenHash: { type: String },
  createdAt: { type: Date, default: Date.now }
});

export const User = mongoose.model("User", userSchema);
