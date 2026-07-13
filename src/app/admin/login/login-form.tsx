"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type LoginField = "email" | "password";
type LoginState =
  | { status: "idle"; message: ""; field?: never }
  | { status: "submitting"; message: "ログイン中です。"; field?: never }
  | { status: "error"; message: string; field?: LoginField };

type ResetState =
  | { status: "idle"; message: "" }
  | { status: "submitting"; message: "送信中です。" }
  | { status: "success"; message: "パスワード再設定メールを送信しました。" }
  | { status: "error"; message: string };

const contactEmail = "info@actarise-llc.com";

export function AdminLoginForm() {
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const [showEmailHelp, setShowEmailHelp] = useState(false);
  const [loginState, setLoginState] = useState<LoginState>({
    status: "idle",
    message: "",
  });
  const [resetState, setResetState] = useState<ResetState>({
    status: "idle",
    message: "",
  });
  const [copied, setCopied] = useState(false);
  const passwordResetCancelRef = useRef<HTMLButtonElement>(null);
  const emailHelpCloseRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!showPasswordReset && !showEmailHelp) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setShowPasswordReset(false);
        setShowEmailHelp(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showPasswordReset, showEmailHelp]);

  useEffect(() => {
    if (showPasswordReset) {
      passwordResetCancelRef.current?.focus();
    }
  }, [showPasswordReset]);

  useEffect(() => {
    if (showEmailHelp) {
      emailHelpCloseRef.current?.focus();
    }
  }, [showEmailHelp]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginState({ status: "submitting", message: "ログイン中です。" });

    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: formData.get("email"),
        password: formData.get("password"),
      }),
    });
    const result = (await response.json()) as {
      ok: boolean;
      field?: LoginField;
      message?: string;
    };

    if (!response.ok || !result.ok) {
      setLoginState({
        status: "error",
        field: result.field,
        message: result.message ?? "ログインに失敗しました。",
      });
      return;
    }

    window.location.href = "/admin";
  }

  async function handlePasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResetState({ status: "submitting", message: "送信中です。" });

    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/admin/password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: formData.get("resetEmail") }),
    });
    const result = (await response.json()) as {
      ok: boolean;
      message?: string;
    };

    if (!response.ok || !result.ok) {
      setResetState({
        status: "error",
        message: result.message ?? "再設定メールを送信できませんでした。",
      });
      return;
    }

    setResetState({
      status: "success",
      message: "パスワード再設定メールを送信しました。",
    });
  }

  async function copyContactEmail() {
    await navigator.clipboard.writeText(contactEmail);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2500);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
    >
      <label className="grid gap-2 text-sm font-medium text-slate-800">
        メールアドレス
        <input
          required
          name="email"
          type="email"
          autoComplete="email"
          className={`h-11 rounded-md border px-3 text-base font-normal outline-none focus:border-blue-600 ${
            loginState.status === "error" && loginState.field === "email"
              ? "border-red-500"
              : "border-slate-300"
          }`}
        />
      </label>
      <label className="mt-4 grid gap-2 text-sm font-medium text-slate-800">
        パスワード
        <input
          required
          name="password"
          type="password"
          autoComplete="current-password"
          className={`h-11 rounded-md border px-3 text-base font-normal outline-none focus:border-blue-600 ${
            loginState.status === "error" && loginState.field === "password"
              ? "border-red-500"
              : "border-slate-300"
          }`}
        />
      </label>
      <button
        type="submit"
        disabled={loginState.status === "submitting"}
        className="mt-5 h-11 w-full rounded-md bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        ログイン
      </button>
      <div className="mt-3 grid gap-2 text-center">
        <button
          type="button"
          onClick={() => setShowEmailHelp(true)}
          className="text-sm font-medium text-blue-700 transition hover:text-blue-800 hover:underline"
        >
          メールアドレスをお忘れですか？
        </button>
        <button
          type="button"
          onClick={() => {
            setResetState({ status: "idle", message: "" });
            setShowPasswordReset(true);
          }}
          className="text-sm font-medium text-blue-700 transition hover:text-blue-800 hover:underline"
        >
          パスワードをお忘れですか？
        </button>
      </div>
      {loginState.message ? (
        <p
          className={
            loginState.status === "error"
              ? "mt-4 text-sm font-medium text-red-700"
              : "mt-4 text-sm font-medium text-blue-700"
          }
        >
          {loginState.message}
        </p>
      ) : null}

      {showPasswordReset ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="password-reset-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowPasswordReset(false);
            }
          }}
        >
          <form
            onSubmit={handlePasswordReset}
            className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-5 shadow-xl sm:p-6"
          >
            <h2
              id="password-reset-title"
              className="text-lg font-bold text-slate-950"
            >
              パスワードをお忘れですか？
            </h2>
            <p className="mt-4 text-sm leading-6 text-slate-700">
              登録済みのメールアドレスを入力してください。
            </p>
            <label className="mt-4 grid gap-2 text-sm font-semibold text-slate-700">
              メールアドレス
              <input
                required
                name="resetEmail"
                type="email"
                autoComplete="email"
                className="h-11 rounded-md border border-slate-300 px-3 text-base font-normal outline-none focus:border-blue-600"
              />
            </label>
            {resetState.message ? (
              <p
                className={`mt-3 text-sm font-semibold ${
                  resetState.status === "success"
                    ? "text-emerald-700"
                    : resetState.status === "error"
                      ? "text-red-700"
                      : "text-blue-700"
                }`}
              >
                {resetState.message}
              </p>
            ) : null}
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                ref={passwordResetCancelRef}
                type="button"
                disabled={resetState.status === "submitting"}
                onClick={() => setShowPasswordReset(false)}
                className="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={resetState.status === "submitting"}
                className="h-10 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:bg-blue-300"
              >
                再設定メールを送信
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {showEmailHelp ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="email-help-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowEmailHelp(false);
            }
          }}
        >
          <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-5 shadow-xl sm:p-6">
            <h2
              id="email-help-title"
              className="text-lg font-bold text-slate-950"
            >
              メールアドレスをお忘れですか？
            </h2>
            <p className="mt-4 whitespace-pre-line text-sm leading-6 text-slate-700">
              登録済みのメールアドレスがご不明な場合は、
              管理者までお問い合わせください。
            </p>
            <div className="mt-4 grid gap-2">
              <p className="text-xs font-semibold text-slate-500">
                メールアドレス
              </p>
              <div className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                <span className="select-all text-sm font-semibold text-slate-900">
                  {contactEmail}
                </span>
                <button
                  type="button"
                  onClick={() => void copyContactEmail()}
                  className="grid h-8 w-8 place-items-center rounded-md text-blue-700 transition hover:bg-blue-50"
                  aria-label="メールアドレスをコピー"
                  title="コピー"
                >
                  <span aria-hidden="true">📋</span>
                </button>
              </div>
            </div>
            <div className="mt-4">
              <p className="text-xs font-semibold text-slate-500">営業時間</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                9:00 - 18:00
              </p>
            </div>
            {copied ? (
              <p className="mt-3 text-sm font-semibold text-emerald-700">
                メールアドレスをコピーしました。
              </p>
            ) : null}
            <button
              ref={emailHelpCloseRef}
              type="button"
              onClick={() => setShowEmailHelp(false)}
              className="mt-6 h-10 w-full rounded-md bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              閉じる
            </button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
