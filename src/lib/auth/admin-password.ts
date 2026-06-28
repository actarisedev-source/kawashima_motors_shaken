import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { verifyAdminPassword } from "@/lib/auth/admin-session";
import { supabaseServer } from "@/lib/supabase/server";

const primaryCredentialId = "primary";
const hashVersion = "scrypt-v1";
const derivedKeyLength = 64;

const safeEqual = (left: Buffer, right: Buffer) =>
  left.length === right.length && timingSafeEqual(left, right);

export const hashAdminPassword = (password: string) => {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, derivedKeyLength);

  return `${hashVersion}:${salt.toString("hex")}:${hash.toString("hex")}`;
};

const verifyHashedPassword = (password: string, storedHash: string) => {
  const [version, saltHex, hashHex] = storedHash.split(":");

  if (version !== hashVersion || !saltHex || !hashHex) {
    return false;
  }

  try {
    const expectedHash = Buffer.from(hashHex, "hex");
    const actualHash = scryptSync(
      password,
      Buffer.from(saltHex, "hex"),
      expectedHash.length,
    );
    return safeEqual(actualHash, expectedHash);
  } catch {
    return false;
  }
};

const getStoredPasswordHash = async () => {
  const { data, error } = await supabaseServer
    .from("admin_credentials")
    .select("password_hash")
    .eq("id", primaryCredentialId)
    .maybeSingle();

  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") {
      return null;
    }

    throw new Error(`Failed to load admin credentials: ${error.message}`);
  }

  return data?.password_hash ?? null;
};

export const verifyActiveAdminPassword = async (password: string) => {
  const storedHash = await getStoredPasswordHash();

  return storedHash
    ? verifyHashedPassword(password, storedHash)
    : verifyAdminPassword(password);
};

export const saveAdminPassword = async (password: string) => {
  const now = new Date().toISOString();
  const { error } = await supabaseServer.from("admin_credentials").upsert(
    {
      id: primaryCredentialId,
      password_hash: hashAdminPassword(password),
      updated_at: now,
    },
    { onConflict: "id" },
  );

  if (error) {
    throw new Error(error.message);
  }
};
