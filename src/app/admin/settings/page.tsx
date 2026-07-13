import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminAuthFromCookies } from "@/lib/auth/admin-session";
import { AdminSettings } from "./admin-settings";

export const metadata: Metadata = {
  title: "設定 | Kawashima Motors Shaken",
};

export default async function AdminSettingsPage() {
  const cookieStore = await cookies();
  const auth = await getAdminAuthFromCookies(cookieStore);

  if (!auth.authenticated) {
    redirect("/admin/login");
  }

  return <AdminSettings />;
}
