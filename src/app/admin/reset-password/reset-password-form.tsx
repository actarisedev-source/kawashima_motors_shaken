"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type Field = "newPassword" | "confirmPassword";

export function ResetPasswordForm() {
  const [accessToken, setAccessToken] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<Record<Field, string>>({
    newPassword: "",
    confirmPassword: "",
  });
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loadingSession, setLoadingSession] = useState(true);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function readRecoverySession() {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const query = new URLSearchParams(window.location.search);
      const hashAccessToken = hash.get("access_token") ?? "";
      const hashRefreshToken = hash.get("refresh_token") ?? "";
      const queryAccessToken = query.get("access_token") ?? "";
      const queryRefreshToken = query.get("refresh_token") ?? "";
      const code = query.get("code") ?? "";

      if (hashAccessToken || queryAccessToken) {
        if (!mounted) return;
        setAccessToken(hashAccessToken || queryAccessToken);
        setRefreshToken(hashRefreshToken || queryRefreshToken);
        setLoadingSession(false);
        window.history.replaceState(null, "", window.location.pathname);
        return;
      }

      if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (!mounted) return;

        if (error || !data.session) {
          setMessage(
            error?.message ??
              "再設定リンクの確認に失敗しました。ログイン画面から再度お試しください。",
          );
          setLoadingSession(false);
          window.history.replaceState(null, "", window.location.pathname);
          return;
        }

        setAccessToken(data.session.access_token);
        setRefreshToken(data.session.refresh_token);
        setLoadingSession(false);
        window.history.replaceState(null, "", window.location.pathname);
        return;
      }

      setLoadingSession(false);
    }

    void readRecoverySession();
    return () => {
      mounted = false;
    };
  }, []);

  const tokenMissing = useMemo(
    () => !loadingSession && (!accessToken || !refreshToken),
    [accessToken, loadingSession, refreshToken],
  );

  function validate() {
    const nextErrors = { newPassword: "", confirmPassword: "" };
    if (newPassword.length < 8) {
      nextErrors.newPassword =
        "新しいパスワードは8文字以上で入力してください。";
    }
    if (newPassword !== confirmPassword) {
      nextErrors.confirmPassword = "新しいパスワードが一致しません。";
    }
    setErrors(nextErrors);
    return !nextErrors.newPassword && !nextErrors.confirmPassword;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (tokenMissing || submitting || !validate()) return;

    setSubmitting(true);
    const response = await fetch("/api/admin/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accessToken,
        refreshToken,
        newPassword,
        confirmPassword,
      }),
    });
    const result = (await response.json()) as {
      ok: boolean;
      field?: Field;
      message?: string;
    };

    setSubmitting(false);
    if (!response.ok || !result.ok) {
      if (result.field) {
        setErrors((current) => ({
          ...current,
          [result.field as Field]: result.message ?? "入力内容を確認してください。",
        }));
      } else {
        setMessage(result.message ?? "パスワードの変更に失敗しました。");
      }
      return;
    }

    setCompleted(true);
    setMessage("パスワードを変更しました。");
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
    >
      <p className="text-sm font-semibold text-blue-700">Admin</p>
      <h1 className="mt-2 text-2xl font-bold tracking-normal text-slate-950">
        新しいパスワード設定
      </h1>

      {loadingSession ? (
        <p className="mt-5 rounded-md border border-blue-100 bg-blue-50 px-3 py-3 text-sm font-semibold text-blue-700">
          再設定リンクを確認しています。
        </p>
      ) : null}

      {tokenMissing ? (
        <p className="mt-5 rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm font-semibold text-red-700">
          再設定リンクの有効期限が切れている可能性があります。ログイン画面から再度お試しください。
        </p>
      ) : null}

      <label className="mt-6 grid gap-2 text-sm font-medium text-slate-800">
        新しいパスワード
        <input
          required
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(event) => {
            setNewPassword(event.target.value);
            setErrors((current) => ({ ...current, newPassword: "" }));
          }}
          className={`h-11 rounded-md border px-3 text-base font-normal outline-none focus:border-blue-600 ${
            errors.newPassword ? "border-red-500" : "border-slate-300"
          }`}
        />
        <span className="min-h-5 text-xs font-medium text-red-600">
          {errors.newPassword}
        </span>
      </label>

      <label className="mt-2 grid gap-2 text-sm font-medium text-slate-800">
        新しいパスワード（確認）
        <input
          required
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => {
            setConfirmPassword(event.target.value);
            setErrors((current) => ({ ...current, confirmPassword: "" }));
          }}
          className={`h-11 rounded-md border px-3 text-base font-normal outline-none focus:border-blue-600 ${
            errors.confirmPassword ? "border-red-500" : "border-slate-300"
          }`}
        />
        <span className="min-h-5 text-xs font-medium text-red-600">
          {errors.confirmPassword}
        </span>
      </label>

      {message ? (
        <p
          className={`mt-3 text-sm font-semibold ${
            completed ? "text-emerald-700" : "text-red-700"
          }`}
        >
          {message}
        </p>
      ) : null}

      {completed ? (
        <a
          href="/admin"
          className="mt-5 flex h-11 items-center justify-center rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700"
        >
          管理画面へ
        </a>
      ) : (
        <button
          type="submit"
          disabled={submitting || loadingSession || tokenMissing}
          className="mt-5 h-11 w-full rounded-md bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {submitting ? "変更中..." : "パスワードを設定"}
        </button>
      )}
    </form>
  );
}
