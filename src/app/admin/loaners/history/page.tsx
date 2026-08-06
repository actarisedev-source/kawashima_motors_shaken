import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminAuthFromCookies } from "@/lib/auth/admin-session";
import { LoanerHistoryDashboard } from "./loaner-history-dashboard";

export const metadata: Metadata = {
  title: "貸出履歴 | Kawashima Motors Shaken",
};

export default async function AdminLoanerHistoryPage() {
  const cookieStore = await cookies();
  const auth = await getAdminAuthFromCookies(cookieStore);

  if (!auth.authenticated) redirect("/admin/login");

  return <LoanerHistoryDashboard />;
}
