"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { getShakenExpiryLabel } from "@/lib/vehicles/shaken-expiry";

type ReservationStatus = "受付中" | "確定" | "完了" | "キャンセル";

type CustomerDetailItem = {
  id: string;
  name: string;
  phone: string;
  createdAt: string;
  latestReservedAt: string | null;
  vehicles: {
    id: string;
    modelName: string;
    plateNumber: string;
    shakenExpiryDate: string | null;
    createdAt: string;
  }[];
  reservations: {
    id: string;
    reservedAt: string;
    status: ReservationStatus;
    createdAt: string;
    vehicleModel: string;
  }[];
};

type LoadState =
  | { status: "loading"; message: "読み込み中です。" }
  | { status: "ready"; message: "" }
  | { status: "error"; message: string };

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

export function CustomerDetail({ customerId }: { customerId: string }) {
  const [customer, setCustomer] = useState<CustomerDetailItem | null>(null);
  const [loadState, setLoadState] = useState<LoadState>({
    status: "loading",
    message: "読み込み中です。",
  });
  const [updatingVehicleId, setUpdatingVehicleId] = useState<string | null>(
    null,
  );
  const [updateMessage, setUpdateMessage] = useState("");

  const loadCustomer = useCallback(async () => {
    setLoadState({ status: "loading", message: "読み込み中です。" });

    const response = await fetch(`/api/admin/customers/${customerId}`, {
      cache: "no-store",
    });
    const result = (await response.json()) as {
      ok: boolean;
      customer?: CustomerDetailItem;
      message?: string;
    };

    if (!response.ok || !result.ok || !result.customer) {
      setLoadState({
        status: "error",
        message: result.message ?? "顧客詳細の取得に失敗しました。",
      });
      return;
    }

    setCustomer(result.customer);
    setLoadState({ status: "ready", message: "" });
  }, [customerId]);

  async function handleLogout() {
    await fetch("/api/admin/logout", {
      method: "POST",
    });
    window.location.href = "/admin/login";
  }

  async function updateShakenExpiryDate(
    event: FormEvent<HTMLFormElement>,
    vehicleId: string,
  ) {
    event.preventDefault();
    setUpdatingVehicleId(vehicleId);
    setUpdateMessage("");

    const formData = new FormData(event.currentTarget);
    const shakenExpiryDate = formData.get("shakenExpiryDate");

    const response = await fetch(`/api/admin/customers/${customerId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        vehicleId,
        shakenExpiryDate,
      }),
    });
    const result = (await response.json()) as {
      ok: boolean;
      vehicle?: {
        id: string;
        shakenExpiryDate: string | null;
      };
      message?: string;
    };

    if (!response.ok || !result.ok || !result.vehicle) {
      setUpdateMessage(result.message ?? "車検満了日の更新に失敗しました。");
      setUpdatingVehicleId(null);
      return;
    }

    setCustomer((current) =>
      current
        ? {
            ...current,
            vehicles: current.vehicles.map((vehicle) =>
              vehicle.id === result.vehicle?.id
                ? {
                    ...vehicle,
                    shakenExpiryDate: result.vehicle.shakenExpiryDate,
                  }
                : vehicle,
            ),
          }
        : current,
    );
    setUpdateMessage("車検満了日を更新しました。");
    setUpdatingVehicleId(null);
  }

  useEffect(() => {
    void loadCustomer();
  }, [loadCustomer]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-blue-700">
                Kawashima Motors
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-normal sm:text-3xl">
                顧客詳細
              </h1>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link
                href="/admin/customers"
                className="flex h-10 items-center justify-center rounded-md border border-blue-200 bg-white px-4 text-sm font-semibold text-blue-700 shadow-sm transition hover:bg-blue-50"
              >
                顧客一覧
              </Link>
              <Link
                href="/admin"
                className="flex h-10 items-center justify-center rounded-md border border-blue-200 bg-white px-4 text-sm font-semibold text-blue-700 shadow-sm transition hover:bg-blue-50"
              >
                予約管理
              </Link>
              <button
                type="button"
                onClick={() => void loadCustomer()}
                className="h-10 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
              >
                最新に更新
              </button>
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                ログアウト
              </button>
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-5 py-6 sm:px-6 lg:px-8">
        {loadState.message ? (
          <div
            className={
              loadState.status === "error"
                ? "mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
                : "mb-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700"
            }
          >
            {loadState.message}
          </div>
        ) : null}
        {customer ? (
          <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
            <aside className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-semibold text-blue-700">
                Customer Profile
              </p>
              <h2 className="mt-2 text-2xl font-bold tracking-normal">
                {customer.name}
              </h2>
              <dl className="mt-6 grid gap-4 text-sm">
                <div>
                  <dt className="text-slate-500">電話番号</dt>
                  <dd className="mt-1 font-semibold text-slate-950">
                    {customer.phone || "未登録"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">登録日</dt>
                  <dd className="mt-1 font-semibold text-slate-950">
                    {formatDate(customer.createdAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">最新予約日</dt>
                  <dd className="mt-1 font-semibold text-slate-950">
                    {customer.latestReservedAt
                      ? formatDateTime(customer.latestReservedAt)
                      : "なし"}
                  </dd>
                </div>
              </dl>
              <div className="mt-6 grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">車両</p>
                  <p className="mt-2 text-2xl font-bold">
                    {customer.vehicles.length}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">予約</p>
                  <p className="mt-2 text-2xl font-bold">
                    {customer.reservations.length}
                  </p>
                </div>
              </div>
            </aside>
            <div className="grid gap-6">
              {updateMessage ? (
                <div
                  className={
                    updateMessage.includes("失敗")
                      ? "rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
                      : "rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700"
                  }
                >
                  {updateMessage}
                </div>
              ) : null}
              <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-5 py-4">
                  <h2 className="text-base font-semibold">車両一覧</h2>
                </div>
                <div className="divide-y divide-slate-100">
                  {customer.vehicles.map((vehicle) => (
                    <div
                      key={vehicle.id}
                      className="grid gap-4 px-5 py-4 lg:grid-cols-[1fr_280px]"
                    >
                      <div className="grid gap-3">
                        <div>
                          <p className="font-semibold text-slate-950">
                            {vehicle.modelName}
                          </p>
                          <p className="mt-1 text-sm text-slate-500">
                            ナンバー {vehicle.plateNumber || "未登録"} / 登録日{" "}
                            {formatDate(vehicle.createdAt)}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
                            車検満了日{" "}
                            {vehicle.shakenExpiryDate
                              ? formatDate(vehicle.shakenExpiryDate)
                              : "未登録"}
                          </span>
                          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 ring-1 ring-blue-100">
                            {getShakenExpiryLabel(vehicle.shakenExpiryDate)}
                          </span>
                        </div>
                      </div>
                      <form
                        onSubmit={(event) =>
                          void updateShakenExpiryDate(event, vehicle.id)
                        }
                        className="grid gap-2"
                      >
                        <label className="text-sm font-semibold text-slate-700">
                          車検満了日
                          <input
                            name="shakenExpiryDate"
                            type="date"
                            defaultValue={vehicle.shakenExpiryDate ?? ""}
                            className="mt-2 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-600"
                          />
                        </label>
                        <button
                          type="submit"
                          disabled={updatingVehicleId === vehicle.id}
                          className="h-10 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                        >
                          保存
                        </button>
                      </form>
                    </div>
                  ))}
                  {!customer.vehicles.length ? (
                    <div className="px-5 py-8 text-center text-sm text-slate-500">
                      登録車両はありません。
                    </div>
                  ) : null}
                </div>
              </section>
              <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-5 py-4">
                  <h2 className="text-base font-semibold">予約履歴</h2>
                </div>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                    <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                      <tr>
                        <th className="px-5 py-3">予約日時</th>
                        <th className="px-5 py-3">車種</th>
                        <th className="px-5 py-3">ステータス</th>
                        <th className="px-5 py-3">登録日</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {customer.reservations.map((reservation) => (
                        <tr key={reservation.id} className="hover:bg-slate-50">
                          <td className="px-5 py-4 font-semibold text-slate-950">
                            {formatDateTime(reservation.reservedAt)}
                          </td>
                          <td className="px-5 py-4 text-slate-600">
                            {reservation.vehicleModel}
                          </td>
                          <td className="px-5 py-4">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${statusClassName(
                                reservation.status,
                              )}`}
                            >
                              {reservation.status}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-slate-600">
                            {formatDate(reservation.createdAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="divide-y divide-slate-100 md:hidden">
                  {customer.reservations.map((reservation) => (
                    <div key={reservation.id} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-950">
                            {formatDateTime(reservation.reservedAt)}
                          </p>
                          <p className="mt-1 text-sm text-slate-500">
                            {reservation.vehicleModel}
                          </p>
                        </div>
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${statusClassName(
                            reservation.status,
                          )}`}
                        >
                          {reservation.status}
                        </span>
                      </div>
                      <p className="mt-3 text-sm text-slate-500">
                        登録日 {formatDate(reservation.createdAt)}
                      </p>
                    </div>
                  ))}
                </div>
                {!customer.reservations.length ? (
                  <div className="px-5 py-12 text-center text-sm text-slate-500">
                    予約履歴はありません。
                  </div>
                ) : null}
              </section>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
