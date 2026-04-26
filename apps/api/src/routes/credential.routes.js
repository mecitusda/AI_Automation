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
