import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  adminSessionCookieName,
  verifyAdminSessionValue,
} from "@/lib/auth/admin-session";
import { PasswordSettings } from "./password-settings";

export const metadata: Metadata = {
  title: "パスワード変更 | Kawashima Motors Shaken",
};

export default async function AdminPasswordSettingsPage() {
  const cookieStore = await cookies();
  const session = cookieStore.get(adminSessionCookieName)?.value;

  if (!verifyAdminSessionValue(session)) {
    redirect("/admin/login");
  }

  return <PasswordSettings />;
}
