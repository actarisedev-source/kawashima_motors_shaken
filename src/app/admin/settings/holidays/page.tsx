import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminAuthFromCookies } from "@/lib/auth/admin-session";
import { HolidaysSettings } from "./holidays-settings";

export const metadata: Metadata = {
  title: "定休日管理 | Kawashima Motors Shaken",
};

export default async function HolidaysSettingsPage() {
  const cookieStore = await cookies();
  const auth = await getAdminAuthFromCookies(cookieStore);

  if (!auth.authenticated) {
    redirect("/admin/login");
  }

  return <HolidaysSettings />;
}
