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
    <section className="rounded-md border border-sky-100 bg-white/95 px-4 py-5 text-center shadow-sm sm:px-8 sm:py-7">
      <h2 className="text-base font-black text-slate-950 sm:text-xl">ご予約の流れ</h2>
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-1.5 sm:mt-6 sm:gap-4">
        {flowSteps.map((step, index) => (
          <Fragment key={step.label}>
            <div className="grid justify-items-center gap-2 text-[#0070A8] sm:gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-md bg-sky-50 sm:h-16 sm:w-16">
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

export default function Home() {
  const reservationLiffId =
    process.env.NEXT_PUBLIC_RESERVATION_LIFF_ID?.trim() ||
    process.env.NEXT_PUBLIC_LIFF_ID?.trim() ||
    "";

  return (
    <main className="min-h-screen bg-sky-50">
      <section className="relative min-h-[360px] overflow-hidden bg-[url('/images/reservation-hero.png')] bg-cover bg-[position:38%_center] sm:min-h-[460px] sm:bg-center">
        <div className="absolute inset-0 bg-gradient-to-r from-white/95 via-white/70 to-sky-100/5" />
        <div className="relative mx-auto flex min-h-[360px] w-full max-w-6xl flex-col px-5 py-5 sm:min-h-[460px] sm:px-8 sm:py-8">
          <Image
            src="/images/kawashima-logo.png"
            alt="有限会社 川島モータース"
            width={951}
            height={241}
            priority
            className="h-auto w-52 sm:w-72"
          />
          <div className="mt-8 max-w-[18rem] sm:mt-12 sm:max-w-xl">
            <h1 className="text-2xl font-black leading-tight text-[#0070A8] drop-shadow-sm sm:text-4xl">
              川島モータース
              <br />
              車検予約
            </h1>
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-5xl gap-8 px-6 py-8 sm:py-10">
        <ReservationFlow />
        <ReservationForm reservationLiffId={reservationLiffId} />
      </section>
    </main>
  );
}
