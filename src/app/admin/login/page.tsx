import type { Metadata } from "next";
import { cookies } from "next/headers";
import Image from "next/image";
import { redirect } from "next/navigation";
import { getAdminAuthFromCookies } from "@/lib/auth/admin-session";
import { AdminLoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "管理者ログイン | Kawashima Motors Shaken",
};

export default async function AdminLoginPage() {
  const cookieStore = await cookies();
  const auth = await getAdminAuthFromCookies(cookieStore);

  if (auth.authenticated) {
    redirect("/admin");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-5 py-8 text-slate-950 sm:py-10">
      <div className="grid w-full max-w-md gap-5">
        <div className="text-center">
          <Image
            src="/images/kawashima-logo.png"
            alt="Kawashima Motors"
            width={360}
            height={78}
            priority
            className="mx-auto h-auto w-56 max-w-full sm:w-64"
          />
          <p className="mt-4 text-sm font-semibold text-slate-500 sm:text-base">
            車検予約 管理システム
          </p>
        </div>
        <AdminLoginForm />
      </div>
      <p className="mt-8 text-center text-xs font-medium text-slate-400">
        Powered by ACTARISE
      </p>
    </main>
  );
}
