import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminAuthFromCookies } from "@/lib/auth/admin-session";
import { NewCustomerForm } from "./new-customer-form";

export const metadata: Metadata = {
  title: "新規顧客登録 | Kawashima Motors Shaken",
};

export default async function NewCustomerPage() {
  const cookieStore = await cookies();
  const auth = await getAdminAuthFromCookies(cookieStore);

  if (!auth.authenticated) {
    redirect("/admin/login");
  }

  return <NewCustomerForm />;
}
