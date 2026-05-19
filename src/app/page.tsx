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
        <div className="grid gap-3 text-sm text-zinc-700 sm:grid-cols-3">
          <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="font-semibold text-zinc-950">予約登録</p>
            <p className="mt-2">入力内容を Supabase に保存します。</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="font-semibold text-zinc-950">接続確認</p>
            <p className="mt-2">API から主要テーブルの状態を確認できます。</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="font-semibold text-zinc-950">LINE連携</p>
            <p className="mt-2">Webhook 受信口と環境変数を準備済みです。</p>
          </div>
        </div>
      </section>
    </main>
  );
}
