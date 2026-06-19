import type { ReactNode } from "react";

export type CompletedReservation = {
  reservedDate: string;
  reservedTime: string;
  customerName: string;
  phone: string;
  vehicleModel: string;
  confirmationUrl: string;
};

type ReservationCompleteProps = {
  reservation: CompletedReservation;
  notice?: string;
  additionalContent?: ReactNode;
};

const formatReservedAt = (date: string, time: string) => {
  const [year, month, day] = date.split("-");
  return `${year}年${Number(month)}月${Number(day)}日 ${time}`;
};

export function ReservationComplete({
  reservation,
  notice,
  additionalContent,
}: ReservationCompleteProps) {
  return (
    <main className="grid gap-5 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm sm:p-8">
      <header className="grid justify-items-center gap-4 py-3 text-center">
        <div
          className="grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-4xl font-black text-emerald-700 ring-8 ring-emerald-50"
          aria-hidden="true"
        >
          ✓
        </div>
        <div>
          <h2 className="text-2xl font-black text-zinc-950 sm:text-3xl">
            予約が完了しました
          </h2>
          <p className="mt-3 text-base font-medium leading-7 text-zinc-600">
            ご予約ありがとうございます。
            <br />
            ご予約内容を確認のうえ、ご来店ください。
          </p>
        </div>
      </header>

      <section className="grid gap-4 rounded-[12px] border border-zinc-200 bg-zinc-50 p-5">
        <h3 className="text-lg font-black text-zinc-950">予約内容</h3>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm font-bold text-zinc-500">予約日時</dt>
            <dd className="mt-1 font-bold text-zinc-950">
              {formatReservedAt(
                reservation.reservedDate,
                reservation.reservedTime,
              )}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-bold text-zinc-500">氏名</dt>
            <dd className="mt-1 font-bold text-zinc-950">
              {reservation.customerName}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-bold text-zinc-500">電話番号</dt>
            <dd className="mt-1 font-bold text-zinc-950">{reservation.phone}</dd>
          </div>
          <div>
            <dt className="text-sm font-bold text-zinc-500">車種</dt>
            <dd className="mt-1 font-bold text-zinc-950">
              {reservation.vehicleModel}
            </dd>
          </div>
        </dl>
      </section>

      <section className="grid gap-3 rounded-[12px] border border-zinc-200 p-5">
        <h3 className="text-lg font-black text-zinc-950">
          ご来店時のお持ち物
        </h3>
        <ul className="grid gap-2 text-sm font-medium leading-6 text-zinc-700 sm:text-base">
          <li>・車検証</li>
          <li>・自賠責保険証明書</li>
          <li>・納税証明書（必要な場合）</li>
          <li>・認印（必要な場合）</li>
        </ul>
      </section>

      <p className="rounded-[12px] bg-blue-50 px-4 py-3 text-sm font-medium leading-6 text-blue-900">
        内容確認のため店舗よりご連絡させていただく場合があります。
      </p>

      {notice ? (
        <p className="text-sm font-medium leading-6 text-amber-700">{notice}</p>
      ) : null}

      <a
        href={reservation.confirmationUrl}
        className="flex min-h-12 items-center justify-center rounded-[12px] border border-blue-200 bg-white px-4 text-center text-sm font-bold text-blue-700 transition hover:bg-blue-50"
      >
        予約内容の確認・キャンセル
      </a>

      <div data-reservation-complete-additional-content>
        {additionalContent}
      </div>
    </main>
  );
}
