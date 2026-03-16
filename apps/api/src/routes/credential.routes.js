import express from "express";
import { Credential } from "../models/credential.model.js";
import { encrypt } from "../utils/credentialCrypto.js";

const router = express.Router();

router.post("/", async (req, res) => {
  try {
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
    const doc = await Credential.create({ name, type, data: encryptedData });
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
    const list = await Credential.find().select("name type createdAt").lean();
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
    const doc = await Credential.findById(req.params.id).select("name type createdAt").lean();
    if (!doc) return res.status(404).json({ error: "Credential not found" });
    return res.json({
      id: doc._id.toString(),
      name: doc.name,
      type: doc.type,
      createdAt: doc.createdAt
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to get credential" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const result = await Credential.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: "Credential not found" });
    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to delete credential" });
  }
});

export default router;
