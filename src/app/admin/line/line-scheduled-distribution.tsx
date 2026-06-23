"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { prepareLineImage } from "./line-image-client";

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
  vehiclePlateNumbers: string[];
};

type ScheduledMessage = {
  id: string;
  title: string;
  body: string;
  image_url: string | null;
  target_label: string;
  target_count: number;
  scheduled_at: string;
  status: "予約中" | "送信済み" | "取消済み" | "失敗";
  error_message: string | null;
  sent_at: string | null;
  cancelled_at: string | null;
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

const todayInJapan = () =>
  new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(new Date());

const scheduledTimeOptions = Array.from(
  { length: 13 },
  (_, index) => `${String(index + 8).padStart(2, "0")}:00`,
);

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  }).format(new Date(value));

const statusClasses: Record<ScheduledMessage["status"], string> = {
  予約中: "bg-blue-50 text-blue-700",
  送信済み: "bg-emerald-50 text-emerald-700",
  取消済み: "bg-slate-100 text-slate-600",
  失敗: "bg-red-50 text-red-700",
};

export function LineScheduledDistribution() {
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState("");
  const [processingImage, setProcessingImage] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<CustomerOption[]>([]);
  const [count, setCount] = useState(0);
  const [loadingCount, setLoadingCount] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [messages, setMessages] = useState<ScheduledMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState({ date: "", time: "", content: "" });
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pendingCancel, setPendingCancel] = useState<ScheduledMessage | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const confirmCancelRef = useRef<HTMLButtonElement>(null);
  const cancelDialogRef = useRef<HTMLButtonElement>(null);

  const targetLabel = useMemo(() => {
    const labels = groups.flatMap((group) =>
      group.options
        .filter(([value]) => filters[group.key].includes(value))
        .map(([, label]) => label),
    );
    if (filters.customerIds.length) labels.push(`個別${filters.customerIds.length}件`);
    return labels.length ? labels.join("、") : "LINE連携済み全員";
  }, [filters]);

  const scheduledDateTime = useMemo(() => {
    if (!scheduledDate || !scheduledTime) return "未設定";
    const value = new Date(`${scheduledDate}T${scheduledTime}:00+09:00`);
    return Number.isNaN(value.getTime()) ? "未設定" : formatDateTime(value.toISOString());
  }, [scheduledDate, scheduledTime]);
  const previewBody = body || (!imageFile ? title : "");

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
      setConfigured(result.configured);
    } else {
      setMessage(result.message ?? "対象件数の取得に失敗しました。");
    }
    setLoadingCount(false);
  }, [filters]);

  const loadScheduledMessages = useCallback(async () => {
    setLoadingMessages(true);
    const response = await fetch("/api/admin/line/scheduled", {
      cache: "no-store",
    });
    const result = await response.json();
    if (response.ok && result.ok) {
      setMessages(result.messages ?? []);
    } else {
      setMessage(result.message ?? "予約済み配信の取得に失敗しました。");
    }
    setLoadingMessages(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadAudience(), 250);
    return () => window.clearTimeout(timer);
  }, [loadAudience]);

  useEffect(() => {
    void loadScheduledMessages();
  }, [loadScheduledMessages]);

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

  useEffect(() => {
    if (confirming) confirmCancelRef.current?.focus();
  }, [confirming]);

  useEffect(() => {
    if (pendingCancel) cancelDialogRef.current?.focus();
  }, [pendingCancel]);

  useEffect(
    () => () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    },
    [imagePreviewUrl],
  );

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
      setErrors((current) => ({ ...current, content: "" }));
    } catch (error) {
      setImageFile(null);
      setImagePreviewUrl("");
      if (imageInputRef.current) imageInputRef.current.value = "";
      setMessage(error instanceof Error ? error.message : "画像の処理に失敗しました。");
    } finally {
      setProcessingImage(false);
    }
  }

  function removeImage() {
    setImageFile(null);
    setImagePreviewUrl("");
    if (imageInputRef.current) imageInputRef.current.value = "";
  }

  function openConfirmation() {
    const nextErrors = { date: "", time: "", content: "" };
    if (!scheduledDate) nextErrors.date = "配信日を選択してください。";
    if (!scheduledTime) nextErrors.time = "配信時刻を選択してください。";
    if (!title.trim() && !body.trim() && !imageFile) {
      nextErrors.content = "配信タイトル、本文、画像のいずれかを入力してください。";
    }
    if (scheduledDate && scheduledTime) {
      const date = new Date(`${scheduledDate}T${scheduledTime}:00+09:00`);
      if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
        nextErrors.time = "過去の日時は予約できません。";
      }
    }
    setErrors(nextErrors);
    if (nextErrors.date || nextErrors.time || nextErrors.content) return;
    if (count === 0) {
      setMessage("対象件数が0件のため予約できません。");
      return;
    }
    setMessage("");
    setConfirming(true);
  }

  async function scheduleMessage() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const payload = new FormData();
      payload.set("scheduledDate", scheduledDate);
      payload.set("scheduledTime", scheduledTime);
      payload.set("title", title);
      payload.set("messageBody", body);
      payload.set("targetLabel", targetLabel);
      payload.set("filters", JSON.stringify(filters));
      if (imageFile) payload.set("image", imageFile);
      const response = await fetch("/api/admin/line/scheduled", {
        method: "POST",
        body: payload,
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        setMessage(result.message ?? "予約配信の登録に失敗しました。");
        return;
      }
      setMessage("LINE予約配信を登録しました。");
      setConfirming(false);
      setScheduledDate("");
      setScheduledTime("");
      setTitle("");
      setBody("");
      removeImage();
      await loadScheduledMessages();
    } catch {
      setMessage("通信に失敗しました。時間をおいてもう一度お試しください。");
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelScheduledMessage() {
    if (!pendingCancel || cancelling) return;
    setCancelling(true);
    try {
      const response = await fetch(`/api/admin/line/scheduled/${pendingCancel.id}`, {
        method: "DELETE",
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        setMessage(result.message ?? "予約配信の取消に失敗しました。");
        return;
      }
      setMessages((current) =>
        current.map((item) =>
          item.id === pendingCancel.id
            ? { ...item, status: "取消済み", cancelled_at: result.message.cancelled_at }
            : item,
        ),
      );
      setMessage("予約配信を取り消しました。");
      setPendingCancel(null);
    } catch {
      setMessage("通信に失敗しました。時間をおいてもう一度お試しください。");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <main className="mx-auto grid max-w-7xl gap-5 px-5 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-8">
      {message ? (
        <p className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800 lg:col-span-2">
          {message}
        </p>
      ) : null}

      <div className="grid content-start gap-5">
        {!configured ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
            LINE_CHANNEL_ACCESS_TOKEN が未設定です
          </p>
        ) : null}

        <section className="grid gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-bold">配信日時</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-sm font-semibold text-slate-700">
              配信日
              <input
                type="date"
                min={todayInJapan()}
                value={scheduledDate}
                onChange={(event) => {
                  setScheduledDate(event.target.value);
                  setErrors((current) => ({ ...current, date: "" }));
                }}
                className={`h-11 rounded-md border px-3 text-base font-normal outline-none focus:border-blue-500 ${errors.date ? "border-red-400" : "border-slate-300"}`}
              />
              <span className="min-h-5 text-xs font-semibold text-red-600">{errors.date}</span>
            </label>
            <label className="grid gap-2 text-sm font-semibold text-slate-700">
              配信時刻
              <select
                value={scheduledTime}
                onChange={(event) => {
                  setScheduledTime(event.target.value);
                  setErrors((current) => ({ ...current, time: "" }));
                }}
                className={`h-11 rounded-md border px-3 text-base font-normal outline-none focus:border-blue-500 ${errors.time ? "border-red-400" : "border-slate-300"}`}
              >
                <option value="">時刻を選択</option>
                {scheduledTimeOptions.map((time) => (
                  <option key={time} value={time}>
                    {time}
                  </option>
                ))}
              </select>
              <span className="min-h-5 text-xs font-semibold text-red-600">{errors.time}</span>
            </label>
          </div>
          <p className="text-xs leading-5 text-slate-500">
            日本時間で指定してください。<br />
            予約配信は毎時0分に確認し、指定時刻以降に送信されます。
          </p>
        </section>

        <section className="grid gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-bold">配信内容</h2>
          <label className="grid gap-2 text-sm font-semibold text-slate-700">
            配信タイトル
            <input value={title} onChange={(event) => { setTitle(event.target.value); setErrors((current) => ({ ...current, content: "" })); }} className="h-11 rounded-md border border-slate-300 px-3 text-base font-normal outline-none focus:border-blue-500" />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-slate-700">
            配信本文
            <textarea value={body} onChange={(event) => { setBody(event.target.value); setErrors((current) => ({ ...current, content: "" })); }} rows={10} maxLength={5000} className="rounded-md border border-slate-300 px-3 py-2 text-base font-normal outline-none focus:border-blue-500" />
          </label>
          <div className="grid gap-2">
            <label className="text-sm font-semibold text-slate-700">添付画像</label>
            <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" disabled={processingImage} onChange={(event) => void handleImageChange(event.target.files?.[0] ?? null)} className="block w-full rounded-md border border-slate-300 bg-white text-sm text-slate-600 file:mr-4 file:h-11 file:cursor-pointer file:border-0 file:border-r file:border-slate-300 file:bg-slate-50 file:px-4 file:text-sm file:font-semibold file:text-blue-700 hover:file:bg-blue-50" />
            <p className="text-xs text-slate-500">jpg・jpeg・png・webp / 10MB以内 / 1枚</p>
            {processingImage ? <p className="text-sm font-semibold text-blue-700">画像を最適化しています...</p> : null}
            {imageFile ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm">
                <span className="font-semibold text-blue-900">{imageFile.name}（{Math.ceil(imageFile.size / 1024)}KB）</span>
                <button type="button" onClick={removeImage} className="font-semibold text-red-600 hover:text-red-700">画像を削除</button>
              </div>
            ) : null}
          </div>
          <span className="min-h-5 text-xs font-semibold text-red-600">{errors.content}</span>
          <p className="text-xs leading-6 text-slate-500">
            使用可能: {"{{name}} {{phone}} {{vehicle_name}} {{plate_number}} {{shaken_expiry_date}} {{reservation_date}} {{age}}"}
          </p>
        </section>

        <section className="grid gap-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <h2 className="text-base font-bold">配信対象条件</h2>
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
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="顧客名・電話番号・車両ナンバーで検索" className="h-11 rounded-md border border-slate-300 px-3 text-base outline-none focus:border-blue-500" />
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
          <p className="text-sm font-bold text-slate-500">予約配信日時</p>
          <p className="mt-1 text-lg font-black text-slate-900">{scheduledDateTime}</p>
          <p className="mt-5 text-sm font-bold text-slate-500">対象件数</p>
          <p className="mt-1 text-4xl font-black text-blue-700">{loadingCount ? "--" : `${count}件`}</p>
        </section>
        <section className="grid gap-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-bold">配信プレビュー</h2>
          <div className="min-h-48 whitespace-pre-wrap rounded-md bg-[#8cabd9] p-4 text-sm leading-6">
            {previewBody ? <div className="ml-auto max-w-[90%] rounded-md bg-white p-3 shadow-sm">{previewMessage(previewBody)}</div> : null}
            {imagePreviewUrl ? (
              <div className="ml-auto mt-2 max-w-[90%] overflow-hidden rounded-md bg-white shadow-sm first:mt-0">
                <Image src={imagePreviewUrl} alt="予約配信画像プレビュー" width={640} height={480} unoptimized className="h-auto max-h-80 w-full object-contain" />
              </div>
            ) : null}
            {!previewBody && !imagePreviewUrl ? <div className="ml-auto max-w-[90%] rounded-md bg-white p-3 text-slate-500 shadow-sm">本文または画像を設定するとプレビューを表示します。</div> : null}
          </div>
          <button type="button" disabled={processingImage || !configured || count === 0 || loadingCount} onClick={openConfirmation} className="h-12 rounded-md bg-blue-600 px-4 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300">予約する</button>
        </section>
      </aside>

      <section className="grid gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
        <div>
          <h2 className="text-lg font-bold">予約済み配信一覧</h2>
          <p className="mt-1 text-sm text-slate-500">送信予定と実行結果を新しい順に表示します。</p>
        </div>
        {loadingMessages ? (
          <p className="py-8 text-center text-sm text-slate-500">読み込み中です。</p>
        ) : messages.length ? (
          <div className="grid gap-3">
            {messages.map((item) => (
              <article key={item.id} className="grid gap-3 rounded-md border border-slate-200 p-4 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] md:items-center">
                <div>
                  <p className="text-xs font-semibold text-slate-500">配信予定日時</p>
                  <p className="mt-1 font-bold">{formatDateTime(item.scheduled_at)}</p>
                  <p className="mt-1 text-sm text-slate-700">{item.title}</p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><p className="text-xs font-semibold text-slate-500">対象件数</p><p className="mt-1 font-bold">{item.target_count}件</p></div>
                  <div><p className="text-xs font-semibold text-slate-500">画像</p><p className="mt-1 font-bold">{item.image_url ? "画像あり" : "なし"}</p></div>
                  <div className="col-span-2"><p className="text-xs font-semibold text-slate-500">作成日時</p><p className="mt-1 font-bold">{formatDateTime(item.created_at)}</p></div>
                  {item.error_message ? <p className="col-span-2 text-xs font-semibold text-red-700">{item.error_message}</p> : null}
                </div>
                <div className="flex min-h-9 flex-nowrap items-center gap-2 md:w-40 md:justify-end md:self-center">
                  <span className={`inline-flex h-9 min-w-[72px] shrink-0 items-center justify-center rounded-md px-2.5 text-xs font-bold ${statusClasses[item.status]}`}>{item.status}</span>
                  {item.status === "予約中" ? <button type="button" onClick={() => setPendingCancel(item)} className="relative z-10 h-9 min-w-[72px] shrink-0 rounded-md border border-red-300 bg-white px-3 text-sm font-bold text-red-600 hover:bg-red-50">取消</button> : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-slate-500">予約済みの配信はありません。</p>
        )}
      </section>

      {confirming ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-5" role="dialog" aria-modal="true" aria-labelledby="scheduled-confirm-title">
          <div className="w-full max-w-md rounded-md bg-white p-6 shadow-xl">
            <h2 id="scheduled-confirm-title" className="text-xl font-bold">LINE予約配信を登録しますか？</h2>
            <p className="mt-4 text-sm text-slate-600">以下の内容で予約配信を登録します。</p>
            <dl className="mt-4 grid gap-4 text-sm">
              <div><dt className="font-semibold text-slate-500">配信日時</dt><dd className="mt-1 font-bold">{scheduledDateTime}</dd></div>
              <div><dt className="font-semibold text-slate-500">対象件数</dt><dd className="mt-1 text-2xl font-black text-blue-700">{count}件</dd></div>
              <div><dt className="font-semibold text-slate-500">配信タイトル</dt><dd className="mt-1 font-bold">{title || "自動設定"}</dd></div>
            </dl>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button ref={confirmCancelRef} type="button" disabled={submitting} onClick={() => setConfirming(false)} className="h-11 rounded-md border border-slate-300 px-4 text-sm font-semibold hover:bg-slate-50">キャンセル</button>
              <button type="button" disabled={submitting} onClick={() => void scheduleMessage()} className="h-11 rounded-md bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700 disabled:bg-slate-300">{submitting ? "登録中..." : "予約する"}</button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingCancel ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-5" role="dialog" aria-modal="true" aria-labelledby="scheduled-cancel-title">
          <div className="w-full max-w-md rounded-md bg-white p-6 shadow-xl">
            <h2 id="scheduled-cancel-title" className="text-xl font-bold">予約配信を取り消しますか？</h2>
            <p className="mt-4 text-sm text-slate-600">この予約配信は送信されません。</p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button ref={cancelDialogRef} type="button" disabled={cancelling} onClick={() => setPendingCancel(null)} className="h-11 rounded-md border border-slate-300 px-4 text-sm font-semibold hover:bg-slate-50">キャンセル</button>
              <button type="button" disabled={cancelling} onClick={() => void cancelScheduledMessage()} className="h-11 rounded-md bg-red-600 px-4 text-sm font-bold text-white hover:bg-red-700 disabled:bg-red-300">{cancelling ? "取消中..." : "取り消す"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
