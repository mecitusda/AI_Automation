import mongoose from "mongoose";

const templateSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: "" },
  category: { type: String, default: "General" },
  workflow: { type: mongoose.Schema.Types.Mixed, required: true },
  createdAt: { type: Date, default: Date.now }
});

export const Template = mongoose.model("Template", templateSchema);
