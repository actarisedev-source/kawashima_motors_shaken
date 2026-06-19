"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CompletedReservation,
  ReservationComplete,
} from "@/app/reservation-complete";
import { reservationCompletionStorageKey } from "@/lib/reservations/completion-storage";
import { ReservationLineLinkGuide } from "@/app/reservation-line-link-guide";

type StoredCompletion = {
  reservation: CompletedReservation;
  notice?: string;
  showLineLinkGuide?: boolean;
};

export function ReservationCompletePage() {
  const [completion, setCompletion] = useState<StoredCompletion | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(
        reservationCompletionStorageKey,
      );
      if (stored) {
        setCompletion(JSON.parse(stored) as StoredCompletion);
      }
    } catch {
      setCompletion(null);
    } finally {
      setLoaded(true);
    }
  }, []);

  if (!loaded) {
    return (
      <main className="mx-auto min-h-screen max-w-3xl bg-zinc-50 px-4 py-8 text-zinc-950 sm:px-6">
        <div className="rounded-lg border border-zinc-200 bg-white p-6 text-center shadow-sm">
          予約完了情報を読み込んでいます。
        </div>
      </main>
    );
  }

  if (!completion) {
    return (
      <main className="mx-auto min-h-screen max-w-3xl bg-zinc-50 px-4 py-8 text-zinc-950 sm:px-6">
        <div className="grid gap-4 rounded-lg border border-zinc-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-black">予約完了情報を確認できません</h1>
          <p className="text-sm leading-6 text-zinc-600">
            予約確認URLをご利用いただくか、店舗へお問い合わせください。
          </p>
          <Link href="/" className="font-bold text-blue-700 underline">
            予約画面へ戻る
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-zinc-50 px-4 py-8 text-zinc-950 sm:px-6">
      <ReservationComplete
        reservation={completion.reservation}
        notice={completion.notice}
        additionalContent={
          completion.showLineLinkGuide ? <ReservationLineLinkGuide /> : null
        }
      />
    </main>
  );
}
