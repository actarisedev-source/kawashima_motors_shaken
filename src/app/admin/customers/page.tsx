import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  adminSessionCookieName,
  verifyAdminSessionValue,
} from "@/lib/auth/admin-session";
import { CustomersDashboard } from "./customers-dashboard";

export const metadata: Metadata = {
  title: "顧客管理 | Kawashima Motors Shaken",
};

export default async function AdminCustomersPage() {
  const cookieStore = await cookies();
  const session = cookieStore.get(adminSessionCookieName)?.value;

  if (!verifyAdminSessionValue(session)) {
    redirect("/admin/login");
  }

  return <CustomersDashboard />;
}
