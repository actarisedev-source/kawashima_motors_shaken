"use client";

import Link from "next/link";
import { AdminHeader } from "../admin-header";

export function AdminSettings() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <AdminHeader title="設定" onRefresh={() => window.location.reload()} />
      <div className="mx-auto max-w-7xl px-5 py-6 sm:px-6 lg:px-8">
        <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-lg font-bold">アカウント設定</h2>
          <Link
            href="/admin/settings/password"
            className="mt-4 flex items-center justify-between rounded-md border border-slate-200 px-4 py-4 transition hover:border-blue-300 hover:bg-blue-50"
          >
            <span>
              <span className="block font-semibold text-slate-950">
                パスワード変更
              </span>
              <span className="mt-1 block text-sm text-slate-500">
                管理画面へログインするパスワードを変更します。
              </span>
            </span>
            <span aria-hidden="true" className="text-xl text-blue-600">›</span>
          </Link>
        </section>
      </div>
    </main>
  );
}
