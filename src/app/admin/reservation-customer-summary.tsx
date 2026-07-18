"use client";

import { getAgeFromBirthDate } from "@/lib/customers/birth-date";

type ReservationStatus = "受付中" | "確定" | "完了" | "キャンセル";

export type ReservationCustomerDetail = {
  id: string;
  name: string;
  nameKana: string;
  phone: string;
  birthDate: string | null;
  gender: "男性" | "女性" | "未設定";
  lineStatus: string | null;
  lineDisplayName: string | null;
  memo: string;
  vehicles: {
    id: string;
    modelName: string;
    plateNumber: string;
    shakenExpiryDate: string | null;
    memo: string;
  }[];
  reservations: {
    id: string;
    reservedAt: string;
    status: ReservationStatus;
    vehicleModel: string;
  }[];
  lineMessageLogs: {
    id: string;
    sentAt: string;
    deliveryType: "手動" | "セグメント" | "自動";
    title: string;
    body: string;
    imageUrl: string | null;
    status: "成功" | "失敗";
    errorMessage: string | null;
  }[];
};

type ReservationCustomerSummaryProps = {
  customer: ReservationCustomerDetail | null;
  loading: boolean;
  error: string;
};

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(new Date(value));

const valueOrDash = (value: string | null | undefined) => {
  const normalized = value?.trim();
  return normalized ? normalized : "－";
};

export function ReservationCustomerSummary({
  customer,
  loading,
  error,
}: ReservationCustomerSummaryProps) {
  if (loading) {
    return (
      <div className="border-t border-slate-200 px-4 py-6 text-center text-sm text-slate-500 sm:px-5">
        顧客情報を読み込んでいます。
      </div>
    );
  }

  if (error) {
    return (
      <div className="border-t border-slate-200 px-4 py-5 sm:px-5">
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {error}
        </p>
      </div>
    );
  }

  if (!customer) {
    return null;
  }

  const age = getAgeFromBirthDate(customer.birthDate);
  return (
    <div>
      <section className="border-b border-slate-200 p-4 sm:p-5">
        <h3 className="text-base font-bold text-slate-950">顧客情報</h3>
        <dl className="mt-4 grid gap-x-5 gap-y-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-semibold text-slate-500">氏名</dt>
            <dd className="mt-1 font-bold text-slate-950">{customer.name} 様</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-500">ふりがな</dt>
            <dd className="mt-1 font-bold text-slate-950">
              {customer.nameKana || "未登録"}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-500">電話番号</dt>
            <dd className="mt-1 font-bold text-slate-950">
              {customer.phone || "未登録"}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-500">性別</dt>
            <dd className="mt-1 font-bold text-slate-950">{customer.gender}</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-500">生年月日</dt>
            <dd className="mt-1 font-bold text-slate-950">
              {customer.birthDate ? formatDate(customer.birthDate) : "未登録"}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-500">年齢</dt>
            <dd className="mt-1 font-bold text-slate-950">
              {age === null ? "未登録" : `${age}歳`}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-500">LINE連携</dt>
            <dd className="mt-1 font-bold text-slate-950">
              {customer.lineStatus || "未連携"}
            </dd>
          </div>
        </dl>
      </section>

      <section className="border-b border-slate-200 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-bold text-slate-950">車両情報</h3>
          <span className="text-sm font-bold text-slate-500">
            {customer.vehicles.length}台
          </span>
        </div>
        <div className="mt-3 grid gap-3">
          {customer.vehicles.map((vehicle) => (
            <dl
              key={vehicle.id}
              className="grid gap-x-4 gap-y-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm sm:grid-cols-2"
            >
              <div>
                <dt className="font-semibold text-slate-500">車名</dt>
                <dd className="mt-1 font-bold text-slate-700">
                  {valueOrDash(vehicle.modelName)}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">ナンバー</dt>
                <dd className="mt-1 font-bold text-slate-700">
                  {valueOrDash(vehicle.plateNumber)}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">車検満了日</dt>
                <dd className="mt-1 font-bold text-slate-700">
                  {vehicle.shakenExpiryDate
                    ? formatDate(vehicle.shakenExpiryDate)
                    : "－"}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">車両メモ</dt>
                <dd className="mt-1 whitespace-pre-wrap font-bold text-slate-700">
                  {valueOrDash(vehicle.memo)}
                </dd>
              </div>
            </dl>
          ))}
          {!customer.vehicles.length ? (
            <p className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">
              登録車両はありません。
            </p>
          ) : null}
        </div>
      </section>

      <section className="border-b border-slate-200 p-4 sm:p-5">
        <h3 className="text-base font-bold text-slate-950">備考</h3>
        <p className="mt-3 whitespace-pre-wrap text-sm font-bold text-slate-700">
          {valueOrDash(customer.memo)}
        </p>
      </section>
    </div>
  );
}
