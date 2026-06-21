"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

type LineMessageLogItem = {
  id: string;
  sentAt: string;
  deliveryType: "手動" | "セグメント" | "自動";
  targetType: string;
  title: string;
  body: string;
  imageUrl: string | null;
  status: "成功" | "失敗";
  errorMessage: string | null;
};

type CustomerDetailItem = {
  id: string;
  name: string;
  nameKana: string;
  phone: string;
  birthDate: string | null;
  gender: "男性" | "女性" | "未設定";
  lineStatus: string;
  lineDisplayName: string | null;
  linePictureUrl: string | null;
  lineLinkedAt: string | null;
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
  lineMessageLogs: LineMessageLogItem[];
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
  "mt-2 min-h-11 rounded-[5px] border border-[#E2E8F0] bg-white px-4 py-2.5 font-bold text-slate-950 shadow-sm";

const readonlyLabelClassName = "text-sm font-semibold text-slate-500";

const inputClassName =
  "h-11 rounded-[5px] border border-[#CBD5E1] bg-[#F3F6FA] px-3 text-base font-normal outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100";

const vehicleInputClassName =
  "h-10 min-w-0 w-full rounded-[5px] border border-[#CBD5E1] bg-[#F3F6FA] px-3 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100";

type CustomerDetailProps = {
  customerId: string;
  embedded?: boolean;
  onCustomerUpdated?: () => void;
};

export function CustomerDetail({
  customerId,
  embedded = false,
  onCustomerUpdated,
}: CustomerDetailProps) {
  const router = useRouter();
  const [customer, setCustomer] = useState<CustomerDetailItem | null>(null);
  const [vehicleDrafts, setVehicleDrafts] = useState<VehicleDraft[]>([]);
  const [loadState, setLoadState] = useState<LoadState>({
    status: "loading",
    message: "読み込み中です。",
  });
  const [updatingCustomer, setUpdatingCustomer] = useState(false);
  const [isEditingCustomer, setIsEditingCustomer] = useState(false);
  const [isConfirmingEdit, setIsConfirmingEdit] = useState(false);
  const [pendingVehicleDeleteId, setPendingVehicleDeleteId] = useState<
    string | null
  >(null);
  const [vehicleDeleteConfirmationStep, setVehicleDeleteConfirmationStep] =
    useState<1 | 2>(1);
  const [lineUnlinkConfirmationStep, setLineUnlinkConfirmationStep] =
    useState<0 | 1 | 2>(0);
  const [unlinkingLine, setUnlinkingLine] = useState(false);
  const [customerDeleteConfirmationStep, setCustomerDeleteConfirmationStep] =
    useState<0 | 1 | 2 | 3>(0);
  const [customerDeletePassword, setCustomerDeletePassword] = useState("");
  const [customerDeleteError, setCustomerDeleteError] = useState("");
  const [deletingCustomer, setDeletingCustomer] = useState(false);
  const [updateMessage, setUpdateMessage] = useState("");
  const [customerKanaError, setCustomerKanaError] = useState("");
  const [showAllReservations, setShowAllReservations] = useState(false);
  const [showAllLineMessageLogs, setShowAllLineMessageLogs] = useState(false);
  const [expandedLineMessageLogId, setExpandedLineMessageLogId] = useState<
    string | null
  >(null);

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
        gender: formData.get("gender"),
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
        gender: "男性" | "女性" | "未設定";
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
            gender: result.customer?.gender ?? current.gender,
            memo: result.customer?.memo ?? current.memo,
            vehicles: result.customer?.vehicles ?? current.vehicles,
          }
        : current,
    );
    setVehicleDrafts(toVehicleDrafts(result.customer.vehicles ?? []));
    setUpdateMessage("顧客情報を更新しました。");
    setIsEditingCustomer(false);
    setUpdatingCustomer(false);
    onCustomerUpdated?.();
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
    setPendingVehicleDeleteId(null);
    setVehicleDeleteConfirmationStep(1);
    setLineUnlinkConfirmationStep(0);
    setCustomerDeleteConfirmationStep(0);
    setCustomerDeletePassword("");
    setCustomerDeleteError("");
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
    setPendingVehicleDeleteId(clientId);
    setVehicleDeleteConfirmationStep(1);
  }

  function closeVehicleDeleteConfirmation() {
    setPendingVehicleDeleteId(null);
    setVehicleDeleteConfirmationStep(1);
  }

  function proceedVehicleDeleteConfirmation() {
    if (vehicleDeleteConfirmationStep === 1) {
      setVehicleDeleteConfirmationStep(2);
      return;
    }

    if (!pendingVehicleDeleteId) return;
    setVehicleDrafts((current) =>
      current.filter(
        (vehicle) => vehicle.clientId !== pendingVehicleDeleteId,
      ),
    );
    setPendingVehicleDeleteId(null);
    setVehicleDeleteConfirmationStep(1);
  }

  async function proceedLineUnlinkConfirmation() {
    if (lineUnlinkConfirmationStep === 1) {
      setLineUnlinkConfirmationStep(2);
      return;
    }

    if (lineUnlinkConfirmationStep !== 2 || unlinkingLine) return;

    setUnlinkingLine(true);
    setUpdateMessage("");

    const response = await fetch(`/api/admin/customers/${customerId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ unlinkLine: true }),
    });
    const result = (await response.json()) as {
      ok: boolean;
      customer?: {
        lineStatus: string;
        lineDisplayName: string | null;
        linePictureUrl: string | null;
        lineLinkedAt: string | null;
      };
      message?: string;
    };

    if (!response.ok || !result.ok || !result.customer) {
      setUpdateMessage(result.message ?? "LINE連携情報の削除に失敗しました。");
      setUnlinkingLine(false);
      return;
    }

    setCustomer((current) =>
      current
        ? {
            ...current,
            lineStatus: "未連携",
            lineDisplayName: null,
            linePictureUrl: null,
            lineLinkedAt: null,
          }
        : current,
    );
    setLineUnlinkConfirmationStep(0);
    setUnlinkingLine(false);
    setUpdateMessage("LINE連携情報を削除しました。");
    onCustomerUpdated?.();
  }

  function closeCustomerDeleteConfirmation() {
    if (deletingCustomer) return;
    setCustomerDeleteConfirmationStep(0);
    setCustomerDeletePassword("");
    setCustomerDeleteError("");
  }

  async function proceedCustomerDeleteConfirmation() {
    if (customerDeleteConfirmationStep === 1) {
      setCustomerDeleteConfirmationStep(2);
      return;
    }

    if (customerDeleteConfirmationStep === 2) {
      setCustomerDeleteConfirmationStep(3);
      setCustomerDeleteError("");
      return;
    }

    if (customerDeleteConfirmationStep !== 3 || deletingCustomer) return;

    if (!customerDeletePassword) {
      setCustomerDeleteError("管理者パスワードを入力してください。");
      return;
    }

    setDeletingCustomer(true);
    setCustomerDeleteError("");

    const response = await fetch(`/api/admin/customers/${customerId}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password: customerDeletePassword }),
    });
    const result = (await response.json()) as {
      ok: boolean;
      message?: string;
    };

    if (!response.ok || !result.ok) {
      setCustomerDeleteError(
        result.message ?? "顧客情報の削除に失敗しました。",
      );
      setDeletingCustomer(false);
      return;
    }

    setCustomerDeleteConfirmationStep(0);
    router.push("/admin/customers");
    router.refresh();
  }

  const content = (
    <>
      {!embedded ? (
      <AdminHeader title="顧客詳細" onRefresh={loadCustomer}>
        <Link
          href="/admin/customers"
          className="group inline-flex w-fit items-center gap-2 text-sm font-semibold text-blue-700 transition hover:text-blue-800"
        >
          <span
            aria-hidden="true"
            className="flex h-9 w-9 items-center justify-center rounded-[5px] border border-blue-100 bg-blue-50 text-lg leading-none text-blue-700 transition group-hover:border-blue-200 group-hover:bg-blue-100"
          >
            ←
          </span>
          顧客一覧に戻る
        </Link>
      </AdminHeader>
      ) : null}
      <main
        className={
          embedded
            ? "relative grid gap-5"
            : "relative mx-auto max-w-7xl px-5 py-6 sm:px-6 lg:px-8"
        }
      >
        {loadState.status === "loading" ? (
          <div className="pointer-events-none absolute right-0 top-0 z-10 rounded-[5px] border border-blue-100 bg-white/95 px-3 py-1.5 text-xs font-semibold text-blue-700 shadow-sm">
            読み込み中です。
          </div>
        ) : null}
        {loadState.status === "error" ? (
          <div
            className="mb-4 rounded-[5px] border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
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
                <div className="w-full max-w-md rounded-[5px] border border-slate-200 bg-white p-5 shadow-xl">
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
                      className="h-10 rounded-[5px] border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      いいえ
                    </button>
                    <button
                      type="button"
                      autoFocus
                      onClick={confirmCustomerEdit}
                      className="h-10 rounded-[5px] bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700"
                    >
                      はい
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {pendingVehicleDeleteId ? (
              <div
                className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-5"
                role="dialog"
                aria-modal="true"
                aria-labelledby="vehicle-delete-confirm-title"
                aria-describedby="vehicle-delete-confirm-description"
              >
                <div
                  key={vehicleDeleteConfirmationStep}
                  className="w-full max-w-sm rounded-[5px] border border-slate-200 bg-white p-6 shadow-xl"
                >
                  <h2
                    id="vehicle-delete-confirm-title"
                    className="text-lg font-bold text-slate-950"
                  >
                    {vehicleDeleteConfirmationStep === 1
                      ? "車両削除確認"
                      : "最終確認"}
                  </h2>
                  <p
                    id="vehicle-delete-confirm-description"
                    className="mt-3 text-sm text-slate-600"
                  >
                    {vehicleDeleteConfirmationStep === 1
                      ? "この車両を削除しますか？"
                      : (
                          <>
                            この操作は取り消しできません。
                            <br />
                            本当に削除しますか？
                          </>
                        )}
                  </p>
                  <div className="mt-6 grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      autoFocus={vehicleDeleteConfirmationStep === 2}
                      onClick={closeVehicleDeleteConfirmation}
                      className="h-11 cursor-pointer rounded-[5px] border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      {vehicleDeleteConfirmationStep === 1
                        ? "いいえ"
                        : "キャンセル"}
                    </button>
                    <button
                      type="button"
                      autoFocus={vehicleDeleteConfirmationStep === 1}
                      onClick={proceedVehicleDeleteConfirmation}
                      className="h-11 cursor-pointer rounded-[5px] bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-300 focus:ring-offset-2"
                    >
                      {vehicleDeleteConfirmationStep === 1
                        ? "はい"
                        : "削除する"}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {lineUnlinkConfirmationStep > 0 ? (
              <div
                className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-5"
                role="dialog"
                aria-modal="true"
                aria-labelledby="line-unlink-confirm-title"
                aria-describedby="line-unlink-confirm-description"
              >
                <div
                  key={lineUnlinkConfirmationStep}
                  className="w-full max-w-md rounded-[5px] border border-slate-200 bg-white p-6 shadow-xl"
                >
                  <h2
                    id="line-unlink-confirm-title"
                    className="text-lg font-bold text-slate-950"
                  >
                    {lineUnlinkConfirmationStep === 1
                      ? "LINE連携情報削除確認"
                      : "最終確認"}
                  </h2>
                  <p
                    id="line-unlink-confirm-description"
                    className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-600"
                  >
                    {lineUnlinkConfirmationStep === 1
                      ? "LINE連携情報を削除しますか？"
                      : "LINE連携情報を削除すると、この顧客へLINE配信ができなくなります。\n自動配信の対象からも除外されます。\n\n本当に削除しますか？"}
                  </p>
                  <div className="mt-6 grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      autoFocus
                      disabled={unlinkingLine}
                      onClick={() => setLineUnlinkConfirmationStep(0)}
                      className="h-11 cursor-pointer rounded-[5px] border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {lineUnlinkConfirmationStep === 1
                        ? "いいえ"
                        : "キャンセル"}
                    </button>
                    <button
                      type="button"
                      disabled={unlinkingLine}
                      onClick={() => void proceedLineUnlinkConfirmation()}
                      className="h-11 cursor-pointer rounded-[5px] bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {lineUnlinkConfirmationStep === 1
                        ? "はい"
                        : unlinkingLine
                          ? "削除中..."
                          : "削除する"}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {customerDeleteConfirmationStep > 0 ? (
              <div
                className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-5"
                role="dialog"
                aria-modal="true"
                aria-labelledby="customer-delete-confirm-title"
                aria-describedby="customer-delete-confirm-description"
              >
                <div
                  key={customerDeleteConfirmationStep}
                  className="w-full max-w-md rounded-[5px] border border-slate-200 bg-white p-6 shadow-xl"
                >
                  <h2
                    id="customer-delete-confirm-title"
                    className="text-lg font-bold text-slate-950"
                  >
                    {customerDeleteConfirmationStep === 1
                      ? "顧客情報を削除しますか？"
                      : customerDeleteConfirmationStep === 2
                        ? "最終確認"
                        : "管理者確認"}
                  </h2>
                  {customerDeleteConfirmationStep === 2 ? (
                    <div
                      id="customer-delete-confirm-description"
                      className="mt-3 text-sm leading-6 text-slate-600"
                    >
                      <p>この顧客を削除すると、以下の情報も削除されます。</p>
                      <ul className="mt-2">
                        <li>・顧客情報</li>
                        <li>・車両情報</li>
                        <li>・予約履歴</li>
                        <li>・LINE連携情報</li>
                        <li>・LINE配信履歴</li>
                      </ul>
                      <p className="mt-3 font-semibold text-red-700">
                        この操作は元に戻せません。
                      </p>
                      <p className="mt-3">本当に削除しますか？</p>
                    </div>
                  ) : customerDeleteConfirmationStep === 3 ? (
                    <div
                      id="customer-delete-confirm-description"
                      className="mt-3 grid gap-4 text-sm text-slate-600"
                    >
                      <p>
                        削除を実行するには管理者パスワードを入力してください。
                      </p>
                      <label className="grid gap-2 font-semibold text-slate-800">
                        管理者パスワード
                        <input
                          type="password"
                          autoComplete="current-password"
                          value={customerDeletePassword}
                          disabled={deletingCustomer}
                          onChange={(event) => {
                            setCustomerDeletePassword(event.target.value);
                            setCustomerDeleteError("");
                          }}
                          className="h-11 rounded-[5px] border border-slate-300 bg-white px-3 outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-100 disabled:bg-slate-100"
                        />
                      </label>
                      {customerDeleteError ? (
                        <p className="font-semibold text-red-700" role="alert">
                          {customerDeleteError}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <p
                      id="customer-delete-confirm-description"
                      className="sr-only"
                    >
                      顧客情報削除の確認です。
                    </p>
                  )}
                  <div className="mt-6 grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      autoFocus
                      disabled={deletingCustomer}
                      onClick={closeCustomerDeleteConfirmation}
                      className="h-11 rounded-[5px] border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {customerDeleteConfirmationStep === 1
                        ? "いいえ"
                        : "キャンセル"}
                    </button>
                    <button
                      type="button"
                      disabled={deletingCustomer}
                      onClick={() => void proceedCustomerDeleteConfirmation()}
                      className="h-11 rounded-[5px] bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
                    >
                      {customerDeleteConfirmationStep === 1
                        ? "はい"
                        : customerDeleteConfirmationStep === 2
                          ? "削除"
                          : deletingCustomer
                            ? "削除中..."
                            : "削除"}
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
                    ? "rounded-[5px] border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
                    : "rounded-[5px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700"
                }
              >
                {updateMessage}
              </div>
            ) : null}

            <section
              className={`overflow-hidden rounded-[5px] border border-slate-200 shadow-sm ${
                isEditingCustomer ? "bg-[#FAFBFC]" : "bg-white"
              }`}
            >
              <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
                <h2 className={embedded ? "text-2xl font-bold" : "text-lg font-bold"}>
                  {isEditingCustomer
                    ? "顧客情報編集中"
                    : embedded
                      ? `${customer.name} 様`
                      : "顧客詳細"}
                </h2>
                {isEditingCustomer ? (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={cancelCustomerEdit}
                      disabled={updatingCustomer}
                      className="h-10 rounded-[5px] border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      キャンセル
                    </button>
                    <button
                      type="submit"
                      form="customer-detail-form"
                      disabled={updatingCustomer || Boolean(customerKanaError)}
                      className="h-10 rounded-[5px] bg-blue-600 px-5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                    >
                      {updatingCustomer ? "保存中..." : "保存"}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={startCustomerEdit}
                    className="h-10 rounded-[5px] bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                  >
                    {embedded ? "編集" : "修正"}
                  </button>
                )}
              </div>

              {isEditingCustomer ? (
                <form
                  id="customer-detail-form"
                  key={`${customer.id}-${customer.name}-${customer.nameKana}-${customer.phone}-${customer.birthDate ?? ""}-${customer.gender}-${customer.memo}`}
                  onSubmit={(event) => void updateCustomer(event)}
                  className="grid gap-8 p-6 sm:p-8"
                >
                  <section className="grid gap-4 rounded-[5px] border border-slate-200 bg-slate-50 p-5">
                    <h3 className="text-base font-bold">顧客情報</h3>
                    <div className="grid gap-4 lg:grid-cols-6">
                      <label className="grid gap-2 text-sm font-medium text-slate-800 lg:col-span-3 lg:col-start-1 lg:row-start-1">
                        氏名
                        <input
                          required
                          name="name"
                          defaultValue={customer.name}
                          className={inputClassName}
                        />
                      </label>
                      <label className="grid gap-2 text-sm font-medium text-slate-800 lg:col-span-3 lg:col-start-4 lg:row-start-1">
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
                              ? "h-11 rounded-[5px] border border-red-400 bg-[#F3F6FA] px-3 text-base font-normal outline-none transition focus:border-red-500 focus:bg-white focus:ring-2 focus:ring-red-100"
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
                      <label className="grid gap-2 text-sm font-medium text-slate-800 lg:col-span-3 lg:col-start-1 lg:row-start-2">
                        電話番号
                        <input
                          required
                          name="phone"
                          inputMode="tel"
                          defaultValue={customer.phone}
                          className={inputClassName}
                        />
                      </label>
                      <label className="grid gap-2 text-sm font-medium text-slate-800 lg:col-span-3 lg:col-start-1 lg:row-start-3">
                        <span className="flex items-center justify-between gap-2">
                          生年月日
                          <span className="hidden text-xs font-semibold text-slate-500 lg:inline">
                            年齢：
                            {getAgeFromBirthDate(customer.birthDate) !== null
                              ? `${getAgeFromBirthDate(customer.birthDate)}歳`
                              : "未登録"}
                          </span>
                        </span>
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
                      <div className="grid gap-2 text-sm font-medium text-slate-800 lg:hidden">
                        年齢
                        <div className="flex h-11 items-center rounded-[5px] border border-[#CBD5E1] bg-[#F3F6FA] px-3 text-base font-semibold text-slate-500">
                          {getAgeFromBirthDate(customer.birthDate) !== null
                            ? `${getAgeFromBirthDate(customer.birthDate)}歳`
                            : "未登録"}
                        </div>
                      </div>
                      <label className="grid gap-2 text-sm font-medium text-slate-800 lg:col-span-3 lg:col-start-4 lg:row-start-2">
                        性別
                        <select
                          name="gender"
                          defaultValue={customer.gender ?? "未設定"}
                          className={inputClassName}
                        >
                          <option value="未設定">未設定</option>
                          <option value="男性">男性</option>
                          <option value="女性">女性</option>
                        </select>
                      </label>
                      <label className="grid gap-2 text-sm font-medium text-slate-800 lg:col-span-6 lg:row-start-4">
                        顧客メモ
                        <textarea
                          name="memo"
                          rows={4}
                          defaultValue={customer.memo}
                          className="min-h-28 rounded-[5px] border border-[#CBD5E1] bg-[#F3F6FA] px-3 py-2 text-base font-normal outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
                        />
                      </label>
                      <div className="grid gap-2 text-sm font-medium text-slate-800 lg:col-span-3 lg:col-start-4 lg:row-start-3">
                        登録日
                        <div className="flex h-11 items-center rounded-[5px] border border-[#CBD5E1] bg-[#F3F6FA] px-3 text-base font-semibold text-slate-500">
                          {formatDate(customer.createdAt)}
                        </div>
                      </div>
                      <div className="grid min-w-0 gap-3 lg:col-span-6 lg:row-start-5 sm:grid-cols-2 xl:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
                        <div className="grid min-w-0 gap-2 text-sm font-medium text-slate-800">
                          LINE連携状況
                          <div className="flex h-11 items-center rounded-[5px] border border-[#CBD5E1] bg-[#F3F6FA] px-3">
                            <span
                              className={`inline-flex rounded-[5px] px-3 py-1 text-xs font-bold ring-1 ${
                                customer.lineStatus === "連携済み"
                                  ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                                  : "bg-slate-100 text-slate-600 ring-slate-200"
                              }`}
                            >
                              {customer.lineStatus === "連携済み"
                                ? "連携済み"
                                : "未連携"}
                            </span>
                          </div>
                        </div>
                        <div className="grid min-w-0 gap-2 text-sm font-medium text-slate-800">
                          LINE表示名
                          <div className="flex h-11 items-center rounded-[5px] border border-[#CBD5E1] bg-[#F3F6FA] px-3 text-base font-semibold text-slate-500">
                            {customer.lineDisplayName || "未登録"}
                          </div>
                        </div>
                        <div className="grid min-w-0 gap-2 text-sm font-medium text-slate-800">
                          LINE連携日時
                          <div className="flex h-11 items-center rounded-[5px] border border-[#CBD5E1] bg-[#F3F6FA] px-3 text-base font-semibold text-slate-500">
                            {customer.lineLinkedAt
                              ? formatDateTime(customer.lineLinkedAt)
                              : "未連携"}
                          </div>
                        </div>
                        <div className="flex items-end sm:col-span-2 sm:justify-end xl:col-span-1">
                          <button
                            type="button"
                            disabled={customer.lineStatus !== "連携済み"}
                            onClick={() => setLineUnlinkConfirmationStep(1)}
                            className="h-10 w-full rounded-[5px] border border-red-200 bg-white px-3 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 sm:w-auto"
                          >
                            削除
                          </button>
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="grid gap-4 rounded-[5px] border border-slate-200 bg-slate-50 p-5">
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
                        className="h-10 rounded-[5px] border border-blue-200 bg-white px-4 text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
                      >
                        車両追加
                      </button>
                    </div>
                    <div className="grid gap-4">
                      {vehicleDrafts.map((vehicle, index) => (
                        <div
                          key={vehicle.clientId}
                          className="grid min-w-0 gap-3 border-t border-slate-200 pt-4 first:border-t-0 first:pt-0 sm:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto]"
                        >
                          <label className="grid min-w-0 gap-2 text-sm font-medium text-slate-800">
                            車名
                            <input
                              required
                              aria-label={`車両${index + 1}の車名`}
                              value={vehicle.modelName}
                              onChange={(event) =>
                                updateVehicleDraft(
                                  vehicle.clientId,
                                  "modelName",
                                  event.target.value,
                                )
                              }
                              className={vehicleInputClassName}
                            />
                          </label>
                          <label className="grid min-w-0 gap-2 text-sm font-medium text-slate-800">
                            ナンバー
                            <input
                              aria-label={`車両${index + 1}のナンバー`}
                              value={vehicle.plateNumber}
                              onChange={(event) =>
                                updateVehicleDraft(
                                  vehicle.clientId,
                                  "plateNumber",
                                  event.target.value,
                                )
                              }
                              className={vehicleInputClassName}
                            />
                          </label>
                          <label className="grid min-w-0 gap-2 text-sm font-medium text-slate-800">
                            車検満了日
                            <input
                              type="date"
                              aria-label={`車両${index + 1}の車検満了日`}
                              value={vehicle.shakenExpiryDate ?? ""}
                              onChange={(event) =>
                                updateVehicleDraft(
                                  vehicle.clientId,
                                  "shakenExpiryDate",
                                  event.target.value,
                                )
                              }
                              className={vehicleInputClassName}
                            />
                          </label>
                          <label className="grid min-w-0 gap-2 text-sm font-medium text-slate-800">
                            車両メモ
                            <input
                              aria-label={`車両${index + 1}の車両メモ`}
                              value={vehicle.memo}
                              onChange={(event) =>
                                updateVehicleDraft(
                                  vehicle.clientId,
                                  "memo",
                                  event.target.value,
                                )
                              }
                              className={vehicleInputClassName}
                            />
                          </label>
                          <div className="flex items-end sm:col-span-2 sm:justify-end xl:col-span-1">
                            <button
                              type="button"
                              onClick={() =>
                                removeVehicleDraft(vehicle.clientId)
                              }
                              className="h-10 w-full rounded-[5px] border border-red-200 bg-white px-3 text-sm font-semibold text-red-600 transition hover:bg-red-50 sm:w-auto"
                            >
                              削除
                            </button>
                          </div>
                        </div>
                      ))}
                      {!vehicleDrafts.length ? (
                        <div className="py-8 text-center text-sm text-slate-500">
                          登録車両はありません。
                        </div>
                      ) : null}
                    </div>
                  </section>

                  <section className="grid gap-4 rounded-[5px] border border-red-200 bg-red-50 p-5">
                    <div>
                      <h3 className="text-base font-bold text-red-900">
                        危険操作
                      </h3>
                      <p className="mt-1 text-sm text-red-700">
                        顧客とすべての関連情報を完全に削除します。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCustomerDeleteConfirmationStep(1)}
                      className="h-10 w-full rounded-[5px] border border-red-200 bg-white px-4 text-sm font-semibold text-red-600 transition hover:bg-red-100 sm:w-fit"
                    >
                      顧客を削除
                    </button>
                  </section>
                </form>
              ) : (
                <div className="grid gap-8 p-6 sm:p-8">
                  <section className="grid gap-4 rounded-[5px] border border-slate-200 bg-slate-50 p-5">
                    <h3 className="text-base font-bold">顧客情報</h3>
                    <dl className="grid gap-4 text-sm lg:grid-cols-6">
                      <div className="lg:col-span-3 lg:col-start-1 lg:row-start-1">
                        <dt className={readonlyLabelClassName}>氏名</dt>
                        <dd className={readonlyValueClassName}>
                          {customer.name || "未登録"}
                        </dd>
                      </div>
                      <div className="lg:col-span-3 lg:col-start-4 lg:row-start-1">
                        <dt className={readonlyLabelClassName}>ふりがな</dt>
                        <dd className={readonlyValueClassName}>
                          {customer.nameKana || "未登録"}
                        </dd>
                      </div>
                      <div className="lg:col-span-3 lg:col-start-1 lg:row-start-2">
                        <dt className={readonlyLabelClassName}>電話番号</dt>
                        <dd className={readonlyValueClassName}>
                          {customer.phone || "未登録"}
                        </dd>
                      </div>
                      <div className="lg:col-span-3 lg:col-start-1 lg:row-start-3">
                        <dt className={readonlyLabelClassName}>生年月日</dt>
                        <dd className={readonlyValueClassName}>
                          {customer.birthDate ? (
                            <>
                              {formatDate(customer.birthDate)}
                              {getAgeFromBirthDate(customer.birthDate) !== null ? (
                                <span className="hidden lg:inline">
                                  {`（${getAgeFromBirthDate(customer.birthDate)}歳）`}
                                </span>
                              ) : null}
                            </>
                          ) : (
                            "未登録"
                          )}
                        </dd>
                      </div>
                      <div className="lg:hidden">
                        <dt className={readonlyLabelClassName}>年齢</dt>
                        <dd className={readonlyValueClassName}>
                          {getAgeFromBirthDate(customer.birthDate) !== null
                            ? `${getAgeFromBirthDate(customer.birthDate)}歳`
                            : "未登録"}
                        </dd>
                      </div>
                      <div className="lg:col-span-3 lg:col-start-4 lg:row-start-2">
                        <dt className={readonlyLabelClassName}>性別</dt>
                        <dd className={readonlyValueClassName}>
                          {customer.gender || "未設定"}
                        </dd>
                      </div>
                      <div className="lg:col-span-2 lg:col-start-1 lg:row-start-5">
                        <dt className={readonlyLabelClassName}>LINE連携状況</dt>
                        <dd className={`${readonlyValueClassName} flex items-center`}>
                          <span
                            className={`inline-flex rounded-[5px] px-3 py-1 text-xs font-bold ring-1 ${
                              customer.lineStatus === "連携済み"
                                ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                                : "bg-slate-100 text-slate-600 ring-slate-200"
                            }`}
                          >
                            {customer.lineStatus === "連携済み"
                              ? "連携済み"
                              : "未連携"}
                          </span>
                        </dd>
                      </div>
                      <div className="lg:col-span-6 lg:row-start-4">
                        <dt className={readonlyLabelClassName}>顧客メモ</dt>
                        <dd
                          className={`${readonlyValueClassName} min-h-28 whitespace-pre-wrap`}
                        >
                          {customer.memo || "未登録"}
                        </dd>
                      </div>
                      <div className="lg:col-span-3 lg:col-start-4 lg:row-start-3">
                        <dt className={readonlyLabelClassName}>登録日</dt>
                        <dd className={readonlyValueClassName}>
                          {formatDate(customer.createdAt)}
                        </dd>
                      </div>
                      <div className="lg:col-span-2 lg:col-start-3 lg:row-start-5">
                        <dt className={readonlyLabelClassName}>LINE表示名</dt>
                        <dd className={readonlyValueClassName}>
                          {customer.lineDisplayName || "未登録"}
                        </dd>
                      </div>
                      <div className="lg:col-span-2 lg:col-start-5 lg:row-start-5">
                        <dt className={readonlyLabelClassName}>LINE連携日時</dt>
                        <dd className={readonlyValueClassName}>
                          {customer.lineLinkedAt
                            ? formatDateTime(customer.lineLinkedAt)
                            : "未連携"}
                        </dd>
                      </div>
                    </dl>
                  </section>

                  <section className="grid gap-4 rounded-[5px] border border-slate-200 bg-slate-50 p-5">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                      <h3 className="text-base font-bold">車両情報</h3>
                      <p className="text-sm font-semibold text-slate-500">
                        車両数：{customer.vehicles.length}台
                      </p>
                    </div>
                    <div className="grid gap-4">
                      {customer.vehicles.map((vehicle) => (
                        <div
                          key={vehicle.id}
                          className="border-t border-slate-200 pt-4 first:border-t-0 first:pt-0"
                        >
                          <dl className="grid gap-4 text-sm md:grid-cols-2 lg:grid-cols-4">
                            <div>
                              <dt className={readonlyLabelClassName}>車名</dt>
                              <dd className={readonlyValueClassName}>
                                {vehicle.modelName || "未登録"}
                              </dd>
                            </div>
                            <div>
                              <dt className={readonlyLabelClassName}>ナンバー</dt>
                              <dd className={readonlyValueClassName}>
                                {vehicle.plateNumber || "未登録"}
                              </dd>
                            </div>
                            <div>
                              <dt className={readonlyLabelClassName}>車検満了日</dt>
                              <dd className={readonlyValueClassName}>
                                {vehicle.shakenExpiryDate
                                  ? formatDate(vehicle.shakenExpiryDate)
                                  : "未登録"}
                              </dd>
                            </div>
                            <div>
                              <dt className={readonlyLabelClassName}>車両メモ</dt>
                              <dd className={readonlyValueClassName}>
                                {vehicle.memo || "メモなし"}
                              </dd>
                            </div>
                          </dl>
                        </div>
                      ))}
                      {!customer.vehicles.length ? (
                        <div className="rounded-[5px] border border-slate-200 bg-slate-50 px-5 py-8 text-center text-sm text-slate-500">
                          登録車両はありません。
                        </div>
                      ) : null}
                    </div>
                  </section>
                </div>
              )}
            </section>

            {!isEditingCustomer ? (
              <>
                <section className="overflow-hidden rounded-[5px] border border-slate-200 bg-white shadow-sm">
                  <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
                    <h2 className="text-base font-semibold">予約履歴</h2>
                    <button
                      type="button"
                      disabled={customer.reservations.length <= 1}
                      aria-expanded={showAllReservations}
                      onClick={() =>
                        setShowAllReservations((current) => !current)
                      }
                      className="cursor-pointer text-sm font-semibold text-blue-700 transition hover:text-blue-900 disabled:cursor-default disabled:text-slate-400"
                    >
                      {showAllReservations ? "折りたたむ" : "すべて見る"}
                    </button>
                  </div>
                  <div className="grid gap-4 p-6 sm:p-8">
                    {(showAllReservations
                      ? customer.reservations
                      : customer.reservations.slice(0, 1)
                    ).map((reservation) => (
                      <div
                        key={reservation.id}
                        className="border-t border-slate-200 pt-4 first:border-t-0 first:pt-0"
                      >
                        <dl className="grid gap-4 text-sm md:grid-cols-2 lg:grid-cols-4">
                          <div>
                            <dt className={readonlyLabelClassName}>予約日時</dt>
                            <dd className={readonlyValueClassName}>
                              {formatDateTime(reservation.reservedAt)}
                            </dd>
                          </div>
                          <div>
                            <dt className={readonlyLabelClassName}>メニュー</dt>
                            <dd className={readonlyValueClassName}>車検</dd>
                          </div>
                          <div>
                            <dt className={readonlyLabelClassName}>
                              ステータス
                            </dt>
                            <dd className={readonlyValueClassName}>
                              <span
                                className={`inline-flex rounded-[5px] px-2.5 py-1 text-xs font-semibold ring-1 ${statusClassName(
                                  reservation.status,
                                )}`}
                              >
                                {reservation.status}
                              </span>
                            </dd>
                          </div>
                          <div>
                            <dt className={readonlyLabelClassName}>登録日</dt>
                            <dd className={readonlyValueClassName}>
                              {formatDate(reservation.createdAt)}
                            </dd>
                          </div>
                        </dl>
                      </div>
                    ))}
                    {!customer.reservations.length ? (
                      <div className="rounded-[5px] border border-slate-200 bg-slate-50 px-5 py-12 text-center text-sm text-slate-500">
                        予約履歴はありません。
                      </div>
                    ) : null}
                  </div>
                </section>

                <section className="overflow-hidden rounded-[5px] border border-slate-200 bg-white shadow-sm">
                  <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
                    <h2 className="text-base font-semibold">LINE配信履歴</h2>
                    <button
                      type="button"
                      disabled={customer.lineMessageLogs.length <= 1}
                      aria-expanded={showAllLineMessageLogs}
                      onClick={() =>
                        setShowAllLineMessageLogs((current) => !current)
                      }
                      className="cursor-pointer text-sm font-semibold text-blue-700 transition hover:text-blue-900 disabled:cursor-default disabled:text-slate-400"
                    >
                      {showAllLineMessageLogs ? "折りたたむ" : "すべて見る"}
                    </button>
                  </div>
                  <div className="grid gap-3 p-6 sm:p-8">
                    {(showAllLineMessageLogs
                      ? customer.lineMessageLogs
                      : customer.lineMessageLogs.slice(0, 1)
                    ).map((log) => {
                      const expanded = expandedLineMessageLogId === log.id;

                      return (
                        <div
                          key={log.id}
                          className="overflow-hidden rounded-[5px] border border-slate-200"
                        >
                          <button
                            type="button"
                            aria-expanded={expanded}
                            onClick={() =>
                              setExpandedLineMessageLogId((current) =>
                                current === log.id ? null : log.id,
                              )
                            }
                            className="grid w-full cursor-pointer gap-4 bg-white p-4 text-left transition hover:bg-slate-50 md:grid-cols-[180px_minmax(0,1fr)_auto] md:items-center"
                          >
                            <div>
                              <p className={readonlyLabelClassName}>送信日時</p>
                              <p className="mt-1 text-sm font-semibold text-slate-900">
                                {formatDateTime(log.sentAt)}
                              </p>
                            </div>
                            <div className="min-w-0">
                              <p className={readonlyLabelClassName}>タイトル</p>
                              <p className="mt-1 truncate text-sm font-semibold text-slate-900">
                                {log.title}
                              </p>
                              {log.imageUrl ? (
                                <span className="mt-2 inline-flex rounded-[5px] bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                                  画像あり
                                </span>
                              ) : null}
                            </div>
                            <span
                              className={
                                log.status === "成功"
                                  ? "w-fit rounded-[5px] bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200"
                                  : "w-fit rounded-[5px] bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700 ring-1 ring-red-200"
                              }
                            >
                              {log.status}
                            </span>
                          </button>
                          {expanded ? (
                            <dl className="grid gap-4 border-t border-slate-200 bg-slate-50 p-4 text-sm md:grid-cols-2">
                              <div>
                                <dt className={readonlyLabelClassName}>
                                  送信日時
                                </dt>
                                <dd className="mt-1 font-semibold">
                                  {formatDateTime(log.sentAt)}
                                </dd>
                              </div>
                              <div>
                                <dt className={readonlyLabelClassName}>
                                  配信種別
                                </dt>
                                <dd className="mt-1 font-semibold">
                                  {log.deliveryType}
                                </dd>
                              </div>
                              <div className="md:col-span-2">
                                <dt className={readonlyLabelClassName}>
                                  タイトル
                                </dt>
                                <dd className="mt-1 font-semibold">
                                  {log.title}
                                </dd>
                              </div>
                              <div className="md:col-span-2">
                                <dt className={readonlyLabelClassName}>本文</dt>
                                <dd className="mt-1 whitespace-pre-wrap font-medium text-slate-800">
                                  {log.body || "本文なし"}
                                </dd>
                              </div>
                              {log.imageUrl ? (
                                <div className="min-w-0 md:col-span-2">
                                  <dt className={readonlyLabelClassName}>
                                    画像URL
                                  </dt>
                                  <dd className="mt-1 break-all">
                                    <a
                                      href={log.imageUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="font-semibold text-blue-700 hover:text-blue-900"
                                    >
                                      {log.imageUrl}
                                    </a>
                                  </dd>
                                </div>
                              ) : null}
                              <div>
                                <dt className={readonlyLabelClassName}>
                                  送信結果
                                </dt>
                                <dd className="mt-1 font-semibold">
                                  {log.status}
                                </dd>
                              </div>
                              {log.errorMessage ? (
                                <div className="md:col-span-2">
                                  <dt className={readonlyLabelClassName}>
                                    エラーメッセージ
                                  </dt>
                                  <dd className="mt-1 whitespace-pre-wrap font-semibold text-red-700">
                                    {log.errorMessage}
                                  </dd>
                                </div>
                              ) : null}
                            </dl>
                          ) : null}
                        </div>
                      );
                    })}
                    {!customer.lineMessageLogs.length ? (
                      <div className="rounded-[5px] border border-slate-200 bg-slate-50 px-5 py-12 text-center text-sm text-slate-500">
                        LINE配信履歴はありません。
                      </div>
                    ) : null}
                  </div>
                </section>
              </>
            ) : null}
          </div>
        ) : null}
      </main>
    </>
  );

  if (embedded) {
    return content;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      {content}
    </div>
  );
}
