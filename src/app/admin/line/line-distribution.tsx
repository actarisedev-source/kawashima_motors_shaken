"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminHeader } from "../admin-header";

type Filters = {
  shaken: string[];
  visits: string[];
  genders: string[];
  ages: string[];
  customerIds: string[];
};

type CustomerOption = {
  id: string;
  name: string;
  phone: string;
  gender: string;
  vehiclePlateNumbers: string[];
};

type MessageLog = {
  id: string;
  target_type: string;
  title: string;
  status: "成功" | "失敗";
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
};

const emptyFilters: Filters = {
  shaken: [],
  visits: [],
  genders: [],
  ages: [],
  customerIds: [],
};

const groups = [
  {
    key: "shaken" as const,
    title: "車検",
    options: [
      ["30", "車検30日以内"],
      ["60", "車検60日以内"],
      ["90", "車検90日以内"],
      ["期限切れ", "車検期限切れ"],
    ],
  },
  {
    key: "visits" as const,
    title: "来店履歴",
    options: [
      ["予約あり", "予約あり"],
      ["予約なし", "予約なし"],
      ["過去1年以内来店", "過去1年以内来店"],
      ["過去1年以上来店なし", "過去1年以上来店なし"],
    ],
  },
  {
    key: "genders" as const,
    title: "性別",
    options: [
      ["男性", "男性"],
      ["女性", "女性"],
      ["未設定", "未設定"],
    ],
  },
  {
    key: "ages" as const,
    title: "年代",
    options: ["10代", "20代", "30代", "40代", "50代", "60代", "70代以上"].map(
      (value) => [value, value],
    ),
  },
];

const variableSamples: Record<string, string> = {
  name: "山田 太郎",
  phone: "090-1234-5678",
  vehicle_name: "プリウス",
  plate_number: "静岡 300 あ 12-34",
  shaken_expiry_date: "2026/08/31",
  reservation_date: "2026/07/10 10:00",
  age: "40",
};

const previewMessage = (body: string) =>
  body.replace(/\{\{([a-z_]+)\}\}/g, (_, key: string) =>
    key in variableSamples ? variableSamples[key] : `{{${key}}}`,
  );

export function LineDistribution() {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [count, setCount] = useState(0);
  const [excludedCount, setExcludedCount] = useState(0);
  const [configured, setConfigured] = useState(true);
  const [loadingCount, setLoadingCount] = useState(true);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<CustomerOption[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [deliveryCompleted, setDeliveryCompleted] = useState(false);
  const deliveryLockedRef = useRef(false);
  const [message, setMessage] = useState("");
  const [logs, setLogs] = useState<MessageLog[]>([]);

  const loadLogs = useCallback(async () => {
    const response = await fetch("/api/admin/line/logs", { cache: "no-store" });
    const result = await response.json();
    if (response.ok && result.ok) {
      setLogs(result.logs ?? []);
    }
  }, []);

  const targetLabel = useMemo(() => {
    const labels = groups.flatMap((group) =>
      group.options
        .filter(([value]) => filters[group.key].includes(value))
        .map(([, label]) => label),
    );
    if (filters.customerIds.length) labels.push(`個別${filters.customerIds.length}件`);
    return labels.length ? labels.join("、") : "LINE連携済み全員";
  }, [filters]);

  const loadAudience = useCallback(async () => {
    setLoadingCount(true);
    const response = await fetch("/api/admin/line/audience", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(filters),
    });
    const result = await response.json();
    if (response.ok && result.ok) {
      setCount(result.count);
      setExcludedCount(result.excludedCount);
      setConfigured(result.configured);
    } else {
      setMessage(result.message ?? "対象件数の取得に失敗しました。");
    }
    setLoadingCount(false);
  }, [filters]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadAudience(), 250);
    return () => window.clearTimeout(timer);
  }, [loadAudience]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    if (!query.trim()) {
      setCandidates([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      const response = await fetch("/api/admin/line/audience", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const result = await response.json();
      setCandidates(response.ok && result.ok ? result.customers : []);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  function toggleFilter(key: keyof Filters, value: string) {
    setFilters((current) => ({
      ...current,
      [key]: current[key].includes(value)
        ? current[key].filter((item) => item !== value)
        : [...current[key], value],
    }));
  }

  async function sendMessages() {
    if (deliveryLockedRef.current || sending || deliveryCompleted) {
      return;
    }

    deliveryLockedRef.current = true;
    setSending(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/line/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, messageBody: body, targetLabel, filters }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        deliveryLockedRef.current = false;
        setMessage(result.message ?? "LINE配信に失敗しました。");
        return;
      }
      setDeliveryCompleted(true);
      setMessage(
        `配信が完了しました。成功 ${result.successCount}件 / 失敗 ${result.failureCount}件 / 対象外 ${result.excludedCount}件 / ログ保存 ${result.logSavedCount}件 / ログ保存失敗 ${result.logFailureCount}件`,
      );
      await loadAudience();
      await loadLogs();
    } catch {
      deliveryLockedRef.current = false;
      setMessage("通信に失敗しました。時間をおいてもう一度お試しください。");
    } finally {
      setSending(false);
      setConfirming(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <AdminHeader
        title="LINE配信"
        onRefresh={() => window.location.reload()}
      />
      <main className="mx-auto grid max-w-7xl gap-5 px-5 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-8">
        <div className="grid gap-5">
          {!configured ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
              LINE_CHANNEL_ACCESS_TOKEN が未設定です
            </div>
          ) : null}
          {message ? (
            <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800">
              {message}
            </div>
          ) : null}
          <section className="grid gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-bold">配信内容</h2>
            <label className="grid gap-2 text-sm font-semibold text-slate-700">
              配信タイトル
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="h-11 rounded-md border border-slate-300 px-3 text-base font-normal outline-none focus:border-blue-500" />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-slate-700">
              配信本文
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} maxLength={5000} className="rounded-md border border-slate-300 px-3 py-2 text-base font-normal outline-none focus:border-blue-500" />
            </label>
            <p className="text-xs leading-6 text-slate-500">
              使用可能: {"{{name}} {{phone}} {{vehicle_name}} {{plate_number}} {{shaken_expiry_date}} {{reservation_date}} {{age}}"}
            </p>
          </section>

          <section className="grid gap-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div>
              <h2 className="text-base font-bold">配信対象</h2>
              <p className="mt-1 text-sm text-slate-500">未選択の場合はLINE連携済み全員が対象です。</p>
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              {groups.map((group) => (
                <fieldset key={group.key} className="grid content-start gap-2">
                  <legend className="mb-2 text-sm font-bold text-slate-800">{group.title}</legend>
                  {group.options.map(([value, label]) => (
                    <label key={value} className="flex min-h-10 items-center gap-3 rounded-md border border-slate-200 px-3 text-sm font-medium">
                      <input type="checkbox" checked={filters[group.key].includes(value)} onChange={() => toggleFilter(group.key, value)} className="h-4 w-4 accent-blue-600" />
                      {label}
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
          </section>

          <section className="grid gap-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-bold">個別選択</h2>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="顧客名・電話番号・車両ナンバーで検索" className="h-11 rounded-md border border-slate-300 px-3 text-base outline-none focus:border-blue-500" />
            {candidates.length ? (
              <div className="grid max-h-64 gap-2 overflow-y-auto">
                {candidates.map((customer) => (
                  <label key={customer.id} className="flex items-start gap-3 rounded-md border border-slate-200 p-3 text-sm">
                    <input type="checkbox" checked={filters.customerIds.includes(customer.id)} onChange={() => toggleFilter("customerIds", customer.id)} className="mt-1 h-4 w-4 accent-blue-600" />
                    <span><strong>{customer.name}</strong><span className="block text-slate-500">{customer.phone} {customer.vehiclePlateNumbers.join(" / ")}</span></span>
                  </label>
                ))}
              </div>
            ) : null}
          </section>
        </div>

        <aside className="grid content-start gap-5 lg:sticky lg:top-5">
          <section className="rounded-lg border border-blue-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-bold text-slate-500">対象件数</p>
            <p className="mt-1 text-4xl font-black text-blue-700">{loadingCount ? "--" : `${count}件`}</p>
            <p className="mt-2 text-xs text-slate-500">LINE未連携の対象外: {excludedCount}件</p>
          </section>
          <section className="grid gap-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-bold">配信プレビュー</h2>
            <div className="min-h-48 whitespace-pre-wrap rounded-md bg-[#8cabd9] p-4 text-sm leading-6">
              <div className="ml-auto max-w-[90%] rounded-md bg-white p-3 shadow-sm">{previewMessage(body) || "配信本文を入力するとプレビューを表示します。"}</div>
            </div>
            <button type="button" disabled={deliveryCompleted || !configured || !title.trim() || !body.trim() || count === 0 || loadingCount} onClick={() => setConfirming(true)} className="h-12 rounded-md bg-blue-600 px-4 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300">{deliveryCompleted ? "配信済み" : "配信実行"}</button>
          </section>
          <section className="grid gap-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-bold">最近の配信結果</h2>
            <div className="grid gap-2">
              {logs.slice(0, 5).map((log) => (
                <div key={log.id} className="rounded-md border border-slate-200 p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-bold text-slate-900">{log.title}</p>
                    <span className={log.status === "成功" ? "rounded-md bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700" : "rounded-md bg-red-50 px-2 py-1 text-xs font-bold text-red-700"}>{log.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{log.target_type} / {new Intl.DateTimeFormat("ja-JP", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Tokyo" }).format(new Date(log.sent_at ?? log.created_at))}</p>
                  {log.error_message ? <p className="mt-2 text-xs text-red-600">{log.error_message}</p> : null}
                </div>
              ))}
              {!logs.length ? <p className="text-sm text-slate-500">配信履歴はありません。</p> : null}
            </div>
          </section>
        </aside>
      </main>

      {confirming ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-5" role="dialog" aria-modal="true" aria-labelledby="line-confirm-title">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 id="line-confirm-title" className="text-xl font-bold">LINE配信確認</h2>
            <dl className="mt-5 grid gap-4 text-sm"><div><dt className="font-semibold text-slate-500">対象</dt><dd className="mt-1 font-bold">{targetLabel}</dd></div><div><dt className="font-semibold text-slate-500">対象件数</dt><dd className="mt-1 text-2xl font-black text-blue-700">{count}件</dd></div></dl>
            <p className="mt-5 font-semibold">この内容で送信しますか？</p>
            <div className="mt-6 flex justify-end gap-3"><button type="button" disabled={sending} onClick={() => setConfirming(false)} className="h-10 rounded-md border border-slate-300 px-4 text-sm font-semibold">キャンセル</button><button type="button" disabled={sending || deliveryCompleted} onClick={() => void sendMessages()} className="h-10 rounded-md bg-blue-600 px-5 text-sm font-bold text-white disabled:bg-slate-400">{sending ? "送信中..." : deliveryCompleted ? "配信済み" : "送信する"}</button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
