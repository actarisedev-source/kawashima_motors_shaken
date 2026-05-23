"use client";

import { FormEvent, useState } from "react";

type LoginState =
  | { status: "idle"; message: "" }
  | { status: "submitting"; message: "ログイン中です。" }
  | { status: "error"; message: string };

export function AdminLoginForm() {
  const [loginState, setLoginState] = useState<LoginState>({
    status: "idle",
    message: "",
  });

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
        password: formData.get("password"),
      }),
    });
    const result = (await response.json()) as {
      ok: boolean;
      message?: string;
    };

    if (!response.ok || !result.ok) {
      setLoginState({
        status: "error",
        message: result.message ?? "ログインに失敗しました。",
      });
      return;
    }

    window.location.href = "/admin";
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
    >
      <div>
        <p className="text-sm font-semibold text-blue-700">Admin</p>
        <h1 className="mt-2 text-2xl font-bold tracking-normal text-slate-950">
          管理者ログイン
        </h1>
      </div>
      <label className="mt-6 grid gap-2 text-sm font-medium text-slate-800">
        パスワード
        <input
          required
          name="password"
          type="password"
          autoComplete="current-password"
          className="h-11 rounded-md border border-slate-300 px-3 text-base font-normal outline-none focus:border-blue-600"
        />
      </label>
      <button
        type="submit"
        disabled={loginState.status === "submitting"}
        className="mt-5 h-11 w-full rounded-md bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        ログイン
      </button>
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
    </form>
  );
}
