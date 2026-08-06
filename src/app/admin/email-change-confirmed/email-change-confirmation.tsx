"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

type ConfirmationState = "checking" | "accepted" | "completed" | "error";

export function EmailChangeConfirmation() {
  const [confirmationState, setConfirmationState] =
    useState<ConfirmationState>("checking");

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const hasError = Boolean(
      query.get("error") ||
        query.get("error_code") ||
        query.get("error_description") ||
        hash.get("error") ||
        hash.get("error_code") ||
        hash.get("error_description"),
    );
    const confirmationMessage =
      hash.get("message") ?? query.get("message") ?? "";
    const confirmationType = hash.get("type") ?? query.get("type") ?? "";
    const hasSessionResult = Boolean(
      hash.get("access_token") || query.get("code"),
    );
    const isCompleted =
      confirmationType === "email_change" && hasSessionResult;
    const isAccepted = confirmationMessage.length > 0;

    setConfirmationState(
      hasError
        ? "error"
        : isCompleted
          ? "completed"
          : isAccepted
            ? "accepted"
            : "error",
    );
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const isChecking = confirmationState === "checking";
  const isSuccess =
    confirmationState === "accepted" || confirmationState === "completed";
  const isCompleted = confirmationState === "completed";

  return (
    <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8">
      <Image
        src="/images/kawashima-logo.png"
        alt="Kawashima Motors"
        width={360}
        height={78}
        priority
        className="mx-auto h-auto w-52 max-w-full sm:w-56"
      />

      <div
        aria-hidden="true"
        className={`mx-auto mt-7 flex h-14 w-14 items-center justify-center rounded-full text-3xl font-bold ${
          isChecking
            ? "bg-blue-50 text-blue-600"
            : isSuccess
              ? "bg-emerald-50 text-emerald-600"
              : "bg-red-50 text-red-600"
        }`}
      >
        {isChecking ? "…" : isSuccess ? "✓" : "!"}
      </div>

      <h1 className="mt-5 text-xl font-bold tracking-normal text-slate-950 sm:text-2xl">
        {isChecking
          ? "確認リンクを確認しています"
          : isSuccess
            ? isCompleted
              ? "メールアドレスの変更が完了しました"
              : "メールアドレスの確認が完了しました"
            : "メールアドレスを確認できませんでした"}
      </h1>

      <p className="mt-4 whitespace-pre-line text-sm leading-7 text-slate-600">
        {isChecking
          ? "しばらくお待ちください。"
          : isSuccess
            ? isCompleted
              ? "新しいメールアドレスが有効になりました。\n次回から新しいメールアドレスでログインしてください。"
              : "メールアドレスの確認を受け付けました。\n必要な確認がすべて完了すると、新しいメールアドレスが有効になります。"
            : "確認リンクが無効または期限切れです。\n管理画面からメールアドレス変更をやり直してください。"}
      </p>

      {!isChecking ? (
        <Link
          href="/admin"
          className="mt-7 flex h-11 w-full items-center justify-center rounded-md bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
        >
          管理画面へ戻る
        </Link>
      ) : null}
    </section>
  );
}
