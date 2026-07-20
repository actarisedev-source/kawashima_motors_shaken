"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { AdminHeader } from "../../admin-header";

type AccountSettingsProps = {
  initialEmail: string;
};

export function AccountSettings({ initialEmail }: AccountSettingsProps) {
  const [newEmail, setNewEmail] = useState("");
  const [newEmailConfirmation, setNewEmailConfirmation] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState<
    "email" | "emailConfirmation" | ""
  >("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleEmailUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setError("");
    setErrorField("");
    setMessage("");
    const email = newEmail.trim();
    const emailConfirmation = newEmailConfirmation.trim();

    if (!email) {
      setError("新しいメールアドレスを入力してください。");
      setErrorField("email");
      return;
    }

    if (!emailConfirmation) {
      setError("確認用メールアドレスを入力してください。");
      setErrorField("emailConfirmation");
      return;
    }

    if (email !== emailConfirmation) {
      setError("メールアドレスが一致しません。");
      setErrorField("emailConfirmation");
      return;
    }

    setSubmitting(true);
    const response = await fetch("/api/admin/account", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, emailConfirmation }),
    });
    const result = (await response.json()) as {
      ok: boolean;
      email?: string;
      message?: string;
      field?: string;
    };

    setSubmitting(false);
    if (!response.ok || !result.ok) {
      setError(result.message ?? "メールアドレスの変更に失敗しました。");
      setErrorField(
        result.field === "emailConfirmation" ? "emailConfirmation" : "email",
      );
      return;
    }

    setPendingEmail(email);
    setNewEmail("");
    setNewEmailConfirmation("");
    setMessage(
      result.message ??
        "確認メールを送信しました。\nメール内のリンクからメールアドレス変更を完了してください。",
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <AdminHeader title="アカウント設定" onRefresh={() => window.location.reload()} />
      <div className="mx-auto grid max-w-3xl gap-5 px-5 py-6 sm:px-6 lg:px-8">
        <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-lg font-bold">メールアドレス変更</h2>
          <form onSubmit={handleEmailUpdate} className="mt-5 grid gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-600">
                現在のメールアドレス
              </p>
              <p className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-950">
                {initialEmail || "未取得"}
              </p>
              {pendingEmail ? (
                <p className="mt-2 text-sm font-semibold text-blue-700">
                  確認待ちのメールアドレス: {pendingEmail}
                </p>
              ) : null}
            </div>
            <label className="grid gap-2 text-sm font-semibold text-slate-700">
              新しいメールアドレス
              <input
                type="email"
                value={newEmail}
                onChange={(event) => {
                  setNewEmail(event.target.value);
                  setError("");
                  setErrorField("");
                  setMessage("");
                }}
                className={`h-11 rounded-md border bg-white px-3 text-base font-normal outline-none focus:border-blue-600 ${
                  errorField === "email" ? "border-red-500" : "border-slate-300"
                }`}
              />
              <span className="min-h-5 text-xs font-medium text-red-600">
                {errorField === "email" ? error : ""}
              </span>
            </label>
            <label className="grid gap-2 text-sm font-semibold text-slate-700">
              新しいメールアドレス（確認用）
              <input
                type="email"
                value={newEmailConfirmation}
                onChange={(event) => {
                  setNewEmailConfirmation(event.target.value);
                  setError("");
                  setErrorField("");
                  setMessage("");
                }}
                className={`h-11 rounded-md border bg-white px-3 text-base font-normal outline-none focus:border-blue-600 ${
                  errorField === "emailConfirmation"
                    ? "border-red-500"
                    : "border-slate-300"
                }`}
              />
              <span className="min-h-5 text-xs font-medium text-red-600">
                {errorField === "emailConfirmation" ? error : ""}
              </span>
            </label>
            {message ? (
              <p className="whitespace-pre-line text-sm font-semibold text-emerald-700">
                {message}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={submitting}
              className="h-11 w-full rounded-md bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:bg-blue-300 sm:w-fit"
            >
              {submitting ? "変更中..." : "変更する"}
            </button>
          </form>
        </section>

        <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-lg font-bold">パスワード変更</h2>
          <p className="mt-2 text-sm text-slate-600">
            現在のパスワードを確認して、新しいパスワードへ変更します。
          </p>
          <Link
            href="/admin/settings/password"
            className="mt-4 inline-flex h-11 items-center justify-center rounded-md border border-blue-200 bg-white px-4 text-sm font-semibold text-blue-700 shadow-sm transition hover:bg-blue-50"
          >
            パスワード変更へ
          </Link>
        </section>
      </div>
    </main>
  );
}
