"use client";

import { FormEvent, useState } from "react";

type SubmitState =
  | { status: "idle"; message: "" }
  | { status: "submitting"; message: "送信中です。" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

export function ReservationForm() {
  const [submitState, setSubmitState] = useState<SubmitState>({
    status: "idle",
    message: "",
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitState({ status: "submitting", message: "送信中です。" });

    const formData = new FormData(event.currentTarget);
    const reservedDate = String(formData.get("reservedDate") ?? "");
    const reservedTime = String(formData.get("reservedTime") ?? "");

    const response = await fetch("/api/reservations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        customerName: formData.get("customerName"),
        customerKana: formData.get("customerKana"),
        phone: formData.get("phone"),
        vehicleModel: formData.get("vehicleModel"),
        licensePlate: formData.get("licensePlate"),
        inspectionExpiresOn: formData.get("inspectionExpiresOn"),
        reservedAt: `${reservedDate}T${reservedTime}:00+09:00`,
        note: formData.get("note"),
      }),
    });

    const result = (await response.json()) as {
      ok: boolean;
      message?: string;
      reservationId?: string;
    };

    if (!response.ok || !result.ok) {
      setSubmitState({
        status: "error",
        message: result.message ?? "予約の送信に失敗しました。",
      });
      return;
    }

    event.currentTarget.reset();
    setSubmitState({
      status: "success",
      message: `予約を受け付けました。受付番号: ${result.reservationId}`,
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="grid gap-4 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm font-medium text-zinc-800">
          お名前
          <input
            required
            name="customerName"
            className="h-11 rounded-md border border-zinc-300 px-3 text-base font-normal outline-none focus:border-emerald-600"
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-zinc-800">
          フリガナ
          <input
            name="customerKana"
            className="h-11 rounded-md border border-zinc-300 px-3 text-base font-normal outline-none focus:border-emerald-600"
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-zinc-800">
          電話番号
          <input
            required
            name="phone"
            type="tel"
            className="h-11 rounded-md border border-zinc-300 px-3 text-base font-normal outline-none focus:border-emerald-600"
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-zinc-800">
          車種
          <input
            required
            name="vehicleModel"
            className="h-11 rounded-md border border-zinc-300 px-3 text-base font-normal outline-none focus:border-emerald-600"
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-zinc-800">
          ナンバー
          <input
            name="licensePlate"
            className="h-11 rounded-md border border-zinc-300 px-3 text-base font-normal outline-none focus:border-emerald-600"
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-zinc-800">
          車検満了日
          <input
            name="inspectionExpiresOn"
            type="date"
            className="h-11 rounded-md border border-zinc-300 px-3 text-base font-normal outline-none focus:border-emerald-600"
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-zinc-800">
          予約日
          <input
            required
            name="reservedDate"
            type="date"
            className="h-11 rounded-md border border-zinc-300 px-3 text-base font-normal outline-none focus:border-emerald-600"
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-zinc-800">
          予約時間
          <input
            required
            name="reservedTime"
            type="time"
            className="h-11 rounded-md border border-zinc-300 px-3 text-base font-normal outline-none focus:border-emerald-600"
          />
        </label>
      </div>
      <label className="grid gap-2 text-sm font-medium text-zinc-800">
        ご要望
        <textarea
          name="note"
          rows={4}
          className="rounded-md border border-zinc-300 px-3 py-2 text-base font-normal outline-none focus:border-emerald-600"
        />
      </label>
      <button
        type="submit"
        disabled={submitState.status === "submitting"}
        className="h-11 rounded-md bg-emerald-700 px-5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
      >
        予約を送信
      </button>
      {submitState.message ? (
        <p
          className={
            submitState.status === "error"
              ? "text-sm font-medium text-red-700"
              : "text-sm font-medium text-emerald-700"
          }
        >
          {submitState.message}
        </p>
      ) : null}
    </form>
  );
}
