"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminHeader } from "../../admin-header";

type SubmitState =
  | { status: "idle"; message: "" }
  | { status: "success"; message: string }
  | {
      status: "error";
      message: string;
      existingCustomerId?: string;
      existingCustomerName?: string;
    };

type CreateCustomerResponse = {
  ok: boolean;
  message?: string;
  customerId?: string;
  vehicleId?: string | null;
  existingCustomerId?: string;
  existingCustomerName?: string;
};

const getTodayJstDateKey = () =>
  new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(new Date());

export function NewCustomerForm() {
  const router = useRouter();
  const [submitState, setSubmitState] = useState<SubmitState>({
    status: "idle",
    message: "",
  });
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setSubmitState({ status: "idle", message: "" });

    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/admin/customers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: formData.get("name"),
        nameKana: formData.get("nameKana"),
        phone: formData.get("phone"),
        birthDate: formData.get("birthDate"),
        gender: formData.get("gender"),
        memo: formData.get("memo"),
        vehicleModel: formData.get("vehicleModel"),
        plateNumber: formData.get("plateNumber"),
        shakenExpiryDate: formData.get("shakenExpiryDate"),
        vehicleMemo: formData.get("vehicleMemo"),
      }),
    });
    const result = (await response.json()) as CreateCustomerResponse;

    if (!response.ok || !result.ok || !result.customerId) {
      setSubmitState({
        status: "error",
        message: result.message ?? "顧客登録に失敗しました。",
        existingCustomerId: result.existingCustomerId,
        existingCustomerName: result.existingCustomerName,
      });
      setSubmitting(false);
      return;
    }

    setSubmitState({
      status: "success",
      message: "顧客を登録しました。顧客詳細へ移動します。",
    });
    router.push(`/admin/customers/${result.customerId}`);
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <AdminHeader
        title="新規顧客登録"
        description="電話予約、店頭受付、既存顧客の事前登録に利用できます。"
        onRefresh={() => window.location.reload()}
      />
      <main className="mx-auto grid max-w-7xl gap-5 px-5 py-6 sm:px-6 lg:px-8">
        {submitState.message ? (
          <div
            className={
              submitState.status === "error"
                ? "rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
                : "rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700"
            }
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>{submitState.message}</span>
              {submitState.status === "error" &&
              submitState.existingCustomerId ? (
                <Link
                  href={`/admin/customers/${submitState.existingCustomerId}`}
                  className="w-fit rounded-md bg-white px-3 py-1.5 text-sm font-semibold text-red-700 shadow-sm ring-1 ring-red-200 transition hover:bg-red-50"
                >
                  {submitState.existingCustomerName ?? "既存顧客"}を確認
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="grid gap-5">
          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-base font-semibold">顧客情報</h2>
            </div>
            <div className="grid gap-4 p-5 md:grid-cols-2">
              <label className="grid gap-2 text-sm font-medium text-slate-800">
                氏名
                <input
                  required
                  name="name"
                  placeholder="例: 川島 太郎"
                  className="h-11 rounded-md border border-slate-300 bg-white px-3 text-base font-normal outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <label className="grid gap-2 text-sm font-medium text-slate-800">
                ふりがな
                <input
                  name="nameKana"
                  placeholder="例: かわしま たろう"
                  className="h-11 rounded-md border border-slate-300 bg-white px-3 text-base font-normal outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <label className="grid gap-2 text-sm font-medium text-slate-800">
                電話番号
                <input
                  required
                  name="phone"
                  inputMode="tel"
                  placeholder="例: 090-1234-5678"
                  className="h-11 rounded-md border border-slate-300 bg-white px-3 text-base font-normal outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <label className="grid gap-2 text-sm font-medium text-slate-800">
                生年月日
                <input
                  name="birthDate"
                  type="date"
                  max={getTodayJstDateKey()}
                  className="h-11 rounded-md border border-slate-300 bg-white px-3 text-base font-normal outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <label className="grid gap-2 text-sm font-medium text-slate-800">
                性別
                <select
                  name="gender"
                  defaultValue="未設定"
                  className="h-11 rounded-md border border-slate-300 bg-white px-3 text-base font-normal outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                >
                  <option value="未設定">未設定</option>
                  <option value="男性">男性</option>
                  <option value="女性">女性</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm font-medium text-slate-800 md:col-span-2">
                メモ
                <textarea
                  name="memo"
                  rows={4}
                  placeholder="電話予約や店頭受付時の補足を記録できます。"
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-base font-normal outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>
            </div>
          </section>

          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-base font-semibold">車両情報</h2>
              <p className="mt-1 text-sm text-slate-500">
                車両情報は任意です。顧客だけ登録することもできます。
              </p>
            </div>
            <div className="grid gap-4 p-5 md:grid-cols-2">
              <label className="grid gap-2 text-sm font-medium text-slate-800">
                車種
                <input
                  name="vehicleModel"
                  placeholder="例: プリウス"
                  className="h-11 rounded-md border border-slate-300 bg-white px-3 text-base font-normal outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <label className="grid gap-2 text-sm font-medium text-slate-800">
                ナンバー
                <input
                  name="plateNumber"
                  placeholder="例: 静岡 300 あ 12-34"
                  className="h-11 rounded-md border border-slate-300 bg-white px-3 text-base font-normal outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <label className="grid gap-2 text-sm font-medium text-slate-800">
                車検満了日
                <input
                  name="shakenExpiryDate"
                  type="date"
                  className="h-11 rounded-md border border-slate-300 bg-white px-3 text-base font-normal outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <label className="grid gap-2 text-sm font-medium text-slate-800 md:col-span-2">
                車両メモ
                <textarea
                  name="vehicleMemo"
                  rows={4}
                  placeholder="代車希望、注意事項、過去整備内容などを記録できます。"
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-base font-normal outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>
            </div>
          </section>

          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <Link
              href="/admin/customers"
              className="flex h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              キャンセル
            </Link>
            <button
              type="submit"
              disabled={submitting}
              className="h-11 rounded-md bg-blue-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {submitting ? "登録中..." : "顧客を登録"}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
