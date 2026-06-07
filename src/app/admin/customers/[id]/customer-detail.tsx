"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { getAgeFromBirthDate } from "@/lib/customers/birth-date";
import { getShakenExpiryLabel } from "@/lib/vehicles/shaken-expiry";
import { AdminHeader } from "../../admin-header";

type ReservationStatus = "受付中" | "確定" | "完了" | "キャンセル";

type CustomerDetailItem = {
  id: string;
  name: string;
  nameKana: string;
  phone: string;
  birthDate: string | null;
  memo: string;
  createdAt: string;
  latestReservedAt: string | null;
  vehicles: {
    id: string;
    modelName: string;
    plateNumber: string;
    shakenExpiryDate: string | null;
    memo: string;
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
  const [updatingCustomer, setUpdatingCustomer] = useState(false);
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

  async function updateCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUpdatingCustomer(true);
    setUpdateMessage("");

    const formData = new FormData(event.currentTarget);
    const response = await fetch(`/api/admin/customers/${customerId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: formData.get("name"),
        nameKana: formData.get("nameKana"),
        phone: formData.get("phone"),
        birthDate: formData.get("birthDate"),
        memo: formData.get("memo"),
      }),
    });
    const result = (await response.json()) as {
      ok: boolean;
      customer?: {
        id: string;
        name: string;
        nameKana: string;
        phone: string;
        birthDate: string | null;
        memo: string;
      };
      message?: string;
    };

    if (!response.ok || !result.ok || !result.customer) {
      setUpdateMessage(result.message ?? "顧客情報の更新に失敗しました。");
      setUpdatingCustomer(false);
      return;
    }

    setCustomer((current) =>
      current
        ? {
            ...current,
            name: result.customer?.name ?? current.name,
            nameKana: result.customer?.nameKana ?? current.nameKana,
            phone: result.customer?.phone ?? current.phone,
            birthDate: result.customer?.birthDate ?? null,
            memo: result.customer?.memo ?? current.memo,
          }
        : current,
    );
    setUpdateMessage("顧客情報を更新しました。");
    setUpdatingCustomer(false);
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
      <AdminHeader title="顧客詳細" onRefresh={loadCustomer} />
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
                  <dt className="text-slate-500">ふりがな</dt>
                  <dd className="mt-1 font-semibold text-slate-950">
                    {customer.nameKana || "未登録"}
                  </dd>
                </div>
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
                  <dt className="text-slate-500">生年月日</dt>
                  <dd className="mt-1 font-semibold text-slate-950">
                    {customer.birthDate ? formatDate(customer.birthDate) : "未登録"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">年齢</dt>
                  <dd className="mt-1 font-semibold text-slate-950">
                    {getAgeFromBirthDate(customer.birthDate) !== null
                      ? `${getAgeFromBirthDate(customer.birthDate)}歳`
                      : "未登録"}
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
                <div>
                  <dt className="text-slate-500">メモ</dt>
                  <dd className="mt-1 whitespace-pre-wrap font-semibold text-slate-950">
                    {customer.memo || "未登録"}
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
                  <h2 className="text-base font-semibold">顧客情報編集</h2>
                </div>
                <form
                  key={`${customer.id}-${customer.name}-${customer.nameKana}-${customer.phone}-${customer.birthDate ?? ""}-${customer.memo}`}
                  onSubmit={(event) => void updateCustomer(event)}
                  className="grid gap-4 p-5 md:grid-cols-2"
                >
                  <label className="grid gap-2 text-sm font-medium text-slate-800">
                    氏名
                    <input
                      required
                      name="name"
                      defaultValue={customer.name}
                      className="h-11 rounded-md border border-slate-300 bg-white px-3 text-base font-normal outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                  </label>
                  <label className="grid gap-2 text-sm font-medium text-slate-800">
                    ふりがな
                    <input
                      name="nameKana"
                      defaultValue={customer.nameKana}
                      className="h-11 rounded-md border border-slate-300 bg-white px-3 text-base font-normal outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                  </label>
                  <label className="grid gap-2 text-sm font-medium text-slate-800">
                    電話番号
                    <input
                      required
                      name="phone"
                      inputMode="tel"
                      defaultValue={customer.phone}
                      className="h-11 rounded-md border border-slate-300 bg-white px-3 text-base font-normal outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                  </label>
                  <label className="grid gap-2 text-sm font-medium text-slate-800">
                    生年月日
                    <input
                      name="birthDate"
                      type="date"
                      defaultValue={customer.birthDate ?? ""}
                      max={new Intl.DateTimeFormat("sv-SE", {
                        year: "numeric",
                        month: "2-digit",
                        day: "2-digit",
                        timeZone: "Asia/Tokyo",
                      }).format(new Date())}
                      className="h-11 rounded-md border border-slate-300 bg-white px-3 text-base font-normal outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                  </label>
                  <label className="grid gap-2 text-sm font-medium text-slate-800 md:col-span-2">
                    顧客メモ
                    <textarea
                      name="memo"
                      rows={4}
                      defaultValue={customer.memo}
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-base font-normal outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                  </label>
                  <div className="md:col-span-2">
                    <button
                      type="submit"
                      disabled={updatingCustomer}
                      className="h-10 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                    >
                      {updatingCustomer ? "保存中..." : "顧客情報を保存"}
                    </button>
                  </div>
                </form>
              </section>
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
                          {vehicle.memo ? (
                            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
                              {vehicle.memo}
                            </p>
                          ) : null}
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
