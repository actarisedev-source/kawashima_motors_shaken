import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminAuthFromCookies } from "@/lib/auth/admin-session";
import { AdminDashboard } from "./admin-dashboard";

export const metadata: Metadata = {
  title: "予約管理 | Kawashima Motors Shaken",
};

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ reservation?: string | string[] }>;
}) {
  const cookieStore = await cookies();
  const auth = await getAdminAuthFromCookies(cookieStore);

  if (!auth.authenticated) {
    redirect("/admin/login");
  }

  const params = await searchParams;
  const initialReservationId =
    typeof params.reservation === "string" ? params.reservation : null;

  return <AdminDashboard initialReservationId={initialReservationId} />;
}
