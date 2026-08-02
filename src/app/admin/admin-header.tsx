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
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect x="3" y="4.5" width="18" height="16.5" rx="2" />
      <path d="M3 10h18" />
      <rect x="6.8" y="12.8" width="2.4" height="2.1" rx=".35" fill="currentColor" stroke="none" />
      <rect x="10.8" y="12.8" width="2.4" height="2.1" rx=".35" fill="currentColor" stroke="none" />
      <rect x="14.8" y="12.8" width="2.4" height="2.1" rx=".35" fill="currentColor" stroke="none" />
      <rect x="6.8" y="16.6" width="2.4" height="2.1" rx=".35" fill="currentColor" stroke="none" />
      <rect x="10.8" y="16.6" width="2.4" height="2.1" rx=".35" fill="currentColor" stroke="none" />
      <rect x="14.8" y="16.6" width="2.4" height="2.1" rx=".35" fill="currentColor" stroke="none" />
    </svg>
  );
}

function UsersIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <circle cx="8.5" cy="7.5" r="3.6" />
      <path d="M2.5 20.5v-1.4a5.2 5.2 0 0 1 5.2-5.2h1.6a5.2 5.2 0 0 1 5.2 5.2v1.4" />
      <circle cx="16.4" cy="8.4" r="3" />
      <path d="M14.3 14.7a5 5 0 0 1 7.2 4.5v1.3" />
    </svg>
  );
}

function CarIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="m5 11 1.7-4.1A3 3 0 0 1 9.5 5h5a3 3 0 0 1 2.8 1.9L19 11" />
      <path d="M4 11h16a2 2 0 0 1 2 2v4.5a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 17.5V13a2 2 0 0 1 2-2Z" />
      <path d="M5 19v2" />
      <path d="M19 19v2" />
      <circle cx="6.5" cy="15" r="1" fill="currentColor" stroke="none" />
      <circle cx="17.5" cy="15" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CalendarOffIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M7.5 2.2v4" />
      <path d="M16.5 2.2v4" />
      <rect x="2.5" y="4.5" width="19" height="17" rx="2.2" />
      <path d="M2.5 9.8h19" />
      <path d="m9 13.2 6 6" />
      <path d="m15 13.2-6 6" />
    </svg>
  );
}

function CalendarClockIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <path d="M21 13V6.5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2V20a2 2 0 0 0 2 2h7" />
      <path d="M3 10h18" />
      <circle cx="17.8" cy="17.8" r="4.3" />
      <path d="M17.8 15.4v2.4l1.7 1" />
    </svg>
  );
}

function MessageIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 36 30"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M33 13.4c0 5.8-6.7 10.4-15 10.4h-1.5L11.2 27l1.3-4.2C6.9 21.2 3 17.6 3 13.4 3 7.6 9.7 3 18 3s15 4.6 15 10.4Z" />
      <text
        x="18"
        y="15.7"
        textAnchor="middle"
        fontSize="6.4"
        fontWeight="700"
        fill="currentColor"
        stroke="none"
      >
        LINE
      </text>
    </svg>
  );
}

function LogoutIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M10 21H5.5A2.5 2.5 0 0 1 3 18.5v-13A2.5 2.5 0 0 1 5.5 3H10" />
      <path d="M15.5 17.5 21 12l-5.5-5.5" />
      <path d="M21 12H9" />
    </svg>
  );
}

function GearIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M13.7 2.5h-3.4l-.5 2.4a7.3 7.3 0 0 0-1.6.7L6 4.5 3.6 6.9l1.2 2.1a7.4 7.4 0 0 0-.7 1.7l-2.3.5v3.4l2.3.5c.2.6.4 1.1.7 1.6l-1.2 2.1L6 21.2l2.2-1.1c.5.3 1 .5 1.6.7l.5 2.2h3.4l.5-2.2c.6-.2 1.1-.4 1.6-.7l2.2 1.1 2.4-2.4-1.2-2.1c.3-.5.5-1 .7-1.6l2.3-.5v-3.4l-2.3-.5a7.4 7.4 0 0 0-.7-1.7l1.2-2.1L18 4.5l-2.2 1.1a7.3 7.3 0 0 0-1.6-.7l-.5-2.4Z" />
      <circle cx="12" cy="12.2" r="3.2" />
    </svg>
  );
}

function RefreshIcon(props: IconProps) {
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
      <path d="M20 7v5h-5" />
      <path d="M4 17v-5h5" />
      <path d="M6.1 9a7 7 0 0 1 11.5-2.6L20 9" />
      <path d="m4 15 2.4 2.6A7 7 0 0 0 17.9 15" />
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
    href: "/admin/loaners",
    label: "代車管理",
    Icon: CarIcon,
    match: (path: string) => path.startsWith("/admin/loaners"),
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
    iconClassName: "h-7 w-[35px]",
    match: (path: string) => path.startsWith("/admin/line"),
  },
  {
    href: "/admin/settings",
    label: "設定",
    Icon: GearIcon,
    iconClassName: "h-[23px] w-[23px]",
    match: (path: string) =>
      path === "/admin/settings" ||
      path.startsWith("/admin/settings/account") ||
      path.startsWith("/admin/settings/password"),
  },
];

const navButtonClassName = (active: boolean) =>
  [
    "relative flex h-[52px] min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border px-3 text-[15px] font-semibold transition lg:h-12 lg:rounded-b-none lg:rounded-t-lg lg:border-b-0 lg:px-1.5 lg:text-sm xl:px-3 xl:text-[15px]",
    active
      ? "z-10 border-slate-200 bg-white text-blue-700 shadow-[0_-3px_14px_rgba(15,23,42,0.12)] lg:h-14 lg:after:absolute lg:after:inset-x-0 lg:after:-bottom-[3px] lg:after:h-1 lg:after:bg-white lg:after:content-['']"
      : "border-slate-200 bg-slate-100 text-slate-700 shadow-[0_1px_4px_rgba(15,23,42,0.06)] hover:border-slate-300 hover:bg-white hover:text-blue-700",
  ].join(" ");

export function AdminHeader({
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
        <div className="mx-auto max-w-7xl px-5 pt-1 sm:px-6 lg:px-8">
          <div className="flex min-h-8 items-center justify-between gap-4">
            <p className="text-base font-bold text-blue-700">
              Kawashima Motors
            </p>
            <button
              type="button"
              onClick={() => void onRefresh()}
              className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-md px-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
            >
              <RefreshIcon className="h-5 w-5" />
              最新に更新
            </button>
          </div>
          <nav
            aria-label="管理画面メニュー"
            className="grid w-full grid-cols-2 items-end gap-2 pb-2 sm:grid-cols-4 lg:grid-cols-[1fr_1fr_1fr_1.15fr_1.15fr_1.05fr_.75fr_1.05fr] lg:gap-1.5 lg:pb-0"
          >
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={navButtonClassName(item.match(pathname))}
              >
                <item.Icon
                  className={`${item.iconClassName ?? "h-[27px] w-[27px]"} shrink-0`}
                />
                <span>{item.label}</span>
              </Link>
            ))}
            <button
              type="button"
              onClick={() => setIsConfirmingLogout(true)}
              className="relative flex h-[52px] min-w-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 bg-slate-100 px-3 text-[15px] font-semibold text-slate-700 shadow-[0_1px_4px_rgba(15,23,42,0.06)] transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 lg:h-12 lg:rounded-b-none lg:rounded-t-lg lg:border-b-0 lg:px-1.5 lg:text-sm xl:px-3 xl:text-[15px]"
            >
              <LogoutIcon className="h-[27px] w-[27px] shrink-0" />
              ログアウト
            </button>
          </nav>
        </div>
      </header>

      {children ? (
        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-7xl px-5 py-3 sm:px-6 lg:px-8">
            {children}
          </div>
        </section>
      ) : null}

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
