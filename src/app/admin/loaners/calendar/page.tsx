import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminAuthFromCookies } from "@/lib/auth/admin-session";
import { LoanerCalendarDashboard } from "./loaner-calendar-dashboard";

export const metadata: Metadata = {
  title: "代車カレンダー | Kawashima Motors Shaken",
};

export default async function AdminLoanerCalendarPage() {
  const cookieStore = await cookies();
  const auth = await getAdminAuthFromCookies(cookieStore);

  if (!auth.authenticated) redirect("/admin/login");

  return <LoanerCalendarDashboard />;
}
