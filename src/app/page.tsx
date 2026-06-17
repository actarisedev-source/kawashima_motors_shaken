import { ReservationForm } from "./reservation-form";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-10">
      <section className="grid gap-8 py-8">
        <p className="text-sm font-semibold tracking-wide text-emerald-700">
          Kawashima Motors
        </p>
        <div className="space-y-4">
          <h1 className="text-4xl font-bold text-zinc-950 sm:text-5xl">
            川島モータース車検予約
          </h1>
          <p className="max-w-2xl text-base leading-8 text-zinc-700">
            お車の情報とご希望日時を入力してください。内容を確認後、担当者よりご連絡します。
          </p>
        </div>
        <ReservationForm />
      </section>
    </main>
  );
}
