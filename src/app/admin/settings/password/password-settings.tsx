"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { AdminHeader } from "../../admin-header";

type PasswordField = "currentPassword" | "newPassword" | "confirmPassword";
type PasswordValues = Record<PasswordField, string>;
type PasswordErrors = Record<PasswordField, string>;

const emptyValues: PasswordValues = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
};
const emptyErrors: PasswordErrors = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
};

const fieldLabels: Record<PasswordField, string> = {
  currentPassword: "現在のパスワード",
  newPassword: "新しいパスワード",
  confirmPassword: "新しいパスワード（確認）",
};

export function PasswordSettings() {
  const [values, setValues] = useState<PasswordValues>(emptyValues);
  const [errors, setErrors] = useState<PasswordErrors>(emptyErrors);
  const [visible, setVisible] = useState<Record<PasswordField, boolean>>({
    currentPassword: false,
    newPassword: false,
    confirmPassword: false,
  });
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const cancelConfirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) {
      cancelConfirmRef.current?.focus();
    }
  }, [confirming]);

  function validate() {
    const nextErrors = { ...emptyErrors };
    if (!values.currentPassword) {
      nextErrors.currentPassword = "現在のパスワードを入力してください。";
    }
    if (values.newPassword.length < 8) {
      nextErrors.newPassword = "新しいパスワードは8文字以上で入力してください。";
    } else if (values.newPassword === values.currentPassword) {
      nextErrors.newPassword = "現在と異なるパスワードを入力してください。";
    }
    if (values.confirmPassword !== values.newPassword) {
      nextErrors.confirmPassword = "新しいパスワードが一致しません。";
    }
    setErrors(nextErrors);
    return !Object.values(nextErrors).some(Boolean);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (validate()) {
      setConfirming(true);
    }
  }

  async function changePassword() {
    if (submitting) return;
    setSubmitting(true);
    setMessage("");

    const response = await fetch("/api/admin/password", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    const result = (await response.json()) as {
      ok: boolean;
      field?: PasswordField;
      message?: string;
    };

    if (!response.ok || !result.ok) {
      if (result.field) {
        setErrors((current) => ({
          ...current,
          [result.field as PasswordField]: result.message ?? "入力内容を確認してください。",
        }));
      } else {
        setMessage(result.message ?? "パスワードの変更に失敗しました。");
      }
      setConfirming(false);
      setSubmitting(false);
      return;
    }

    setValues(emptyValues);
    setErrors(emptyErrors);
    setConfirming(false);
    setSubmitting(false);
    setMessage("パスワードを変更しました。");
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <AdminHeader title="パスワード変更" onRefresh={() => window.location.reload()} />
      <div className="mx-auto max-w-2xl px-5 py-6 sm:px-6 lg:px-8">
        <form
          onSubmit={handleSubmit}
          className="rounded-md border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
        >
          <div className="grid gap-4">
            {(Object.keys(fieldLabels) as PasswordField[]).map((field) => (
              <label key={field} className="grid gap-2 text-sm font-semibold text-slate-700">
                {fieldLabels[field]}
                <span className="relative block">
                  <input
                    type={visible[field] ? "text" : "password"}
                    autoComplete={field === "currentPassword" ? "current-password" : "new-password"}
                    value={values[field]}
                    maxLength={field === "currentPassword" ? 256 : 128}
                    onChange={(event) => {
                      setValues((current) => ({ ...current, [field]: event.target.value }));
                      setErrors((current) => ({ ...current, [field]: "" }));
                    }}
                    className={`h-11 w-full rounded-md border bg-white px-3 pr-11 text-base font-normal outline-none focus:border-blue-600 ${
                      errors[field] ? "border-red-500" : "border-slate-300"
                    }`}
                  />
                  <button
                    type="button"
                    aria-label={`${fieldLabels[field]}を${visible[field] ? "隠す" : "表示"}`}
                    onClick={() => setVisible((current) => ({ ...current, [field]: !current[field] }))}
                    className="absolute right-1 top-1 grid h-9 w-9 place-items-center text-lg text-slate-500 transition hover:text-blue-700"
                  >
                    <span aria-hidden="true">{visible[field] ? "◉" : "👁"}</span>
                  </button>
                </span>
                <span className="min-h-5 text-xs font-medium text-red-600">
                  {errors[field]}
                </span>
              </label>
            ))}
          </div>

          {message ? (
            <p className={`mt-2 text-sm font-semibold ${message === "パスワードを変更しました。" ? "text-emerald-700" : "text-red-700"}`}>
              {message}
            </p>
          ) : null}

          <div className="mt-5 grid grid-cols-2 gap-3">
            <Link
              href="/admin/settings"
              className="flex h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              キャンセル
            </Link>
            <button
              type="submit"
              className="h-11 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              パスワード変更
            </button>
          </div>
        </form>
      </div>

      {confirming ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-5" role="dialog" aria-modal="true" aria-labelledby="password-confirm-title">
          <div className="w-full max-w-sm rounded-md border border-slate-200 bg-white p-6 shadow-xl">
            <h2 id="password-confirm-title" className="text-lg font-bold">
              パスワードを変更しますか？
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              変更後は新しいパスワードでログインしてください。
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                ref={cancelConfirmRef}
                type="button"
                disabled={submitting}
                onClick={() => setConfirming(false)}
                className="h-11 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void changePassword()}
                className="h-11 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:bg-blue-300"
              >
                {submitting ? "変更中..." : "変更する"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
