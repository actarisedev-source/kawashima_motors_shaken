"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type ReservationStatus = "受付中" | "確定" | "完了" | "キャンセル";

type ReservationConfirmationItem = {
  id: string;
  reservedAt: string;
  status: ReservationStatus;
  customerName: string;
  phone: string;
  vehicleModel: string;
};

type LoadState =
  | { status: "loading"; message: "読み込み中です。" }
  | { status: "ready"; message: "" }
  | { status: "error"; message: string };

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

export function ReservationConfirmation({ token }: { token: string }) {
  const [reservation, setReservation] =
    useState<ReservationConfirmationItem | null>(null);
  const [loadState, setLoadState] = useState<LoadState>({
    status: "loading",
    message: "読み込み中です。",
  });
  const [cancelMessage, setCancelMessage] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);

  const loadReservation = useCallback(async () => {
    setLoadState({ status: "loading", message: "読み込み中です。" });

    const response = await fetch(`/api/reservations/confirmation/${token}`, {
      cache: "no-store",
    });
    const result = (await response.json()) as {
      ok: boolean;
      reservation?: ReservationConfirmationItem;
      message?: string;
    };

    if (!response.ok || !result.ok || !result.reservation) {
      setLoadState({
        status: "error",
        message: result.message ?? "予約情報の取得に失敗しました。",
      });
      return;
    }

    setReservation(result.reservation);
    setLoadState({ status: "ready", message: "" });
  }, [token]);

  async function cancelReservation() {
    setIsCancelling(true);
    setCancelMessage("");

    const response = await fetch(`/api/reservations/confirmation/${token}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "cancel" }),
    });
    const result = (await response.json()) as {
      ok: boolean;
      reservation?: {
        id: string;
        status: ReservationStatus;
      };
      message?: string;
    };

    if (!response.ok || !result.ok || !result.reservation) {
      setCancelMessage(result.message ?? "キャンセルに失敗しました。");
      setIsCancelling(false);
      return;
    }

    const cancelledStatus = result.reservation.status;
    setReservation((current) =>
      current ? { ...current, status: cancelledStatus } : current,
    );
    setCancelMessage("予約をキャンセルしました。");
    setIsCancelling(false);
  }

  useEffect(() => {
    void loadReservation();
  }, [loadReservation]);

  const canCancel =
    reservation?.status === "受付中" || reservation?.status === "確定";

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950 sm:px-6">
      <div className="mx-auto grid max-w-3xl gap-6">
        <header className="grid gap-2">
          <p className="text-sm font-semibold text-blue-700">
            Kawashima Motors
          </p>
          <h1 className="text-3xl font-bold tracking-normal sm:text-4xl">
            予約確認
          </h1>
        </header>

        {loadState.message ? (
          <div
            className={
              loadState.status === "error"
                ? "rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
                : "rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700"
            }
          >
            {loadState.message}
          </div>
        ) : null}

        {reservation ? (
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-100 pb-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm text-slate-500">受付番号</p>
                <p className="mt-1 break-all text-sm font-semibold text-slate-950">
                  {reservation.id}
                </p>
              </div>
              <span
                className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ring-1 ${statusClassName(
                  reservation.status,
                )}`}
              >
                {reservation.status}
              </span>
            </div>

            <dl className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-slate-500">予約日時</dt>
                <dd className="mt-1 text-lg font-bold text-slate-950">
                  {formatDateTime(reservation.reservedAt)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-slate-500">車種</dt>
                <dd className="mt-1 text-lg font-bold text-slate-950">
                  {reservation.vehicleModel}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-slate-500">お名前</dt>
                <dd className="mt-1 font-semibold text-slate-950">
                  {reservation.customerName}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-slate-500">電話番号</dt>
                <dd className="mt-1 font-semibold text-slate-950">
                  {reservation.phone || "未登録"}
                </dd>
              </div>
            </dl>

            <div className="mt-6 grid gap-3 border-t border-slate-100 pt-5">
              {canCancel ? (
                <button
                  type="button"
                  disabled={isCancelling}
                  onClick={() => void cancelReservation()}
                  className="h-11 rounded-md bg-red-600 px-5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                >
                  {isCancelling ? "キャンセル中です" : "この予約をキャンセル"}
                </button>
              ) : (
                <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-600">
                  この予約は現在キャンセル操作できません。
                </p>
              )}
              {cancelMessage ? (
                <p
                  className={
                    reservation.status === "キャンセル"
                      ? "text-sm font-medium text-emerald-700"
                      : "text-sm font-medium text-red-700"
                  }
                >
                  {cancelMessage}
                </p>
              ) : null}
            </div>
          </section>
        ) : null}

        <Link
          href="/"
          className="flex h-11 w-fit items-center rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
        >
          予約フォームへ戻る
        </Link>
      </div>
    </main>
  );
}
