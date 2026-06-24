import Image from "next/image";
import { ReservationForm } from "./reservation-form";

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
            width={626}
            height={166}
            priority
            className="h-auto w-52 sm:w-72"
          />
          <div className="mt-8 max-w-[18rem] sm:mt-12 sm:max-w-xl">
            <h1 className="text-3xl font-black leading-tight text-sky-950 drop-shadow-sm sm:text-5xl">
              川島モータース車検予約
            </h1>
            <p className="mt-4 max-w-md text-sm font-semibold leading-7 text-slate-700 sm:text-base sm:leading-8">
              お車の情報とご希望日時を入力してください。内容を確認後、担当者よりご連絡します。
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-5xl gap-8 px-6 py-8 sm:py-10">
        <ReservationForm reservationLiffId={reservationLiffId} />
      </section>
    </main>
  );
}
