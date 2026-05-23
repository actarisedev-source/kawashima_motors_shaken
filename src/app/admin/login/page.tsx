import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  adminSessionCookieName,
  verifyAdminSessionValue,
} from "@/lib/auth/admin-session";
import { AdminLoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "管理者ログイン | Kawashima Motors Shaken",
};

export default async function AdminLoginPage() {
  const cookieStore = await cookies();
  const session = cookieStore.get(adminSessionCookieName)?.value;

  if (verifyAdminSessionValue(session)) {
    redirect("/admin");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-10">
      <AdminLoginForm />
    </main>
  );
}
