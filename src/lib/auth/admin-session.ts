import { createHmac, timingSafeEqual } from "node:crypto";

export const adminSessionCookieName = "kawashima_admin_session";

const sessionMaxAgeSeconds = 60 * 60 * 24 * 7;

const getAdminPassword = () => process.env.ADMIN_PASSWORD?.trim() ?? "";

const sign = (payload: string, secret: string) =>
  createHmac("sha256", secret).update(payload).digest("hex");

const safeEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
};

export const createAdminSessionValue = () => {
  const password = getAdminPassword();

  if (!password) {
    throw new Error("ADMIN_PASSWORD is not configured.");
  }

  const issuedAt = Date.now().toString();
  return `${issuedAt}.${sign(issuedAt, password)}`;
};

export const verifyAdminPassword = (password: string) => {
  const expectedPassword = getAdminPassword();

  if (!expectedPassword) {
    return false;
  }

  return safeEqual(password, expectedPassword);
};

export const verifyAdminSessionValue = (value: string | undefined) => {
  const password = getAdminPassword();

  if (!password || !value) {
    return false;
  }

  const [issuedAt, signature] = value.split(".");

  if (!issuedAt || !signature) {
    return false;
  }

  const issuedAtMs = Number(issuedAt);

  if (
    Number.isNaN(issuedAtMs) ||
    Date.now() - issuedAtMs > sessionMaxAgeSeconds * 1000
  ) {
    return false;
  }

  return safeEqual(signature, sign(issuedAt, password));
};

export const adminSessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: sessionMaxAgeSeconds,
} as const;
