"use client";

import { useEffect, useState } from "react";
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

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(new Date(value));

const statusClassName = (status: ReservationStatus) => {
  switch (status) {
    case "確定":
      return "bg-blue-50 text-blue-700 ring-blue-200";
    case "完了":
      return "bg-emerald-50 text-emerald-700 ring-emerald-200";
    case "キャンセル":
      return "bg-zinc-100 text-zinc-600 ring-zinc-200";
    default:
      return "bg-amber-50 text-amber-700 ring-amber-200";
  }
};

export function ReservationCustomerSummary({
  customer,
  loading,
  error,
}: ReservationCustomerSummaryProps) {
  const [showAllReservations, setShowAllReservations] = useState(false);
  const [showAllLineLogs, setShowAllLineLogs] = useState(false);

  useEffect(() => {
    setShowAllReservations(false);
    setShowAllLineLogs(false);
  }, [customer?.id]);

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
  const visibleReservations = showAllReservations
    ? customer.reservations
    : customer.reservations.slice(0, 1);
  const visibleLineLogs = showAllLineLogs
    ? customer.lineMessageLogs
    : customer.lineMessageLogs.slice(0, 1);

  return (
    <div className="grid gap-5 border-t border-slate-200 p-4 sm:p-5">
      <section>
        <h3 className="text-sm font-bold text-slate-950">顧客情報</h3>
        <dl className="mt-3 grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">氏名</dt>
            <dd className="mt-1 font-semibold">{customer.name} 様</dd>
          </div>
          <div>
            <dt className="text-slate-500">ふりがな</dt>
            <dd className="mt-1 font-semibold">{customer.nameKana || "未登録"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">電話番号</dt>
            <dd className="mt-1 font-semibold">{customer.phone || "未登録"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">性別</dt>
            <dd className="mt-1 font-semibold">{customer.gender}</dd>
          </div>
          <div>
            <dt className="text-slate-500">生年月日</dt>
            <dd className="mt-1 font-semibold">
              {customer.birthDate ? formatDate(customer.birthDate) : "未登録"}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">年齢</dt>
            <dd className="mt-1 font-semibold">{age === null ? "未登録" : `${age}歳`}</dd>
          </div>
          <div>
            <dt className="text-slate-500">LINE連携</dt>
            <dd className="mt-1 font-semibold">{customer.lineStatus || "未連携"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">LINE表示名</dt>
            <dd className="mt-1 font-semibold">{customer.lineDisplayName || "未登録"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-slate-500">顧客メモ</dt>
            <dd className="mt-1 whitespace-pre-wrap font-semibold">
              {customer.memo || "未登録"}
            </dd>
          </div>
        </dl>
      </section>

      <section className="border-t border-slate-200 pt-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-slate-950">車両情報</h3>
          <span className="text-xs font-semibold text-slate-500">
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
                <dt className="text-slate-500">車名</dt>
                <dd className="mt-1 font-semibold">{vehicle.modelName || "未登録"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">ナンバー</dt>
                <dd className="mt-1 font-semibold">{vehicle.plateNumber || "未登録"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">車検満了日</dt>
                <dd className="mt-1 font-semibold">
                  {vehicle.shakenExpiryDate
                    ? formatDate(vehicle.shakenExpiryDate)
                    : "未登録"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">車両メモ</dt>
                <dd className="mt-1 whitespace-pre-wrap font-semibold">
                  {vehicle.memo || "未登録"}
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

      <section className="border-t border-slate-200 pt-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-slate-950">予約履歴</h3>
          <button
            type="button"
            disabled={customer.reservations.length <= 1}
            aria-expanded={showAllReservations}
            onClick={() => setShowAllReservations((current) => !current)}
            className="cursor-pointer text-xs font-semibold text-blue-700 hover:text-blue-900 disabled:cursor-default disabled:text-slate-400"
          >
            {showAllReservations ? "閉じる" : "もっと見る"}
          </button>
        </div>
        <div className="mt-3 grid gap-2">
          {visibleReservations.map((reservation) => (
            <div
              key={reservation.id}
              className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{formatDateTime(reservation.reservedAt)}</p>
                  <p className="mt-1 text-slate-500">{reservation.vehicleModel}</p>
                </div>
                <span
                  className={`w-fit rounded-full px-2 py-1 text-xs font-semibold ring-1 ${statusClassName(
                    reservation.status,
                  )}`}
                >
                  {reservation.status}
                </span>
              </div>
            </div>
          ))}
          {!customer.reservations.length ? (
            <p className="text-sm text-slate-500">予約履歴はありません。</p>
          ) : null}
        </div>
      </section>

      <section className="border-t border-slate-200 pt-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-slate-950">LINE配信履歴</h3>
          <button
            type="button"
            disabled={customer.lineMessageLogs.length <= 1}
            aria-expanded={showAllLineLogs}
            onClick={() => setShowAllLineLogs((current) => !current)}
            className="cursor-pointer text-xs font-semibold text-blue-700 hover:text-blue-900 disabled:cursor-default disabled:text-slate-400"
          >
            {showAllLineLogs ? "閉じる" : "もっと見る"}
          </button>
        </div>
        <div className="mt-3 grid gap-2">
          {visibleLineLogs.map((log) => (
            <div
              key={log.id}
              className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">{log.title || "タイトルなし"}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatDateTime(log.sentAt)} / {log.deliveryType}
                  </p>
                  <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-slate-600">
                    {log.body || "本文なし"}
                  </p>
                  {log.imageUrl ? (
                    <span className="mt-2 inline-flex text-xs font-semibold text-blue-700">
                      画像あり
                    </span>
                  ) : null}
                  {log.errorMessage ? (
                    <p className="mt-2 text-xs font-semibold text-red-700">
                      {log.errorMessage}
                    </p>
                  ) : null}
                </div>
                <span
                  className={
                    log.status === "成功"
                      ? "w-fit shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200"
                      : "w-fit shrink-0 rounded-full bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 ring-1 ring-red-200"
                  }
                >
                  {log.status}
                </span>
              </div>
            </div>
          ))}
          {!customer.lineMessageLogs.length ? (
            <p className="text-sm text-slate-500">LINE配信履歴はありません。</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
