import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  adminSessionCookieName,
  verifyAdminSessionValue,
} from "@/lib/auth/admin-session";
import { NewCustomerForm } from "./new-customer-form";

export const metadata: Metadata = {
  title: "新規顧客登録 | Kawashima Motors Shaken",
};

export default async function NewCustomerPage() {
  const cookieStore = await cookies();
  const session = cookieStore.get(adminSessionCookieName)?.value;

  if (!verifyAdminSessionValue(session)) {
    redirect("/admin/login");
  }

  return <NewCustomerForm />;
}
