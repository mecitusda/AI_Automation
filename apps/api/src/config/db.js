import mongoose from "mongoose";
import dns from "dns";

export async function connectDB() {
  try {
    try {
      dns.setServers(["8.8.8.8", "1.1.1.1"]);
      console.log("DNS servers set to:", dns.getServers());
    } catch (dnsErr) {
      console.warn("Failed to set DNS servers:", dnsErr);
    }

    await mongoose.connect(process.env.MONGO_URL);
    console.log("Mongo connected");
  } catch (err) {
    console.error("Mongo error", err);
    process.exit(1);
  }
}

export function getPlatformConnection() {
  return mongoose.connection;
}

export function getTenantConnection(tenantId) {
  void tenantId;
  return mongoose.connection;
}