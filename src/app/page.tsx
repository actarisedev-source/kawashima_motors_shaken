import Image from "next/image";
import { Fragment } from "react";
import { ReservationForm } from "./reservation-form";

const flowSteps = [
  {
    label: "日時を選ぶ",
    icon: (
      <svg viewBox="0 0 48 48" aria-hidden="true" className="h-10 w-10 sm:h-12 sm:w-12">
        <rect x="8" y="10" width="32" height="30" rx="3" fill="none" stroke="currentColor" strokeWidth="3" />
        <path d="M8 18h32M17 7v7M31 7v7" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="3" />
        <path d="M17 27h4M27 27h4M17 34h4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="3" />
      </svg>
    ),
  },
  {
    label: "お客様情報入力",
    icon: (
      <svg viewBox="0 0 48 48" aria-hidden="true" className="h-10 w-10 sm:h-12 sm:w-12">
        <path d="M13 35l3-10L34 7l7 7-18 18-10 3Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="3" />
        <path d="M29 12l7 7M16 25l7 7" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="3" />
      </svg>
    ),
  },
  {
    label: "予約完了",
    icon: (
      <svg viewBox="0 0 48 48" aria-hidden="true" className="h-10 w-10 sm:h-12 sm:w-12">
        <rect x="10" y="8" width="28" height="32" rx="3" fill="none" stroke="currentColor" strokeWidth="3" />
        <path d="M17 24l6 6 10-13" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" />
      </svg>
    ),
  },
];

function ReservationFlow() {
  return (
    <section className="rounded-md border border-blue-100 bg-white px-4 py-4 text-center shadow-sm sm:px-8 sm:py-6">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <span className="h-px bg-blue-100" />
        <h2 className="text-sm font-black text-slate-950 sm:text-lg">ご予約の流れ</h2>
        <span className="h-px bg-blue-100" />
      </div>
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-1.5 sm:mt-5 sm:gap-4">
        {flowSteps.map((step, index) => (
          <Fragment key={step.label}>
            <div className="relative grid justify-items-center gap-2 text-[#0070A8] sm:gap-3">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-blue-600 text-[11px] font-black text-white sm:h-6 sm:w-6 sm:text-xs">
                {index + 1}
              </span>
              <div className="grid h-12 w-12 place-items-center rounded-full bg-blue-50 sm:h-16 sm:w-16">
                {step.icon}
              </div>
              <p className="whitespace-nowrap text-[11px] font-black leading-none text-slate-950 sm:text-base sm:leading-snug">
                {step.label}
              </p>
            </div>
            {index < flowSteps.length - 1 ? (
              <div className="pt-4 text-2xl font-bold text-slate-300 sm:pt-5 sm:text-3xl">
                &gt;
              </div>
            ) : null}
          </Fragment>
        ))}
      </div>
    </section>
  );
}

function ReservationIntro() {
  return (
    <section className="rounded-md border border-blue-100 bg-white px-4 py-4 shadow-sm sm:px-6 sm:py-5">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(120px,36vw)] items-start gap-3 md:grid-cols-[minmax(0,1fr)_280px] md:items-center md:gap-5">
        <div className="min-w-0">
          <Image
            src="/images/kawashima-logo.png"
            alt="有限会社 川島モータース"
            width={951}
            height={241}
            priority
            className="h-auto w-36 sm:w-60"
          />
          <h1 className="mt-5 font-black leading-tight text-[#005CA8] sm:mt-7">
            <span className="block text-xl sm:text-[33px]">川島モータース</span>
            <span className="block text-3xl sm:text-5xl">車検予約</span>
          </h1>
        </div>
        <div className="relative min-h-36 overflow-hidden rounded-md bg-gradient-to-br from-blue-50 via-white to-sky-100 md:min-h-44">
          <div className="absolute -right-10 -top-12 h-40 w-40 rounded-full bg-blue-100/70 md:-right-8 md:-top-10 md:h-44 md:w-44" />
          <div className="absolute right-6 top-9 h-20 w-28 rounded-md bg-white shadow-[0_14px_35px_rgba(37,99,235,0.18)] md:right-10 md:top-8 md:h-28 md:w-36">
            <div className="h-6 rounded-t-md bg-gradient-to-r from-blue-500 to-sky-400 md:h-8" />
            <div className="absolute left-5 top-0 h-7 w-2.5 -translate-y-3 rounded-full bg-blue-200 md:left-7 md:h-8 md:w-3" />
            <div className="absolute right-5 top-0 h-7 w-2.5 -translate-y-3 rounded-full bg-blue-200 md:right-7 md:h-8 md:w-3" />
            <div className="grid grid-cols-4 gap-1.5 px-4 py-3 md:gap-2 md:px-5 md:py-4">
              {Array.from({ length: 12 }, (_, index) => (
                <span key={index} className="h-2.5 rounded-sm bg-blue-100 md:h-3" />
              ))}
            </div>
          </div>
          <div className="absolute bottom-6 right-3 grid h-16 w-16 place-items-center rounded-full border-4 border-blue-500 bg-white text-blue-600 shadow-lg md:bottom-7 md:right-5 md:h-20 md:w-20 md:border-[6px]">
            <svg viewBox="0 0 48 48" aria-hidden="true" className="h-8 w-8 md:h-10 md:w-10">
              <path d="M24 11v15l10 6" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="4" />
            </svg>
          </div>
          <span className="absolute left-5 top-8 h-3.5 w-3.5 rounded-full bg-blue-200 md:left-10 md:h-4 md:w-4" />
          <span className="absolute bottom-7 left-16 h-2.5 w-2.5 rounded-full border-2 border-blue-200 md:left-28 md:bottom-9" />
        </div>
      </div>

      <div className="mt-6 flex items-center gap-3 rounded-md border border-blue-100 bg-blue-50/60 px-3 py-3 shadow-sm sm:gap-4 sm:px-5">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white text-blue-600 ring-1 ring-blue-100 sm:h-14 sm:w-14">
          <svg viewBox="0 0 48 48" aria-hidden="true" className="h-8 w-8 sm:h-9 sm:w-9">
            <path
              d="M24 7a17 17 0 1 0 0 34 17 17 0 0 0 0-34Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
            />
            <path
              d="M24 13v12l8 5M11 24h5M32 24h5M24 11v5M24 32v5"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="3"
            />
          </svg>
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-black leading-tight text-blue-600 sm:text-xl">
            24時間いつでも予約可能
          </h2>
          <p className="mt-1 text-xs font-semibold leading-relaxed text-zinc-600 sm:text-sm">
            24時間365日、お好きな時間にご予約いただけます。
          </p>
        </div>
      </div>

      <div className="mt-5">
        <ReservationFlow />
      </div>
    </section>
  );
}

export default function Home() {
  const reservationLiffId =
    process.env.NEXT_PUBLIC_RESERVATION_LIFF_ID?.trim() ||
    process.env.NEXT_PUBLIC_LIFF_ID?.trim() ||
    "";

  return (
    <main className="min-h-screen bg-sky-50">
      <section className="mx-auto grid w-full max-w-5xl gap-4 px-2 py-3 sm:gap-5 sm:px-6 sm:py-8">
        <ReservationIntro />
        <ReservationForm reservationLiffId={reservationLiffId} />
      </section>
    </main>
  );
}
