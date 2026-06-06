"use client";

import { FormEvent, useEffect, useState } from "react";
import { weekdayLabels } from "@/lib/holidays/holidays";
import { AdminHeader } from "../../admin-header";

type HolidayItem = {
  id: string;
  type: "single" | "weekly";
  date: string | null;
  weekday: number | null;
  label: string | null;
  createdAt: string;
};

type LoadState =
  | { status: "loading"; message: "読み込み中です。" }
  | { status: "ready"; message: "" }
  | { status: "error"; message: string };

const formatHoliday = (holiday: HolidayItem) => {
  if (holiday.type === "single") {
    return holiday.date ?? "";
  }

  return `毎週${weekdayLabels[holiday.weekday ?? 0]}曜日`;
};

export function HolidaysSettings() {
  const [items, setItems] = useState<HolidayItem[]>([]);
  const [loadState, setLoadState] = useState<LoadState>({
    status: "loading",
    message: "読み込み中です。",
  });
  const [type, setType] = useState<"single" | "weekly">("single");
  const [submitting, setSubmitting] = useState(false);

  async function loadHolidays() {
    setLoadState({ status: "loading", message: "読み込み中です。" });

    const response = await fetch("/api/admin/holidays", { cache: "no-store" });
    const result = (await response.json()) as {
      ok: boolean;
      items?: HolidayItem[];
      message?: string;
    };

    if (!response.ok || !result.ok || !result.items) {
      setLoadState({
        status: "error",
        message: result.message ?? "休業日の取得に失敗しました。",
      });
      return;
    }

    setItems(result.items);
    setLoadState({ status: "ready", message: "" });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/admin/holidays", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type,
        date: formData.get("date"),
        weekday: formData.get("weekday"),
        label: formData.get("label"),
      }),
    });
    const result = (await response.json()) as {
      ok: boolean;
      message?: string;
    };

    if (!response.ok || !result.ok) {
      setLoadState({
        status: "error",
        message: result.message ?? "休業日の追加に失敗しました。",
      });
      setSubmitting(false);
      return;
    }

    event.currentTarget.reset();
    setSubmitting(false);
    await loadHolidays();
  }

  async function deleteHoliday(id: string) {
    const response = await fetch(`/api/admin/holidays?id=${id}`, {
      method: "DELETE",
    });
    const result = (await response.json()) as {
      ok: boolean;
      message?: string;
    };

    if (!response.ok || !result.ok) {
      setLoadState({
        status: "error",
        message: result.message ?? "休業日の削除に失敗しました。",
      });
      return;
    }

    setItems((current) => current.filter((item) => item.id !== id));
  }

  useEffect(() => {
    void loadHolidays();
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <AdminHeader
        title="定休日管理"
        description="単発の休業日と毎週の定休日を設定できます。"
        onRefresh={loadHolidays}
      />
      <main className="mx-auto grid max-w-7xl gap-5 px-5 py-6 sm:px-6 lg:px-8">
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
        <form
          onSubmit={handleSubmit}
          className="grid gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-sm font-medium text-slate-800">
              種類
              <select
                value={type}
                onChange={(event) =>
                  setType(event.target.value as "single" | "weekly")
                }
                className="h-11 rounded-md border border-slate-300 bg-white px-3 text-base font-normal outline-none focus:border-blue-600"
              >
                <option value="single">単発休業日</option>
                <option value="weekly">毎週定休日</option>
              </select>
            </label>
            {type === "single" ? (
              <label className="grid gap-2 text-sm font-medium text-slate-800">
                日付
                <input
                  required
                  name="date"
                  type="date"
                  className="h-11 rounded-md border border-slate-300 px-3 text-base font-normal outline-none focus:border-blue-600"
                />
              </label>
            ) : (
              <label className="grid gap-2 text-sm font-medium text-slate-800">
                曜日
                <select
                  required
                  name="weekday"
                  className="h-11 rounded-md border border-slate-300 bg-white px-3 text-base font-normal outline-none focus:border-blue-600"
                >
                  {weekdayLabels.map((label, index) => (
                    <option key={label} value={index}>
                      {label}曜日
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <label className="grid gap-2 text-sm font-medium text-slate-800">
            メモ
            <input
              name="label"
              placeholder="例: 年末年始、社内研修"
              className="h-11 rounded-md border border-slate-300 px-3 text-base font-normal outline-none focus:border-blue-600"
            />
          </label>
          <button
            type="submit"
            disabled={submitting}
            className="h-11 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            休業日を追加
          </button>
        </form>
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-base font-semibold">設定済み休業日</h2>
          </div>
          <div className="grid divide-y divide-slate-100">
            {items.length ? (
              items.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-semibold text-slate-950">
                      {formatHoliday(item)}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      {item.label || "メモなし"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void deleteHoliday(item.id)}
                    className="h-9 rounded-md border border-red-200 bg-white px-3 text-sm font-semibold text-red-700 hover:bg-red-50"
                  >
                    削除
                  </button>
                </div>
              ))
            ) : (
              <p className="px-5 py-8 text-center text-sm text-slate-500">
                休業日はまだ設定されていません。
              </p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
