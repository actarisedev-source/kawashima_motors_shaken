import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminAuthFromCookies } from "@/lib/auth/admin-session";
import { LineDistribution } from "./line-distribution";

export const metadata: Metadata = {
  title: "LINE配信 | Kawashima Motors Shaken",
};

export default async function AdminLinePage() {
  const cookieStore = await cookies();
  const auth = await getAdminAuthFromCookies(cookieStore);
  if (!auth.authenticated) {
    redirect("/admin/login");
  }
  return <LineDistribution />;
}
