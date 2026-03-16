import mongoose from "mongoose";

const credentialSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, required: true },
  data: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

credentialSchema.set("toJSON", {
  transform(_doc, ret) {
    delete ret.data;
    return ret;
  }
});

export const Credential = mongoose.model("Credential", credentialSchema);
