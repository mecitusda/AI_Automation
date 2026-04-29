import express from "express";
import { decrypt, encrypt } from "../utils/credentialCrypto.js";
import { getPlatformModels } from "../utils/tenantModels.js";

const router = express.Router();
const modelsOf = () => getPlatformModels();

router.post("/", async (req, res) => {
  try {
    const { Credential } = modelsOf(req);
    const { name, type, data } = req.body || {};
    if (!name || !type) {
      return res.status(400).json({ error: "name and type are required" });
    }
    if (data === undefined || typeof data !== "object") {
      return res.status(400).json({ error: "data must be a plain object" });
    }
    let encryptedData;
    try {
      encryptedData = encrypt(data);
    } catch (err) {
      return res.status(500).json({ error: err.message || "Encryption failed" });
    }
    const doc = await Credential.create({ name, type, data: encryptedData, userId: req.user.id });
    return res.status(201).json({
      id: doc._id.toString(),
      name: doc.name,
      type: doc.type,
      createdAt: doc.createdAt
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to create credential" });
  }
});

router.get("/", async (_req, res) => {
  try {
    const { Credential } = modelsOf(_req);
    const typeFilter = typeof _req.query?.type === "string" ? _req.query.type.trim() : "";
    const query = { userId: _req.user.id };
    if (typeFilter) query.type = typeFilter;
    const list = await Credential.find(query).select("name type createdAt").lean();
    return res.json(
      list.map((d) => ({
        id: d._id.toString(),
        name: d.name,
        type: d.type,
        createdAt: d.createdAt
      }))
    );
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to list credentials" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const { Credential } = modelsOf(req);
    const doc = await Credential.findOne({ _id: req.params.id, userId: req.user.id }).select("name type createdAt data").lean();
    if (!doc) return res.status(404).json({ error: "Credential not found" });
    let data = {};
    try {
      data = decrypt(doc.data);
    } catch (err) {
      return res.status(500).json({ error: err.message || "Failed to decrypt credential data" });
    }
    return res.json({
      id: doc._id.toString(),
      name: doc.name,
      type: doc.type,
      data,
      createdAt: doc.createdAt
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to get credential" });
  }
});

router.post("/:id/test", async (req, res) => {
  try {
    const { Credential } = modelsOf(req);
    const doc = await Credential.findOne({ _id: req.params.id, userId: req.user.id }).select("name type data").lean();
    if (!doc) return res.status(404).json({ error: "Credential not found" });
    const data = decrypt(doc.data);
    const type = doc.type;

    if (type === "telegram.bot") {
      const botToken = data?.botToken || data?.token;
      if (!botToken) return res.status(400).json({ error: "botToken is required" });
      const tg = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
      const json = await tg.json().catch(() => ({}));
      if (!tg.ok || json?.ok === false) {
        return res.status(400).json({ error: json?.description || "Telegram credential test failed" });
      }
      return res.json({ ok: true, message: `Telegram bot connected: @${json?.result?.username || "unknown"}` });
    }

    if (type === "openai") {
      const apiKey = data?.apiKey;
      if (!apiKey) return res.status(400).json({ error: "apiKey is required" });
      const baseUrl = data?.baseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
      const ai = await fetch(`${String(baseUrl).replace(/\/$/, "")}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` }
      });
      if (!ai.ok) return res.status(400).json({ error: `OpenAI credential test failed (${ai.status})` });
      return res.json({ ok: true, message: "OpenAI credential connected" });
    }

    if (type === "slack") {
      const token = data?.token || data?.botToken;
      if (!token) return res.status(400).json({ error: "token is required" });
      const slack = await fetch("https://slack.com/api/auth.test", {
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await slack.json().catch(() => ({}));
      if (!slack.ok || json?.ok === false) {
        return res.status(400).json({ error: json?.error || "Slack credential test failed" });
      }
      return res.json({ ok: true, message: `Slack workspace connected: ${json?.team || "unknown"}` });
    }

    return res.json({ ok: true, message: "Credential JSON is decryptable. No remote test is defined for this type." });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Credential test failed" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const { Credential } = modelsOf(req);
    const { name, type, data } = req.body || {};
    if (!name || !type) {
      return res.status(400).json({ error: "name and type are required" });
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return res.status(400).json({ error: "data must be a plain object" });
    }
    let encryptedData;
    try {
      encryptedData = encrypt(data);
    } catch (err) {
      return res.status(500).json({ error: err.message || "Encryption failed" });
    }
    const doc = await Credential.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { $set: { name, type, data: encryptedData } },
      { new: true }
    ).select("name type createdAt");
    if (!doc) return res.status(404).json({ error: "Credential not found" });
    return res.json({
      id: doc._id.toString(),
      name: doc.name,
      type: doc.type,
      createdAt: doc.createdAt
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to update credential" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const { Credential } = modelsOf(req);
    const result = await Credential.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    if (!result) return res.status(404).json({ error: "Credential not found" });
    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to delete credential" });
  }
});

export default router;
