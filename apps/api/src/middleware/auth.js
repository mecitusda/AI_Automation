import jwt from "jsonwebtoken";
import { User } from "../models/user.model.js";

const IS_PROD = process.env.NODE_ENV === "production";
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || (IS_PROD ? "" : "dev-access-secret");
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || (IS_PROD ? "" : "dev-refresh-secret");
const AUTH_REQUIRED = process.env.AUTH_REQUIRED != null
  ? process.env.AUTH_REQUIRED === "true"
  : IS_PROD;

function assertSecretsConfigured() {
  if (!ACCESS_SECRET || !REFRESH_SECRET) {
    throw new Error("JWT secrets are required. Set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET.");
  }
}

export function signAccessToken(user) {
  assertSecretsConfigured();
  return jwt.sign(
    { sub: user._id.toString(), email: user.email, role: user.role || "user" },
    ACCESS_SECRET,
    { expiresIn: "1h" }
  );
}

export function signRefreshToken(user) {
  assertSecretsConfigured();
  return jwt.sign(
    { sub: user._id.toString(), type: "refresh" },
    REFRESH_SECRET,
    { expiresIn: "14d" }
  );
}

export async function authOptional(req, _res, next) {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
      if (AUTH_REQUIRED && IS_PROD) return next();
      let fallback = await User.findOne().sort({ createdAt: 1 }).lean();
      if (!fallback) {
        const created = await User.create({
          email: "dev@local.dev",
          passwordHash: "dev-no-auth",
          name: "Dev User",
          role: "admin"
        });
        fallback = created.toObject();
      }
      req.user = { id: fallback._id.toString(), email: fallback.email, role: fallback.role };
      return next();
    }
    const token = auth.slice("Bearer ".length);
    const payload = jwt.verify(token, ACCESS_SECRET);
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    return next();
  } catch {
    return next();
  }
}

export function requireAuth(req, res, next) {
  if (!req.user?.id) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return next();
}

export function requireAdmin(req, res, next) {
  if (!req.user?.id) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }
  return next();
}
