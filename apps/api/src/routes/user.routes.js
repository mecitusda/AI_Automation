import express from "express";
import { User } from "../models/user.model.js";

const router = express.Router();

router.get("/me", async (req, res) => {
  const user = await User.findById(req.user.id).lean();
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json({
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt
  });
});

router.put("/me", async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const updated = await User.findByIdAndUpdate(
    req.user.id,
    { $set: { name } },
    { new: true }
  ).lean();
  if (!updated) return res.status(404).json({ error: "User not found" });
  return res.json({
    id: updated._id.toString(),
    email: updated.email,
    name: updated.name,
    role: updated.role
  });
});
export default router;
