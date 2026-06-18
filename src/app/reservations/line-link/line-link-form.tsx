"use client";

import { FormEvent, useEffect, useState } from "react";

type LineProfile = {
  displayName: string;
  pictureUrl?: string;
};

type MatchedCustomer = {
  id: string;
  name: string;
  phone: string;
  alreadyLinked: boolean;
};

type LineLinkFormProps = {
  liffId: string;
};

export function LineLinkForm({ liffId }: LineLinkFormProps) {
  const [initializing, setInitializing] = useState(true);
  const [loggingIn, setLoggingIn] = useState(false);
  const [idToken, setIdToken] = useState("");
  const [lineProfile, setLineProfile] = useState<LineProfile | null>(null);
  const [phone, setPhone] = useState("");
  const [customer, setCustomer] = useState<MatchedCustomer | null>(null);
  const [message, setMessage] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linked, setLinked] = useState(false);

  useEffect(() => {
    let active = true;

    async function initialize() {
      if (!liffId) {
        setMessage("LINEログイン設定が完了していません。");
        setInitializing(false);
        return;
      }

      try {
        const { default: liff } = await import("@line/liff");
        await liff.init({ liffId });

        if (!active) {
          return;
        }

        if (liff.isLoggedIn()) {
          const token = liff.getIDToken();
          const profile = await liff.getProfile();

          if (token) {
            setIdToken(token);
            setLineProfile({
              displayName: profile.displayName,
              pictureUrl: profile.pictureUrl,
            });
          } else {
            setMessage("LINEログイン情報を取得できませんでした。");
          }
        }
      } catch (error) {
        console.error("LIFF initialization failed", error);
        if (active) {
          setMessage("LINEログインの初期化に失敗しました。");
        }
      } finally {
        if (active) {
          setInitializing(false);
        }
      }
    }

    void initialize();

    return () => {
      active = false;
    };
  }, [liffId]);

  async function loginWithLine() {
    if (!liffId) {
      return;
    }

    setLoggingIn(true);
    setMessage("");

    try {
      const { default: liff } = await import("@line/liff");
      await liff.init({ liffId });
      liff.login({ redirectUri: window.location.href });
    } catch (error) {
      console.error("LIFF login failed", error);
      setMessage("LINEログインを開始できませんでした。");
      setLoggingIn(false);
    }
  }

  async function searchCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearching(true);
    setCustomer(null);
    setMessage("");
    setNotFound(false);

    const response = await fetch("/api/line/link/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, phone }),
    });
    const result = (await response.json()) as {
      ok: boolean;
      customer?: MatchedCustomer;
      message?: string;
      notFound?: boolean;
    };

    if (!response.ok || !result.ok || !result.customer) {
      setNotFound(Boolean(result.notFound));
      setMessage(result.message ?? "顧客情報の検索に失敗しました。");
      setSearching(false);
      return;
    }

    setCustomer(result.customer);
    setSearching(false);
  }

  async function confirmLink() {
    if (!customer) {
      return;
    }

    setLinking(true);
    setMessage("");

    const response = await fetch("/api/line/link/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, customerId: customer.id, phone }),
    });
    const result = (await response.json()) as {
      ok: boolean;
      message?: string;
    };

    if (!response.ok || !result.ok) {
      setMessage(result.message ?? "LINE連携に失敗しました。");
      setLinking(false);
      return;
    }

    setLinked(true);
    setLinking(false);
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 sm:py-12">
      <div className="mx-auto grid w-full max-w-xl gap-6">
        <header className="text-center">
          <p className="text-sm font-bold text-blue-700">Kawashima Motors</p>
          <h1 className="mt-2 text-2xl font-bold sm:text-3xl">LINE連携</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            登録済みのお客様情報とLINEアカウントを連携します。
          </p>
        </header>

        <section className="rounded-[5px] border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          {initializing ? (
            <p className="py-12 text-center text-sm font-semibold text-slate-500">
              LINEログイン情報を確認しています。
            </p>
          ) : linked ? (
            <div className="py-10 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[5px] bg-emerald-100 text-2xl font-bold text-emerald-700">
                ✓
              </div>
              <h2 className="mt-5 text-xl font-bold">LINE連携が完了しました</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                今後のお知らせを受け取る準備ができました。
              </p>
            </div>
          ) : !idToken ? (
            <div className="grid gap-5 py-6 text-center">
              <div>
                <h2 className="text-lg font-bold">LINEでログイン</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  本人確認のためLINEログインを行ってください。
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loginWithLine()}
                disabled={loggingIn || !liffId}
                className="h-12 rounded-[5px] bg-[#06C755] px-5 font-bold text-white transition hover:bg-[#05b84e] disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {loggingIn ? "LINEログインへ移動中..." : "LINEでログイン"}
              </button>
            </div>
          ) : customer ? (
            <div className="grid gap-6">
              <div>
                <p className="text-sm font-semibold text-blue-700">
                  お客様情報が見つかりました
                </p>
                <h2 className="mt-2 text-xl font-bold">
                  この顧客情報とLINEを連携しますか？
                </h2>
              </div>
              <dl className="grid gap-4 rounded-[5px] border border-slate-200 bg-slate-50 p-5 text-sm">
                <div>
                  <dt className="font-semibold text-slate-500">氏名</dt>
                  <dd className="mt-1 text-base font-bold">{customer.name}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-500">電話番号</dt>
                  <dd className="mt-1 text-base font-bold">{customer.phone}</dd>
                </div>
                {lineProfile ? (
                  <div>
                    <dt className="font-semibold text-slate-500">LINE表示名</dt>
                    <dd className="mt-1 text-base font-bold">
                      {lineProfile.displayName}
                    </dd>
                  </div>
                ) : null}
              </dl>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setCustomer(null)}
                  disabled={linking}
                  className="h-12 rounded-[5px] border border-slate-300 bg-white font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={() => void confirmLink()}
                  disabled={linking}
                  className="h-12 rounded-[5px] bg-blue-600 font-bold text-white transition hover:bg-blue-700 disabled:bg-slate-400"
                >
                  {linking
                    ? "連携中..."
                    : customer.alreadyLinked
                      ? "連携を確認する"
                      : "連携する"}
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={(event) => void searchCustomer(event)} className="grid gap-5">
              <div>
                <p className="text-sm font-semibold text-blue-700">
                  LINEログイン済み
                </p>
                <h2 className="mt-2 text-xl font-bold">電話番号を入力</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  店舗へ登録した電話番号を入力してください。
                </p>
              </div>
              <label className="grid gap-2 text-sm font-semibold text-slate-700">
                電話番号
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="090-1234-5678"
                  required
                  className="h-12 rounded-[5px] border border-slate-300 bg-white px-4 text-base font-normal outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <button
                type="submit"
                disabled={searching || !phone.trim()}
                className="h-12 rounded-[5px] bg-blue-600 font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {searching ? "検索中..." : "顧客情報を検索"}
              </button>
            </form>
          )}

          {message ? (
            <div
              className={`mt-5 rounded-[5px] border px-4 py-3 text-sm font-semibold leading-6 ${
                notFound
                  ? "border-amber-200 bg-amber-50 text-amber-800"
                  : "border-red-200 bg-red-50 text-red-700"
              }`}
            >
              {message}
            </div>
          ) : null}
        </section>

        <p className="text-center text-xs leading-5 text-slate-500">
          LINE連携では新しい顧客情報は作成されません。
        </p>
      </div>
    </main>
  );
}
