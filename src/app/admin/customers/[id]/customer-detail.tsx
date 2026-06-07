"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getAgeFromBirthDate } from "@/lib/customers/birth-date";
import { isValidHiragana, kanaErrorMessage } from "@/lib/customers/kana";
import { AdminHeader } from "../../admin-header";

type ReservationStatus = "受付中" | "確定" | "完了" | "キャンセル";

type VehicleItem = {
  id: string;
  modelName: string;
  plateNumber: string;
  shakenExpiryDate: string | null;
  memo: string;
  createdAt: string;
};

type VehicleDraft = VehicleItem & {
  clientId: string;
};

type CustomerDetailItem = {
  id: string;
  name: string;
  nameKana: string;
  phone: string;
  birthDate: string | null;
  memo: string;
  createdAt: string;
  latestReservedAt: string | null;
  vehicles: VehicleItem[];
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

const emptyVehicleDraft = (): VehicleDraft => ({
  id: "",
  clientId: crypto.randomUUID(),
  modelName: "",
  plateNumber: "",
  shakenExpiryDate: null,
  memo: "",
  createdAt: new Date().toISOString(),
});

const toVehicleDrafts = (vehicles: VehicleItem[]): VehicleDraft[] =>
  vehicles.map((vehicle) => ({
    ...vehicle,
    clientId: vehicle.id,
  }));

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

const readonlyValueClassName =
  "mt-2 min-h-11 rounded-xl border border-[#E2E8F0] bg-[#F5F7FA] px-4 py-2.5 font-bold text-slate-950";

const readonlyLabelClassName = "text-sm font-semibold text-slate-500";

const inputClassName =
  "h-11 rounded-lg border border-slate-300 bg-white px-3 text-base font-normal outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

export function CustomerDetail({ customerId }: { customerId: string }) {
  const [customer, setCustomer] = useState<CustomerDetailItem | null>(null);
  const [vehicleDrafts, setVehicleDrafts] = useState<VehicleDraft[]>([]);
  const [loadState, setLoadState] = useState<LoadState>({
    status: "loading",
    message: "読み込み中です。",
  });
  const [updatingCustomer, setUpdatingCustomer] = useState(false);
  const [isEditingCustomer, setIsEditingCustomer] = useState(false);
  const [isConfirmingEdit, setIsConfirmingEdit] = useState(false);
  const [updateMessage, setUpdateMessage] = useState("");
  const [customerKanaError, setCustomerKanaError] = useState("");

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
    setVehicleDrafts(toVehicleDrafts(result.customer.vehicles));
    setLoadState({ status: "ready", message: "" });
  }, [customerId]);

  async function updateCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUpdatingCustomer(true);
    setUpdateMessage("");

    const formData = new FormData(event.currentTarget);
    const nameKana = String(formData.get("nameKana") ?? "");

    if (!isValidHiragana(nameKana)) {
      setCustomerKanaError(kanaErrorMessage);
      setUpdateMessage(kanaErrorMessage);
      setUpdatingCustomer(false);
      return;
    }

    const response = await fetch(`/api/admin/customers/${customerId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: formData.get("name"),
        nameKana,
        phone: formData.get("phone"),
        birthDate: formData.get("birthDate"),
        memo: formData.get("memo"),
        vehicles: vehicleDrafts.map((vehicle) => ({
          id: vehicle.id || undefined,
          modelName: vehicle.modelName,
          plateNumber: vehicle.plateNumber,
          shakenExpiryDate: vehicle.shakenExpiryDate,
          memo: vehicle.memo,
        })),
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
        vehicles?: VehicleItem[];
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
            vehicles: result.customer?.vehicles ?? current.vehicles,
          }
        : current,
    );
    setVehicleDrafts(toVehicleDrafts(result.customer.vehicles ?? []));
    setUpdateMessage("顧客情報を更新しました。");
    setIsEditingCustomer(false);
    setUpdatingCustomer(false);
  }

  useEffect(() => {
    void loadCustomer();
  }, [loadCustomer]);

  function startCustomerEdit() {
    setUpdateMessage("");
    setIsConfirmingEdit(true);
  }

  function confirmCustomerEdit() {
    if (customer) {
      setVehicleDrafts(toVehicleDrafts(customer.vehicles));
    }
    setIsConfirmingEdit(false);
    setIsEditingCustomer(true);
    setCustomerKanaError("");
  }

  function cancelCustomerEdit() {
    if (customer) {
      setVehicleDrafts(toVehicleDrafts(customer.vehicles));
    }
    setIsEditingCustomer(false);
    setUpdateMessage("");
    setCustomerKanaError("");
  }

  function updateVehicleDraft(
    clientId: string,
    field: keyof Pick<
      VehicleDraft,
      "modelName" | "plateNumber" | "shakenExpiryDate" | "memo"
    >,
    value: string,
  ) {
    setVehicleDrafts((current) =>
      current.map((vehicle) =>
        vehicle.clientId === clientId
          ? {
              ...vehicle,
              [field]: field === "shakenExpiryDate" ? value || null : value,
            }
          : vehicle,
      ),
    );
  }

  function removeVehicleDraft(clientId: string) {
    if (!window.confirm("この車両を削除しますか？")) {
      return;
    }

    setVehicleDrafts((current) =>
      current.filter((vehicle) => vehicle.clientId !== clientId),
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <AdminHeader title="顧客詳細" onRefresh={loadCustomer}>
        <Link
          href="/admin/customers"
          className="inline-flex w-fit items-center gap-2 text-sm font-semibold text-blue-700 transition hover:text-blue-800"
        >
          <span aria-hidden="true" className="text-lg leading-none">
            ←
          </span>
          顧客一覧に戻る
        </Link>
      </AdminHeader>
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
          <div className="grid gap-6">
            {isConfirmingEdit ? (
              <div
                className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 px-5"
                role="dialog"
                aria-modal="true"
                aria-labelledby="customer-edit-confirm-title"
              >
                <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
                  <h2
                    id="customer-edit-confirm-title"
                    className="text-lg font-bold text-slate-950"
                  >
                    顧客情報修正
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    顧客情報および車両情報を修正しますがよろしいですか？
                  </p>
                  <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      onClick={() => setIsConfirmingEdit(false)}
                      className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      いいえ
                    </button>
                    <button
                      type="button"
                      autoFocus
                      onClick={confirmCustomerEdit}
                      className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700"
                    >
                      はい
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {updateMessage ? (
              <div
                className={
                  updateMessage.includes("失敗") ||
                  updateMessage.includes("入力") ||
                  updateMessage.includes("重複")
                    ? "rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
                    : "rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700"
                }
              >
                {updateMessage}
              </div>
            ) : null}

            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-lg font-bold">
                  {isEditingCustomer ? "顧客詳細（編集中）" : "顧客詳細"}
                </h2>
                {isEditingCustomer ? (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={cancelCustomerEdit}
                      disabled={updatingCustomer}
                      className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      キャンセル
                    </button>
                    <button
                      type="submit"
                      form="customer-detail-form"
                      disabled={updatingCustomer || Boolean(customerKanaError)}
                      className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                    >
                      {updatingCustomer ? "保存中..." : "保存"}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={startCustomerEdit}
                    className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                  >
                    修正
                  </button>
                )}
              </div>

              {isEditingCustomer ? (
                <form
                  id="customer-detail-form"
                  key={`${customer.id}-${customer.name}-${customer.nameKana}-${customer.phone}-${customer.birthDate ?? ""}-${customer.memo}`}
                  onSubmit={(event) => void updateCustomer(event)}
                  className="grid gap-8 p-6 sm:p-8"
                >
                  <section className="grid gap-4">
                    <h3 className="text-base font-bold">顧客情報</h3>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                      <label className="grid gap-2 text-sm font-medium text-slate-800">
                        氏名
                        <input
                          required
                          name="name"
                          defaultValue={customer.name}
                          className={inputClassName}
                        />
                      </label>
                      <label className="grid gap-2 text-sm font-medium text-slate-800">
                        ふりがな
                        <input
                          name="nameKana"
                          defaultValue={customer.nameKana}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setCustomerKanaError(
                              isValidHiragana(nextValue) ? "" : kanaErrorMessage,
                            );
                          }}
                          aria-invalid={customerKanaError ? "true" : "false"}
                          aria-describedby="customer-name-kana-error"
                          className={
                            customerKanaError
                              ? "h-11 rounded-lg border border-red-400 bg-white px-3 text-base font-normal outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-100"
                              : inputClassName
                          }
                        />
                        {customerKanaError ? (
                          <span
                            id="customer-name-kana-error"
                            className="text-xs font-semibold text-red-600"
                          >
                            {customerKanaError}
                          </span>
                        ) : null}
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
                          className={inputClassName}
                        />
                      </label>
                      <div className="grid gap-2 text-sm font-medium text-slate-800">
                        年齢
                        <div className="flex h-11 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-base font-semibold text-slate-500">
                          {getAgeFromBirthDate(customer.birthDate) !== null
                            ? `${getAgeFromBirthDate(customer.birthDate)}歳`
                            : "未登録"}
                        </div>
                      </div>
                      <label className="grid gap-2 text-sm font-medium text-slate-800">
                        電話番号
                        <input
                          required
                          name="phone"
                          inputMode="tel"
                          defaultValue={customer.phone}
                          className={inputClassName}
                        />
                      </label>
                      <div className="grid gap-2 text-sm font-medium text-slate-800">
                        登録日
                        <div className="flex h-11 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-base font-semibold text-slate-500">
                          {formatDate(customer.createdAt)}
                        </div>
                      </div>
                      <label className="grid gap-2 text-sm font-medium text-slate-800 md:col-span-2 lg:col-span-4">
                        顧客メモ
                        <textarea
                          name="memo"
                          rows={4}
                          defaultValue={customer.memo}
                          className="min-h-28 rounded-lg border border-slate-300 bg-white px-3 py-2 text-base font-normal outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        />
                      </label>
                    </div>
                  </section>

                  <section className="grid gap-4 border-t border-slate-200 pt-6">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="text-base font-bold">車両情報</h3>
                        <p className="mt-1 text-sm text-slate-500">
                          車両数：{vehicleDrafts.length}台
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setVehicleDrafts((current) => [
                            ...current,
                            emptyVehicleDraft(),
                          ])
                        }
                        className="h-10 rounded-lg border border-blue-200 bg-white px-4 text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
                      >
                        車両追加
                      </button>
                    </div>
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full min-w-[860px] border-collapse text-left text-sm">
                        <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
                          <tr>
                            <th className="px-4 py-3">車名</th>
                            <th className="px-4 py-3">ナンバー</th>
                            <th className="px-4 py-3">車検満了日</th>
                            <th className="px-4 py-3">車両メモ</th>
                            <th className="px-4 py-3 text-right">削除</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {vehicleDrafts.map((vehicle) => (
                            <tr key={vehicle.clientId}>
                              <td className="px-4 py-3">
                                <input
                                  required
                                  value={vehicle.modelName}
                                  onChange={(event) =>
                                    updateVehicleDraft(
                                      vehicle.clientId,
                                      "modelName",
                                      event.target.value,
                                    )
                                  }
                                  className="h-10 w-full rounded-lg border border-slate-300 px-3 outline-none focus:border-blue-500"
                                />
                              </td>
                              <td className="px-4 py-3">
                                <input
                                  value={vehicle.plateNumber}
                                  onChange={(event) =>
                                    updateVehicleDraft(
                                      vehicle.clientId,
                                      "plateNumber",
                                      event.target.value,
                                    )
                                  }
                                  className="h-10 w-full rounded-lg border border-slate-300 px-3 outline-none focus:border-blue-500"
                                />
                              </td>
                              <td className="px-4 py-3">
                                <input
                                  type="date"
                                  value={vehicle.shakenExpiryDate ?? ""}
                                  onChange={(event) =>
                                    updateVehicleDraft(
                                      vehicle.clientId,
                                      "shakenExpiryDate",
                                      event.target.value,
                                    )
                                  }
                                  className="h-10 w-full rounded-lg border border-slate-300 px-3 outline-none focus:border-blue-500"
                                />
                              </td>
                              <td className="px-4 py-3">
                                <input
                                  value={vehicle.memo}
                                  onChange={(event) =>
                                    updateVehicleDraft(
                                      vehicle.clientId,
                                      "memo",
                                      event.target.value,
                                    )
                                  }
                                  className="h-10 w-full rounded-lg border border-slate-300 px-3 outline-none focus:border-blue-500"
                                />
                              </td>
                              <td className="px-4 py-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => removeVehicleDraft(vehicle.clientId)}
                                  className="h-9 rounded-lg border border-red-200 bg-white px-3 text-sm font-semibold text-red-600 transition hover:bg-red-50"
                                >
                                  削除
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!vehicleDrafts.length ? (
                        <div className="px-5 py-8 text-center text-sm text-slate-500">
                          登録車両はありません。
                        </div>
                      ) : null}
                    </div>
                  </section>
                </form>
              ) : (
                <div className="grid gap-8 p-6 sm:p-8">
                  <section className="grid gap-4">
                    <h3 className="text-base font-bold">顧客情報</h3>
                    <dl className="grid gap-4 text-sm md:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <dt className={readonlyLabelClassName}>氏名</dt>
                        <dd className={readonlyValueClassName}>
                          {customer.name || "未登録"}
                        </dd>
                      </div>
                      <div>
                        <dt className={readonlyLabelClassName}>ふりがな</dt>
                        <dd className={readonlyValueClassName}>
                          {customer.nameKana || "未登録"}
                        </dd>
                      </div>
                      <div>
                        <dt className={readonlyLabelClassName}>生年月日</dt>
                        <dd className={readonlyValueClassName}>
                          {customer.birthDate
                            ? formatDate(customer.birthDate)
                            : "未登録"}
                        </dd>
                      </div>
                      <div>
                        <dt className={readonlyLabelClassName}>年齢</dt>
                        <dd className={readonlyValueClassName}>
                          {getAgeFromBirthDate(customer.birthDate) !== null
                            ? `${getAgeFromBirthDate(customer.birthDate)}歳`
                            : "未登録"}
                        </dd>
                      </div>
                      <div>
                        <dt className={readonlyLabelClassName}>電話番号</dt>
                        <dd className={readonlyValueClassName}>
                          {customer.phone || "未登録"}
                        </dd>
                      </div>
                      <div>
                        <dt className={readonlyLabelClassName}>登録日</dt>
                        <dd className={readonlyValueClassName}>
                          {formatDate(customer.createdAt)}
                        </dd>
                      </div>
                      <div className="md:col-span-2 lg:col-span-4">
                        <dt className={readonlyLabelClassName}>顧客メモ</dt>
                        <dd className={readonlyValueClassName}>
                          {customer.memo || "未登録"}
                        </dd>
                      </div>
                    </dl>
                  </section>

                  <section className="grid gap-4 border-t border-slate-200 pt-6">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                      <h3 className="text-base font-bold">車両情報</h3>
                      <p className="text-sm font-semibold text-slate-500">
                        車両数：{customer.vehicles.length}台
                      </p>
                    </div>
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                        <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
                          <tr>
                            <th className="px-4 py-3">車名</th>
                            <th className="px-4 py-3">ナンバー</th>
                            <th className="px-4 py-3">車検満了日</th>
                            <th className="px-4 py-3">車両メモ</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {customer.vehicles.map((vehicle) => (
                            <tr key={vehicle.id}>
                              <td className="px-4 py-4 font-semibold text-slate-950">
                                {vehicle.modelName}
                              </td>
                              <td className="px-4 py-4 text-slate-700">
                                {vehicle.plateNumber || "未登録"}
                              </td>
                              <td className="px-4 py-4 font-semibold text-slate-950">
                                {vehicle.shakenExpiryDate
                                  ? formatDate(vehicle.shakenExpiryDate)
                                  : "未登録"}
                              </td>
                              <td className="px-4 py-4 text-slate-700">
                                {vehicle.memo || "メモなし"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!customer.vehicles.length ? (
                        <div className="px-5 py-8 text-center text-sm text-slate-500">
                          登録車両はありません。
                        </div>
                      ) : null}
                    </div>
                  </section>
                </div>
              )}
            </section>

            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
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
        ) : null}
      </main>
    </div>
  );
}
