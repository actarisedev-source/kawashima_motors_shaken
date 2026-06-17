import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  adminSessionCookieName,
  verifyAdminSessionValue,
} from "@/lib/auth/admin-session";
import { CustomersDashboard } from "../customers-dashboard";

export const metadata: Metadata = {
  title: "顧客詳細 | Kawashima Motors Shaken",
};

export default async function AdminCustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const cookieStore = await cookies();
  const session = cookieStore.get(adminSessionCookieName)?.value;

  if (!verifyAdminSessionValue(session)) {
    redirect("/admin/login");
  }

  const { id } = await params;

  return <CustomersDashboard initialCustomerId={id} />;
}
