"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminHeader } from "../admin-header";
import { LineAutomationSettings } from "./line-automation-settings";

type LineTab = "manual" | "automations" | "history";

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
  body: string;
  status: "成功" | "失敗";
  error_message: string | null;
  image_url: string | null;
  sent_at: string | null;
  created_at: string;
  automation_type: string | null;
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

const formatMessageLogDate = (log: MessageLog) =>
  new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(new Date(log.sent_at ?? log.created_at));

const getMessageDeliveryType = (log: MessageLog) => {
  if (log.automation_type || log.target_type.startsWith("自動配信")) {
    return "自動";
  }

  if (
    log.target_type.includes("個別") ||
    log.target_type === "LINE連携済み全員"
  ) {
    return "手動";
  }

  return "セグメント";
};

const acceptedImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const maxSelectedImageBytes = 10 * 1024 * 1024;
const maxPreparedImageBytes = 1024 * 1024;

const loadBrowserImage = (file: File) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new window.Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("画像を読み込めませんでした。"));
    };
    image.src = objectUrl;
  });

const canvasToJpeg = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("画像を変換できませんでした。")),
      "image/jpeg",
      quality,
    );
  });

async function prepareLineImage(file: File) {
  if (!acceptedImageTypes.has(file.type)) {
    throw new Error("jpg・jpeg・png・webp形式の画像を選択してください。");
  }
  if (file.size > maxSelectedImageBytes) {
    throw new Error("画像は10MB以内で選択してください。");
  }

  const source = await loadBrowserImage(file);
  const initialScale = Math.min(
    1,
    2048 / Math.max(source.naturalWidth, source.naturalHeight),
  );
  let scale = initialScale;
  let quality = 0.9;

  for (let attempt = 0; attempt < 7; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(source.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("画像を変換できませんでした。");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);

    const blob = await canvasToJpeg(canvas, quality);
    if (blob.size <= maxPreparedImageBytes) {
      const baseName = file.name.replace(/\.[^.]+$/, "") || "line-image";
      return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
    }
    scale *= 0.82;
    quality = Math.max(0.62, quality - 0.06);
  }

  throw new Error("画像を1MB以内に変換できませんでした。");
}

export function LineDistribution() {
  const [activeTab, setActiveTab] = useState<LineTab>("manual");
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState("");
  const [processingImage, setProcessingImage] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
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
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

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

  useEffect(
    () => () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    },
    [imagePreviewUrl],
  );

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

  async function handleImageChange(file: File | null) {
    if (!file) return;
    setProcessingImage(true);
    setMessage("");
    try {
      const prepared = await prepareLineImage(file);
      setImageFile(prepared);
      setImagePreviewUrl(URL.createObjectURL(prepared));
    } catch (error) {
      setImageFile(null);
      setImagePreviewUrl("");
      if (imageInputRef.current) imageInputRef.current.value = "";
      setMessage(
        error instanceof Error ? error.message : "画像の処理に失敗しました。",
      );
    } finally {
      setProcessingImage(false);
    }
  }

  function removeImage() {
    setImageFile(null);
    setImagePreviewUrl("");
    if (imageInputRef.current) imageInputRef.current.value = "";
  }

  async function sendMessages() {
    if (deliveryLockedRef.current || sending || deliveryCompleted) {
      return;
    }

    deliveryLockedRef.current = true;
    setSending(true);
    setMessage("");
    try {
      const payload = new FormData();
      payload.set("title", title);
      payload.set("messageBody", body);
      payload.set("targetLabel", targetLabel);
      payload.set("filters", JSON.stringify(filters));
      if (imageFile) payload.set("image", imageFile);

      const response = await fetch("/api/admin/line/send", {
        method: "POST",
        body: payload,
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
      <div className="border-b border-slate-200 bg-white">
        <nav
          className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-5 sm:px-6 lg:px-8"
          aria-label="LINE配信メニュー"
        >
          {(
            [
              ["manual", "手動配信"],
              ["automations", "自動配信設定"],
              ["history", "配信履歴"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setActiveTab(value)}
              className={`min-h-12 shrink-0 border-b-2 px-4 text-sm font-bold transition ${
                activeTab === value
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === "manual" ? (
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
            <div className="grid gap-2">
              <label className="text-sm font-semibold text-slate-700">
                添付画像
              </label>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                disabled={processingImage || deliveryCompleted}
                onChange={(event) =>
                  void handleImageChange(event.target.files?.[0] ?? null)
                }
                className="block w-full rounded-md border border-slate-300 bg-white text-sm text-slate-600 file:mr-4 file:h-11 file:cursor-pointer file:border-0 file:border-r file:border-slate-300 file:bg-slate-50 file:px-4 file:text-sm file:font-semibold file:text-blue-700 hover:file:bg-blue-50 disabled:opacity-50"
              />
              <p className="text-xs text-slate-500">
                jpg・jpeg・png・webp / 10MB以内 / 1枚
              </p>
              {processingImage ? (
                <p className="text-sm font-semibold text-blue-700">
                  画像を最適化しています...
                </p>
              ) : null}
              {imageFile ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm">
                  <span className="font-semibold text-blue-900">
                    {imageFile.name}（{Math.ceil(imageFile.size / 1024)}KB）
                  </span>
                  <button
                    type="button"
                    onClick={removeImage}
                    className="cursor-pointer font-semibold text-red-600 hover:text-red-700"
                  >
                    画像を削除
                  </button>
                </div>
              ) : null}
            </div>
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
              {body ? (
                <div className="ml-auto max-w-[90%] rounded-md bg-white p-3 shadow-sm">
                  {previewMessage(body)}
                </div>
              ) : null}
              {imagePreviewUrl ? (
                <div className="ml-auto mt-2 max-w-[90%] overflow-hidden rounded-md bg-white shadow-sm first:mt-0">
                  <Image
                    src={imagePreviewUrl}
                    alt="配信画像プレビュー"
                    width={640}
                    height={480}
                    unoptimized
                    className="h-auto max-h-80 w-full object-contain"
                  />
                </div>
              ) : null}
              {!body && !imagePreviewUrl ? (
                <div className="ml-auto max-w-[90%] rounded-md bg-white p-3 text-slate-500 shadow-sm">
                  本文または画像を設定するとプレビューを表示します。
                </div>
              ) : null}
            </div>
            <button type="button" disabled={deliveryCompleted || processingImage || !configured || !title.trim() || (!body.trim() && !imageFile) || count === 0 || loadingCount} onClick={() => setConfirming(true)} className="h-12 rounded-md bg-blue-600 px-4 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300">{deliveryCompleted ? "配信済み" : "配信実行"}</button>
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
                  {log.image_url ? (
                    <p className="mt-1 text-xs font-semibold text-blue-700">
                      画像あり
                    </p>
                  ) : null}
                  {log.error_message ? <p className="mt-2 text-xs text-red-600">{log.error_message}</p> : null}
                </div>
              ))}
              {!logs.length ? <p className="text-sm text-slate-500">配信履歴はありません。</p> : null}
            </div>
          </section>
        </aside>
        </main>
      ) : activeTab === "automations" ? (
        <LineAutomationSettings />
      ) : (
        <main className="mx-auto min-h-[640px] max-w-7xl px-5 py-6 sm:px-6 lg:px-8">
          <section className="grid gap-4 rounded-[5px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div>
              <h2 className="text-lg font-bold">配信履歴</h2>
              <p className="mt-1 text-sm text-slate-500">
                手動配信・テスト送信・自動配信の最新20件を表示します。
              </p>
            </div>
            <div className="grid gap-3">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="rounded-[5px] border border-slate-200 bg-white p-4 text-sm transition hover:border-blue-200"
                >
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900">{log.title}</p>
                      <p className="mt-1 text-slate-600">{log.target_type}</p>
                      {log.image_url ? (
                        <p className="mt-1 text-xs font-semibold text-blue-700">
                          画像あり
                        </p>
                      ) : null}
                      <p className="mt-1 text-xs text-slate-500">
                        {formatMessageLogDate(log)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      <span
                        className={
                          log.status === "成功"
                            ? "w-fit rounded-[5px] bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700"
                            : "w-fit rounded-[5px] bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700"
                        }
                      >
                        {log.status}
                      </span>
                      <button
                        type="button"
                        aria-expanded={expandedLogId === log.id}
                        onClick={() =>
                          setExpandedLogId((current) =>
                            current === log.id ? null : log.id,
                          )
                        }
                        className="h-9 rounded-[5px] border border-blue-200 bg-white px-3 text-xs font-bold text-blue-700 transition hover:bg-blue-50"
                      >
                        {expandedLogId === log.id ? "閉じる" : "詳細を見る"}
                      </button>
                    </div>
                  </div>
                  {expandedLogId === log.id ? (
                    <div className="mt-4 border-t border-slate-200 pt-4">
                      <dl className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <dt className="text-xs font-semibold text-slate-500">
                            送信日時
                          </dt>
                          <dd className="mt-1 font-semibold text-slate-900">
                            {formatMessageLogDate(log)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs font-semibold text-slate-500">
                            配信種別
                          </dt>
                          <dd className="mt-1 font-semibold text-slate-900">
                            {getMessageDeliveryType(log)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs font-semibold text-slate-500">
                            対象
                          </dt>
                          <dd className="mt-1 font-semibold text-slate-900">
                            {log.target_type}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs font-semibold text-slate-500">
                            タイトル
                          </dt>
                          <dd className="mt-1 font-semibold text-slate-900">
                            {log.title}
                          </dd>
                        </div>
                        <div className="sm:col-span-2">
                          <dt className="text-xs font-semibold text-slate-500">
                            本文
                          </dt>
                          <dd className="mt-1 whitespace-pre-wrap rounded-[5px] border border-slate-200 bg-slate-50 p-3 leading-6 text-slate-800">
                            {log.body || "本文なし"}
                          </dd>
                        </div>
                        {log.image_url ? (
                          <div className="sm:col-span-2">
                            <dt className="text-xs font-semibold text-slate-500">
                              画像
                            </dt>
                            <dd className="mt-2">
                              <a
                                href={log.image_url}
                                target="_blank"
                                rel="noreferrer"
                                className="block w-fit"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={log.image_url}
                                  alt={`${log.title}の配信画像`}
                                  className="max-h-80 w-auto max-w-full rounded-[5px] border border-slate-200 object-contain"
                                />
                              </a>
                            </dd>
                          </div>
                        ) : null}
                        {log.error_message ? (
                          <div>
                            <dt className="text-xs font-semibold text-slate-500">
                              エラーメッセージ
                            </dt>
                            <dd className="mt-1 whitespace-pre-wrap font-semibold text-red-700">
                              {log.error_message}
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                    </div>
                  ) : null}
                </div>
              ))}
              {!logs.length ? (
                <p className="py-10 text-center text-sm text-slate-500">
                  配信履歴はありません。
                </p>
              ) : null}
            </div>
          </section>
        </main>
      )}

      {activeTab === "manual" && confirming ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-5" role="dialog" aria-modal="true" aria-labelledby="line-confirm-title">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 id="line-confirm-title" className="text-xl font-bold">LINE配信確認</h2>
            <dl className="mt-5 grid gap-4 text-sm"><div><dt className="font-semibold text-slate-500">対象</dt><dd className="mt-1 font-bold">{targetLabel}</dd></div><div><dt className="font-semibold text-slate-500">配信内容</dt><dd className="mt-1 font-bold">{body.trim() ? "テキスト" : ""}{body.trim() && imageFile ? " ＋ " : ""}{imageFile ? "画像" : ""}</dd></div><div><dt className="font-semibold text-slate-500">対象件数</dt><dd className="mt-1 text-2xl font-black text-blue-700">{count}件</dd></div></dl>
            <p className="mt-5 font-semibold">この内容で送信しますか？</p>
            <div className="mt-6 flex justify-end gap-3"><button type="button" disabled={sending} onClick={() => setConfirming(false)} className="h-10 rounded-md border border-slate-300 px-4 text-sm font-semibold">キャンセル</button><button type="button" disabled={sending || deliveryCompleted} onClick={() => void sendMessages()} className="h-10 rounded-md bg-blue-600 px-5 text-sm font-bold text-white disabled:bg-slate-400">{sending ? "送信中..." : deliveryCompleted ? "配信済み" : "送信する"}</button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
