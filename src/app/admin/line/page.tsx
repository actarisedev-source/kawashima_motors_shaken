import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  adminSessionCookieName,
  verifyAdminSessionValue,
} from "@/lib/auth/admin-session";
import { LineDistribution } from "./line-distribution";

export const metadata: Metadata = {
  title: "LINE配信 | Kawashima Motors Shaken",
};

export default async function AdminLinePage() {
  const cookieStore = await cookies();
  if (
    !verifyAdminSessionValue(
      cookieStore.get(adminSessionCookieName)?.value,
    )
  ) {
    redirect("/admin/login");
  }
  return <LineDistribution />;
}
