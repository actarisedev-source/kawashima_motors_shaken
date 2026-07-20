"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SVGProps,
} from "react";

type AdminHeaderProps = {
  title: string;
  description?: string;
  onRefresh: () => void | Promise<void>;
  children?: ReactNode;
};

type IconProps = SVGProps<SVGSVGElement>;

function CalendarIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 14h.01" />
      <path d="M12 14h.01" />
      <path d="M16 14h.01" />
      <path d="M8 18h.01" />
      <path d="M12 18h.01" />
      <path d="M16 18h.01" />
    </svg>
  );
}

function UsersIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function CalendarOffIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M3 10h18" />
      <path d="m9 15 6 6" />
      <path d="m15 15-6 6" />
    </svg>
  );
}

function CalendarClockIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <path d="M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7" />
      <path d="M3 10h18" />
      <circle cx="18" cy="18" r="4" />
      <path d="M18 16v2l1.5 1" />
    </svg>
  );
}

function MessageIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-6.5A8 8 0 1 1 21 12Z" />
      <path d="M8 12h.01" />
      <path d="M12 12h.01" />
      <path d="M16 12h.01" />
    </svg>
  );
}

function LogoutIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

const navItems = [
  {
    href: "/admin",
    label: "予約管理",
    Icon: CalendarIcon,
    match: (path: string) => path === "/admin",
  },
  {
    href: "/admin/customers",
    label: "顧客管理",
    Icon: UsersIcon,
    match: (path: string) => path.startsWith("/admin/customers"),
  },
  {
    href: "/admin/settings/holidays",
    label: "定休日管理",
    Icon: CalendarOffIcon,
    match: (path: string) => path.startsWith("/admin/settings/holidays"),
  },
  {
    href: "/admin/settings/slots",
    label: "予約枠管理",
    Icon: CalendarClockIcon,
    match: (path: string) => path.startsWith("/admin/settings/slots"),
  },
  {
    href: "/admin/line",
    label: "LINE配信",
    Icon: MessageIcon,
    match: (path: string) => path.startsWith("/admin/line"),
  },
];

const navButtonClassName = (active: boolean) =>
  [
    "flex h-10 items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-semibold shadow-sm transition",
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
  const [isConfirmingLogout, setIsConfirmingLogout] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const confirmLogoutButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isConfirmingLogout) {
      confirmLogoutButtonRef.current?.focus();
    }
  }, [isConfirmingLogout]);

  async function handleLogout() {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    await fetch("/api/admin/logout", {
      method: "POST",
    });
    window.location.href = "/admin/login";
  }

  return (
    <>
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
                  className="h-9 w-fit rounded-md bg-blue-600 px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700"
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
                  <item.Icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </Link>
              ))}
              <button
                type="button"
                onClick={() => setIsConfirmingLogout(true)}
                className="flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-red-600 hover:bg-red-600 hover:text-white"
              >
                <LogoutIcon className="h-4 w-4 shrink-0" />
                ログアウト
              </button>
              <Link
                href="/admin/settings"
                aria-label="設定"
                title="設定"
                className={`grid h-10 w-10 place-items-center rounded-md border text-xl shadow-sm transition ${
                  pathname.startsWith("/admin/settings/password") ||
                  pathname.startsWith("/admin/settings/account") ||
                  pathname === "/admin/settings"
                    ? "border-blue-600 bg-blue-600 text-white hover:bg-blue-700"
                    : "border-blue-200 bg-white text-blue-700 hover:bg-blue-50"
                }`}
              >
                <span aria-hidden="true">⚙</span>
              </Link>
            </div>
          </div>
          {children}
        </div>
      </header>

      {isConfirmingLogout ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="logout-confirm-title"
          aria-describedby="logout-confirm-description"
        >
          <div className="w-full max-w-sm rounded-md border border-slate-200 bg-white p-6 shadow-xl">
            <h2 id="logout-confirm-title" className="text-lg font-bold">
              ログアウト確認
            </h2>
            <p
              id="logout-confirm-description"
              className="mt-3 text-sm text-slate-600"
            >
              ログアウトしますがよろしいですか？
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={isLoggingOut}
                onClick={() => setIsConfirmingLogout(false)}
                className="h-11 cursor-pointer rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                いいえ
              </button>
              <button
                ref={confirmLogoutButtonRef}
                type="button"
                disabled={isLoggingOut}
                onClick={() => void handleLogout()}
                className="h-11 cursor-pointer rounded-md bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-300 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-red-300"
              >
                {isLoggingOut ? "ログアウト中..." : "はい"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
