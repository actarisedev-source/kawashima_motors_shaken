"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type AdminHeaderProps = {
  title: string;
  description?: string;
  onRefresh: () => void | Promise<void>;
  children?: ReactNode;
};

const navItems = [
  { href: "/admin", label: "予約管理", match: (path: string) => path === "/admin" },
  {
    href: "/admin/customers",
    label: "顧客管理",
    match: (path: string) => path.startsWith("/admin/customers"),
  },
  {
    href: "/admin/settings/holidays",
    label: "定休日管理",
    match: (path: string) => path.startsWith("/admin/settings/holidays"),
  },
  {
    href: "/admin/settings/slots",
    label: "予約枠管理",
    match: (path: string) => path.startsWith("/admin/settings/slots"),
  },
];

const navButtonClassName = (active: boolean) =>
  [
    "flex h-10 items-center justify-center rounded-md border px-4 text-sm font-semibold shadow-sm transition",
    active
      ? "border-blue-600 bg-blue-600 text-white hover:bg-blue-700"
      : "border-blue-200 bg-white text-blue-700 hover:bg-blue-50",
  ].join(" ");

export function AdminHeader({
  title,
  description,
  onRefresh,
  children,
}: AdminHeaderProps) {
  const pathname = usePathname();

  async function handleLogout() {
    await fetch("/api/admin/logout", {
      method: "POST",
    });
    window.location.href = "/admin/login";
  }

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-6 sm:px-6 lg:px-8">
        <div className="grid gap-4 lg:grid-cols-[minmax(260px,1fr)_auto] lg:items-start">
          <div>
            <p className="text-sm font-semibold text-blue-700">
              Kawashima Motors
            </p>
            <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
              <h1 className="text-2xl font-bold tracking-normal sm:text-3xl">
                {title}
              </h1>
              <button
                type="button"
                onClick={() => void onRefresh()}
                className="h-10 w-fit rounded-md bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
              >
                最新に更新
              </button>
            </div>
            {description ? (
              <p className="mt-1 text-sm text-slate-500">{description}</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row lg:justify-end">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={navButtonClassName(item.match(pathname))}
              >
                {item.label}
              </Link>
            ))}
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              ログアウト
            </button>
          </div>
        </div>
        {children}
      </div>
    </header>
  );
}
