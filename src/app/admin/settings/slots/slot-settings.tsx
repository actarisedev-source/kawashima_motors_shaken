"use client";

import { FormEvent, useEffect, useState } from "react";
import { weekdayLabels } from "@/lib/holidays/holidays";
import { reservationTimeSlots } from "@/lib/reservations/slots";
import { AdminHeader } from "../../admin-header";

type WeeklySettings = Record<string, Record<string, number>>;

type SpecialSettings = {
  date: string;
  capacities: Record<string, number>;
};

type LoadState =
  | { status: "loading"; message: "読み込み中です。" }
  | { status: "ready"; message: "" }
  | { status: "error"; message: string };

const createDefaultDay = () =>
  Object.fromEntries(reservationTimeSlots.map((time) => [time, 1]));

const createDefaultWeekly = () =>
  Object.fromEntries(
    Array.from({ length: 7 }, (_, weekday) => [String(weekday), createDefaultDay()]),
  ) as WeeklySettings;

const createSpecialCapacities = () => createDefaultDay();
const allWeekdays = Array.from({ length: 7 }, (_, weekday) => weekday);
const allTimeSlots = [...reservationTimeSlots];

export function SlotSettings() {
  const [weekly, setWeekly] = useState<WeeklySettings>(createDefaultWeekly);
  const [specialItems, setSpecialItems] = useState<SpecialSettings[]>([]);
  const [specialDate, setSpecialDate] = useState("");
  const [specialCapacities, setSpecialCapacities] = useState<Record<string, number>>(
    createSpecialCapacities,
  );
  const [loadState, setLoadState] = useState<LoadState>({
    status: "loading",
    message: "読み込み中です。",
  });
  const [submitting, setSubmitting] = useState(false);
  const [showBulkSettings, setShowBulkSettings] = useState(false);
  const [bulkWeekdays, setBulkWeekdays] = useState<number[]>(allWeekdays);
  const [bulkTimeSlots, setBulkTimeSlots] = useState<string[]>(allTimeSlots);
  const [bulkCapacity, setBulkCapacity] = useState(1);

  function openBulkSettings() {
    setBulkWeekdays(allWeekdays);
    setBulkTimeSlots(allTimeSlots);
    setBulkCapacity(1);
    setShowBulkSettings(true);
  }

  function toggleBulkWeekday(weekday: number) {
    setBulkWeekdays((current) =>
      current.includes(weekday)
        ? current.filter((value) => value !== weekday)
        : [...current, weekday],
    );
  }

  function toggleBulkTimeSlot(time: string) {
    setBulkTimeSlots((current) =>
      current.includes(time)
        ? current.filter((value) => value !== time)
        : [...current, time],
    );
  }

  function applyBulkSettings() {
    if (
      !bulkWeekdays.length ||
      !bulkTimeSlots.length ||
      !Number.isInteger(bulkCapacity) ||
      bulkCapacity < 0 ||
      bulkCapacity > 10
    ) {
      return;
    }

    setWeekly((current) => {
      const next = { ...current };

      for (const weekday of bulkWeekdays) {
        const weekdayKey = String(weekday);
        const nextDay = {
          ...(current[weekdayKey] ?? createDefaultDay()),
        };

        for (const time of bulkTimeSlots) {
          nextDay[time] = bulkCapacity;
        }

        next[weekdayKey] = nextDay;
      }

      return next;
    });
    setShowBulkSettings(false);
  }

  async function loadSlots() {
    setLoadState({ status: "loading", message: "読み込み中です。" });

    const response = await fetch("/api/admin/slots", { cache: "no-store" });
    const result = (await response.json()) as {
      ok: boolean;
      weekly?: WeeklySettings;
      special?: SpecialSettings[];
      message?: string;
    };

    if (!response.ok || !result.ok || !result.weekly || !result.special) {
      setLoadState({
        status: "error",
        message: result.message ?? "予約枠設定の取得に失敗しました。",
      });
      return;
    }

    setWeekly(result.weekly);
    setSpecialItems(result.special);
    setLoadState({ status: "ready", message: "" });
  }

  async function saveWeekly() {
    setSubmitting(true);

    const response = await fetch("/api/admin/slots", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ weekly }),
    });
    const result = (await response.json()) as { ok: boolean; message?: string };

    if (!response.ok || !result.ok) {
      setLoadState({
        status: "error",
        message: result.message ?? "曜日別枠設定の保存に失敗しました。",
      });
      setSubmitting(false);
      return;
    }

    setLoadState({ status: "ready", message: "" });
    setSubmitting(false);
    await loadSlots();
  }

  async function saveSpecial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);

    const response = await fetch("/api/admin/slots", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        special: {
          date: specialDate,
          capacities: specialCapacities,
        },
      }),
    });
    const result = (await response.json()) as { ok: boolean; message?: string };

    if (!response.ok || !result.ok) {
      setLoadState({
        status: "error",
        message: result.message ?? "特定日枠設定の保存に失敗しました。",
      });
      setSubmitting(false);
      return;
    }

    setSpecialDate("");
    setSpecialCapacities(createSpecialCapacities());
    setSubmitting(false);
    await loadSlots();
  }

  async function deleteSpecial(date: string) {
    const response = await fetch(`/api/admin/slots?date=${date}`, {
      method: "DELETE",
    });
    const result = (await response.json()) as { ok: boolean; message?: string };

    if (!response.ok || !result.ok) {
      setLoadState({
        status: "error",
        message: result.message ?? "特定日枠設定の削除に失敗しました。",
      });
      return;
    }

    setSpecialItems((current) => current.filter((item) => item.date !== date));
  }

  useEffect(() => {
    void loadSlots();
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <AdminHeader
        title="予約枠管理"
        description="曜日別の基本枠と、特定日の上書き枠を設定できます。"
        onRefresh={loadSlots}
      />
      <main className="mx-auto grid max-w-7xl gap-6 px-5 py-6 sm:px-6 lg:px-8">
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

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div>
              <h2 className="text-base font-semibold">曜日別基本枠</h2>
              <p className="mt-1 text-sm text-slate-500">
                0台は受付停止です。各時間帯は0〜10台で設定できます。
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                disabled={submitting}
                onClick={openBulkSettings}
                className="h-10 rounded-md border border-blue-200 bg-white px-4 text-sm font-semibold text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                一括設定
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void saveWeekly()}
                className="h-10 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                基本枠を保存
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">曜日</th>
                  {reservationTimeSlots.map((time) => (
                    <th key={time} className="px-4 py-3">
                      {time}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {weekdayLabels.map((label, weekday) => (
                  <tr key={label}>
                    <td className="px-4 py-3 font-semibold text-slate-950">
                      {label}曜日
                    </td>
                    {reservationTimeSlots.map((time) => (
                      <td key={time} className="px-4 py-3">
                        <input
                          type="number"
                          min={0}
                          max={10}
                          value={weekly[String(weekday)]?.[time] ?? 1}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            setWeekly((current) => ({
                              ...current,
                              [weekday]: {
                                ...(current[String(weekday)] ?? createDefaultDay()),
                                [time]: Number.isNaN(value) ? 0 : value,
                              },
                            }));
                          }}
                          className="h-10 w-20 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-600"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[420px_1fr]">
          <form
            onSubmit={saveSpecial}
            className="grid gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div>
              <h2 className="text-base font-semibold">特定日上書き</h2>
              <p className="mt-1 text-sm text-slate-500">
                設定した日は曜日別基本枠より優先されます。
              </p>
            </div>
            <label className="grid gap-2 text-sm font-semibold text-slate-700">
              日付
              <input
                required
                type="date"
                value={specialDate}
                onChange={(event) => setSpecialDate(event.target.value)}
                className="h-11 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-600"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              {reservationTimeSlots.map((time) => (
                <label
                  key={time}
                  className="grid gap-2 text-sm font-semibold text-slate-700"
                >
                  {time}
                  <input
                    type="number"
                    min={0}
                    max={10}
                    value={specialCapacities[time] ?? 1}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      setSpecialCapacities((current) => ({
                        ...current,
                        [time]: Number.isNaN(value) ? 0 : value,
                      }));
                    }}
                    className="h-10 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-600"
                  />
                </label>
              ))}
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="h-11 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              特定日枠を保存
            </button>
          </form>

          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-base font-semibold">設定済み特定日</h2>
            </div>
            <div className="grid divide-y divide-slate-100">
              {specialItems.length ? (
                specialItems.map((item) => (
                  <div key={item.date} className="grid gap-3 px-5 py-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="font-semibold text-slate-950">
                        {item.date}
                      </p>
                      <button
                        type="button"
                        onClick={() => void deleteSpecial(item.date)}
                        className="h-9 rounded-md border border-red-200 bg-white px-3 text-sm font-semibold text-red-700 hover:bg-red-50"
                      >
                        削除
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {reservationTimeSlots.map((time) => (
                        <span
                          key={time}
                          className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 ring-1 ring-blue-100"
                        >
                          {time} {item.capacities[time] ?? 0}台
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <p className="px-5 py-10 text-center text-sm text-slate-500">
                  特定日上書きはまだ設定されていません。
                </p>
              )}
            </div>
          </section>
        </section>
      </main>

      {showBulkSettings ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/40 p-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bulk-slot-settings-title"
        >
          <div className="my-auto w-full max-w-xl rounded-md border border-slate-200 bg-white p-6 shadow-xl">
            <h2
              id="bulk-slot-settings-title"
              className="text-lg font-bold text-slate-950"
            >
              曜日別基本枠を一括設定
            </h2>

            <div className="mt-6 grid gap-6">
              <fieldset>
                <legend className="text-sm font-bold text-slate-800">
                  対象曜日
                </legend>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={bulkWeekdays.length === allWeekdays.length}
                      onChange={() =>
                        setBulkWeekdays((current) =>
                          current.length === allWeekdays.length
                            ? []
                            : allWeekdays,
                        )
                      }
                      className="h-4 w-4 accent-blue-600"
                    />
                    全曜日
                  </label>
                  {weekdayLabels.map((label, weekday) => (
                    <label
                      key={label}
                      className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-semibold text-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={bulkWeekdays.includes(weekday)}
                        onChange={() => toggleBulkWeekday(weekday)}
                        className="h-4 w-4 accent-blue-600"
                      />
                      {label}曜日
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend className="text-sm font-bold text-slate-800">
                  対象時間帯
                </legend>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={bulkTimeSlots.length === allTimeSlots.length}
                      onChange={() =>
                        setBulkTimeSlots((current) =>
                          current.length === allTimeSlots.length
                            ? []
                            : allTimeSlots,
                        )
                      }
                      className="h-4 w-4 accent-blue-600"
                    />
                    全時間帯
                  </label>
                  {reservationTimeSlots.map((time) => (
                    <label
                      key={time}
                      className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-semibold text-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={bulkTimeSlots.includes(time)}
                        onChange={() => toggleBulkTimeSlot(time)}
                        className="h-4 w-4 accent-blue-600"
                      />
                      {time}
                    </label>
                  ))}
                </div>
              </fieldset>

              <label className="grid gap-2 text-sm font-bold text-slate-800">
                設定台数
                <span className="flex items-center gap-3">
                  <input
                    type="number"
                    min={0}
                    max={10}
                    value={bulkCapacity}
                    onChange={(event) =>
                      setBulkCapacity(Number(event.target.value))
                    }
                    className="h-11 w-28 rounded-md border border-slate-300 px-3 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                  />
                  <span className="font-semibold text-slate-600">台</span>
                  <span className="text-xs font-semibold text-slate-500">
                    0台は受付停止です。
                  </span>
                </span>
              </label>
            </div>

            <div className="mt-7 grid grid-cols-2 gap-3">
              <button
                type="button"
                autoFocus
                onClick={() => setShowBulkSettings(false)}
                className="h-11 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={
                  !bulkWeekdays.length ||
                  !bulkTimeSlots.length ||
                  !Number.isInteger(bulkCapacity) ||
                  bulkCapacity < 0 ||
                  bulkCapacity > 10
                }
                onClick={applyBulkSettings}
                className="h-11 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                反映する
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
