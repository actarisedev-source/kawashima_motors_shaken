import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminAuthFromCookies } from "@/lib/auth/admin-session";
import { AccountSettings } from "./account-settings";

export const metadata: Metadata = {
  title: "アカウント設定 | Kawashima Motors Shaken",
};

export default async function AdminAccountSettingsPage() {
  const cookieStore = await cookies();
  const auth = await getAdminAuthFromCookies(cookieStore);

  if (!auth.authenticated) {
    redirect("/admin/login");
  }

  return <AccountSettings initialEmail={auth.user.email ?? ""} />;
}
