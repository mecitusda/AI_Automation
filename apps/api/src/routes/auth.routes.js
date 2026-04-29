import express from "express";
import bcrypt from "bcryptjs";
import { requireAuth, signAccessToken, signRefreshToken, verifyRefreshToken } from "../middleware/auth.js";
import { User } from "../models/user.model.js";

const router = express.Router();

async function issueTokenPair(user) {
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
  await User.updateOne({ _id: user._id }, { $set: { refreshTokenHash } });
  return { accessToken, refreshToken };
}

router.post("/register", async (req, res) => {
  try {
    const { email, password, name } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "email and password are required" });
    const exists = await User.findOne({ email: String(email).toLowerCase().trim() }).lean();
    if (exists) return res.status(409).json({ error: "Email already exists" });
    const passwordHash = await bcrypt.hash(String(password), 10);
    const user = await User.create({
      email: String(email).toLowerCase().trim(),
      passwordHash,
      name: String(name || "")
    });
    const { accessToken, refreshToken } = await issueTokenPair(user);
    return res.status(201).json({
      user: { id: user._id.toString(), email: user.email, name: user.name, role: user.role },
      accessToken,
      refreshToken
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "email and password are required" });
    const user = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });
    const ok = await bcrypt.compare(String(password), user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });
    const { accessToken, refreshToken } = await issueTokenPair(user);
    return res.json({
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role
      },
      accessToken,
      refreshToken
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

router.post("/refresh", async (req, res) => {
  try {
    const { refreshToken } = req.body || {};
    if (!refreshToken) return res.status(400).json({ error: "refreshToken is required" });
    const payload = verifyRefreshToken(String(refreshToken));
    const user = await User.findById(payload.sub);
    if (!user?.refreshTokenHash) return res.status(401).json({ error: "Invalid refresh token" });
    const ok = await bcrypt.compare(String(refreshToken), user.refreshTokenHash);
    if (!ok) {
      await User.updateOne({ _id: user._id }, { $unset: { refreshTokenHash: "" } });
      return res.status(401).json({ error: "Invalid refresh token" });
    }
    const pair = await issueTokenPair(user);
    return res.json({
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role
      },
      ...pair
    });
  } catch {
    return res.status(401).json({ error: "Invalid refresh token" });
  }
});

router.post("/logout", async (req, res) => {
  try {
    const { refreshToken } = req.body || {};
    if (refreshToken) {
      try {
        const payload = verifyRefreshToken(String(refreshToken));
        await User.updateOne({ _id: payload.sub }, { $unset: { refreshTokenHash: "" } });
      } catch {
        // Logout should be idempotent even when the token is already invalid.
      }
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

router.get("/me", requireAuth, async (req, res) => {
  const user = await User.findById(req.user.id).lean();
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json({
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    role: user.role
  });
});

export default router;
