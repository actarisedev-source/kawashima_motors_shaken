import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  adminSessionCookieName,
  verifyAdminSessionValue,
} from "@/lib/auth/admin-session";
import { SlotSettings } from "./slot-settings";

export const metadata: Metadata = {
  title: "予約枠管理 | Kawashima Motors Shaken",
};

export default async function AdminSlotSettingsPage() {
  const cookieStore = await cookies();
  const session = cookieStore.get(adminSessionCookieName)?.value;

  if (!verifyAdminSessionValue(session)) {
    redirect("/admin/login");
  }

  return <SlotSettings />;
}
