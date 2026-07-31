"use client";

import { FormEvent, useRef, useState } from "react";
import {
  loanerCategories,
  loanerCategoryLabels,
  type LoanerCategory,
  type LoanerVehicle,
} from "@/lib/loaners/loaner-vehicle";

type LoanerVehicleModalProps = {
  item: LoanerVehicle | null;
  suggestedSortOrder: number;
  onClose: () => void;
  onSaved: (message: string) => void | Promise<void>;
};

const inputClassName =
  "mt-1.5 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

export function LoanerVehicleModal({
  item,
  suggestedSortOrder,
  onClose,
  onSaved,
}: LoanerVehicleModalProps) {
  const [vehicleName, setVehicleName] = useState(item?.vehicleName ?? "");
  const [displayName, setDisplayName] = useState(item?.displayName ?? "");
  const [plateNumber, setPlateNumber] = useState(item?.plateNumber ?? "");
  const [category, setCategory] = useState<LoanerCategory>(
    item?.category ?? "owned",
  );
  const [isActive, setIsActive] = useState(item?.isActive ?? true);
  const [sortOrder, setSortOrder] = useState(
    String(item?.sortOrder ?? suggestedSortOrder),
  );
  const [memo, setMemo] = useState(item?.memo ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const submitButtonRef = useRef<HTMLButtonElement>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError("");
    const response = await fetch(
      item ? `/api/admin/loaners/${item.id}` : "/api/admin/loaners",
      {
        method: item ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicleName,
          displayName,
          plateNumber,
          category,
          isActive,
          sortOrder,
          memo,
        }),
      },
    );
    const result = (await response.json()) as {
      ok: boolean;
      message?: string;
    };

    if (!response.ok || !result.ok) {
      setError(result.message ?? "代車の保存に失敗しました。");
      setSubmitting(false);
      return;
    }

    await onSaved(item ? "代車情報を更新しました。" : "代車を追加しました。");
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="loaner-modal-title"
    >
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-md border border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
          <div>
            <h2 id="loaner-modal-title" className="text-xl font-bold">
              {item ? "代車を編集" : "代車を追加"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              車両の基本情報と管理画面での表示内容を設定します。
            </p>
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="h-9 cursor-pointer rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            閉じる
          </button>
        </div>

        <form
          className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6"
          onSubmit={handleSubmit}
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
              event.preventDefault();
              submitButtonRef.current?.focus();
            }
          }}
        >
          {error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 sm:col-span-2">
              {error}
            </p>
          ) : null}

          <label className="text-sm font-semibold text-slate-700">
            車種 <span className="text-red-600">（必須）</span>
            <input
              value={vehicleName}
              onChange={(event) => setVehicleName(event.target.value)}
              className={inputClassName}
              autoFocus
              maxLength={100}
            />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            表示名 <span className="text-red-600">（必須）</span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className={inputClassName}
              maxLength={100}
            />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            ナンバー <span className="text-red-600">（必須）</span>
            <input
              value={plateNumber}
              onChange={(event) => setPlateNumber(event.target.value)}
              className={inputClassName}
              maxLength={50}
            />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            分類 <span className="text-red-600">（必須）</span>
            <select
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as LoanerCategory)
              }
              className={inputClassName}
            >
              {loanerCategories.map((value) => (
                <option key={value} value={value}>
                  {loanerCategoryLabels[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold text-slate-700">
            状態
            <select
              value={isActive ? "active" : "inactive"}
              onChange={(event) => setIsActive(event.target.value === "active")}
              className={inputClassName}
            >
              <option value="active">使用可能</option>
              <option value="inactive">使用停止</option>
            </select>
          </label>
          <label className="text-sm font-semibold text-slate-700">
            表示順
            <input
              type="number"
              min={0}
              max={99999}
              step={1}
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value)}
              className={inputClassName}
            />
          </label>
          <label className="text-sm font-semibold text-slate-700 sm:col-span-2">
            メモ <span className="text-slate-400">（任意）</span>
            <textarea
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
              className="mt-1.5 min-h-28 w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              maxLength={1000}
            />
          </label>

          <div className="flex justify-end gap-3 border-t border-slate-200 pt-5 sm:col-span-2">
            <button
              type="button"
              disabled={submitting}
              onClick={onClose}
              className="h-11 cursor-pointer rounded-md border border-slate-300 px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              キャンセル
            </button>
            <button
              ref={submitButtonRef}
              type="submit"
              disabled={submitting}
              className="h-11 cursor-pointer rounded-md bg-blue-600 px-6 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              {submitting ? "保存中..." : "保存する"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
