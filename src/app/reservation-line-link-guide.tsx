import Link from "next/link";

export function ReservationLineLinkGuide() {
  return (
    <section className="grid gap-4 rounded-[12px] border border-emerald-200 bg-emerald-50 p-5 text-center">
      <div>
        <h3 className="text-lg font-black text-emerald-950">LINE連携のご案内</h3>
        <p className="mt-2 text-sm font-medium leading-6 text-emerald-900 sm:text-base">
          LINE連携をすると、予約確認・キャンセル・車検時期のお知らせをLINEで受け取れます。
        </p>
      </div>
      <Link
        href="/reservations/line-link"
        className="flex min-h-14 items-center justify-center rounded-[12px] bg-[#06C755] px-5 text-base font-black text-white shadow-sm transition hover:bg-[#05B84E]"
      >
        LINE連携する
      </Link>
      <p className="text-xs font-medium leading-5 text-emerald-800">
        LINE連携は任意です。
        <br />
        あとからでも連携できます。
      </p>
    </section>
  );
}
