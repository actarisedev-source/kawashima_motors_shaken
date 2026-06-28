"use client";

import { useCallback, useEffect, useState } from "react";

type AutomationType =
  | "shaken_60_days"
  | "shaken_30_days"
  | "reservation_previous_day"
  | "reservation_completion";

type AutomationSetting = {
  id: string;
  automation_type: AutomationType;
  enabled: boolean;
  title: string;
  body: string;
  send_time: string;
  last_run_at: string | null;
  next_run_at: string | null;
  preview: { count: number; duplicateCount: number };
};

const labels: Record<AutomationType, string> = {
  shaken_60_days: "車検満了60日前通知",
  shaken_30_days: "車検満了30日前通知",
  reservation_previous_day: "予約前日リマインド",
  reservation_completion: "予約完了通知",
};

const descriptions: Record<AutomationType, string> = {
  shaken_60_days: "今日から60日後が車検満了日の車両へ配信します。",
  shaken_30_days: "今日から30日後が車検満了日の車両へ配信します。",
  reservation_previous_day: "翌日の受付中・確定予約へ配信します。",
  reservation_completion: "予約フォームで予約が正常に登録された直後に配信します。",
};

const formatDateTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "Asia/Tokyo",
      }).format(new Date(value))
    : "未実行";

export function LineAutomationSettings() {
  const [settings, setSettings] = useState<AutomationSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingType, setSavingType] = useState<AutomationType | null>(null);
  const [testingType, setTestingType] = useState<AutomationType | null>(null);
  const [message, setMessage] = useState("");

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/line/automations", {
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        setMessage(result.message ?? "自動配信設定の取得に失敗しました。");
        return;
      }
      setSettings(result.settings ?? []);
    } catch {
      setMessage("自動配信設定の取得に失敗しました。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const updateSetting = <K extends keyof AutomationSetting>(
    automationType: AutomationType,
    key: K,
    value: AutomationSetting[K],
  ) => {
    setSettings((current) =>
      current.map((setting) =>
        setting.automation_type === automationType
          ? { ...setting, [key]: value }
          : setting,
      ),
    );
  };

  const saveSetting = async (setting: AutomationSetting, showMessage = true) => {
    setSavingType(setting.automation_type);
    if (showMessage) setMessage("");
    try {
      const response = await fetch("/api/admin/line/automations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          automationType: setting.automation_type,
          enabled: setting.enabled,
          title: setting.title,
          body: setting.body,
          sendTime: setting.send_time,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        setMessage(result.message ?? "設定の保存に失敗しました。");
        return false;
      }
      if (showMessage) setMessage(`${labels[setting.automation_type]}を保存しました。`);
      return true;
    } catch {
      setMessage("設定の保存に失敗しました。");
      return false;
    } finally {
      setSavingType(null);
    }
  };

  const testSetting = async (setting: AutomationSetting) => {
    if (
      !window.confirm(
        `${labels[setting.automation_type]}の対象顧客1件へテスト送信します。よろしいですか？`,
      )
    ) {
      return;
    }
    const saved = await saveSetting(setting, false);
    if (!saved) return;
    setTestingType(setting.automation_type);
    setMessage("");
    try {
      const response = await fetch("/api/admin/line/automations/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ automationType: setting.automation_type }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        setMessage(result.message ?? "テスト送信に失敗しました。");
        return;
      }
      await loadSettings();
      setMessage(
        `テスト送信が完了しました。成功 ${result.successCount}件 / 失敗 ${result.failureCount}件`,
      );
    } catch {
      setMessage("テスト送信に失敗しました。");
    } finally {
      setTestingType(null);
    }
  };

  if (loading) {
    return (
      <main className="mx-auto min-h-[640px] max-w-7xl px-5 py-6 sm:px-6 lg:px-8">
        <p className="text-sm font-semibold text-slate-500">自動配信設定を読み込み中です。</p>
      </main>
    );
  }

  return (
    <main className="mx-auto grid max-w-7xl gap-5 px-5 py-6 sm:px-6 lg:px-8">
      {message ? (
        <div className="rounded-[5px] border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800">
          {message}
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-bold">自動配信設定</h2>
        <p className="text-sm text-slate-500">
          予約完了通知は予約直後に、それ以外は指定時刻以降のCron実行時に配信されます。
        </p>
      </div>
      <div className="grid gap-5">
        {settings.map((setting) => (
          <section
            key={setting.id}
            className="grid gap-5 rounded-[5px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-base font-bold">{labels[setting.automation_type]}</h3>
                <p className="mt-1 text-sm text-slate-500">
                  {descriptions[setting.automation_type]}
                </p>
              </div>
              <label className="flex items-center gap-3 text-sm font-bold text-slate-700">
                <span>{setting.enabled ? "有効" : "無効"}</span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={setting.enabled}
                  onChange={(event) =>
                    updateSetting(
                      setting.automation_type,
                      "enabled",
                      event.target.checked,
                    )
                  }
                  className="h-5 w-5 accent-blue-600"
                />
              </label>
            </div>

            <div
              className={
                setting.automation_type === "reservation_completion"
                  ? "grid gap-4"
                  : "grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]"
              }
            >
              <div className="grid gap-4">
                {setting.automation_type !== "reservation_completion" ? (
                  <label className="grid gap-2 text-sm font-semibold text-slate-700">
                    配信タイトル
                    <input
                      value={setting.title}
                      onChange={(event) =>
                        updateSetting(
                          setting.automation_type,
                          "title",
                          event.target.value,
                        )
                      }
                      className="h-11 rounded-[5px] border border-slate-300 px-3 text-base font-normal outline-none focus:border-blue-500"
                    />
                  </label>
                ) : null}
                <label className="grid gap-2 text-sm font-semibold text-slate-700">
                  {setting.automation_type === "reservation_completion"
                    ? "メッセージ本文"
                    : "配信本文"}
                  <textarea
                    value={setting.body}
                    onChange={(event) =>
                      updateSetting(
                        setting.automation_type,
                        "body",
                        event.target.value,
                      )
                    }
                    rows={12}
                    maxLength={5000}
                    className="rounded-[5px] border border-slate-300 px-3 py-2 text-base font-normal leading-7 outline-none focus:border-blue-500"
                  />
                </label>
                <p className="text-xs leading-6 text-slate-500">
                  使用可能: {setting.automation_type === "reservation_completion"
                    ? "{{reservation_datetime}} {{customer_name}} {{vehicle_name}} {{plate_number}}"
                    : "{{name}} {{phone}} {{vehicle_name}} {{plate_number}} {{shaken_expiry_date}} {{reservation_date}}"}
                </p>
              </div>

              {setting.automation_type !== "reservation_completion" ? (
                <aside className="grid content-start gap-4">
                <label className="grid gap-2 text-sm font-semibold text-slate-700">
                  配信時刻
                  <input
                    type="time"
                    value={setting.send_time}
                    onChange={(event) =>
                      updateSetting(
                        setting.automation_type,
                        "send_time",
                        event.target.value,
                      )
                    }
                    className="h-11 rounded-[5px] border border-slate-300 px-3 text-base font-normal outline-none focus:border-blue-500"
                  />
                </label>
                <dl className="grid gap-3 rounded-[5px] border border-slate-200 bg-slate-50 p-4 text-sm">
                  <div>
                    <dt className="font-semibold text-slate-500">対象件数プレビュー</dt>
                    <dd className="mt-1 text-2xl font-black text-blue-700">
                      {setting.preview.count}件
                    </dd>
                    {setting.preview.duplicateCount ? (
                      <p className="mt-1 text-xs text-slate-500">
                        本日送信済み {setting.preview.duplicateCount}件を除外
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-500">最終実行日時</dt>
                    <dd className="mt-1 font-bold">{formatDateTime(setting.last_run_at)}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-500">次回実行予定日時</dt>
                    <dd className="mt-1 font-bold">
                      {setting.next_run_at ? formatDateTime(setting.next_run_at) : "無効"}
                    </dd>
                  </div>
                </dl>
                <button
                  type="button"
                  disabled={
                    testingType === setting.automation_type ||
                    savingType === setting.automation_type
                  }
                  onClick={() => void testSetting(setting)}
                  className="h-11 rounded-[5px] border border-blue-200 bg-white px-4 text-sm font-bold text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                >
                  {testingType === setting.automation_type
                    ? "テスト送信中..."
                    : "対象1件へテスト送信"}
                </button>
                <button
                  type="button"
                  disabled={savingType === setting.automation_type}
                  onClick={() => void saveSetting(setting)}
                  className="h-11 rounded-[5px] bg-blue-600 px-4 text-sm font-bold text-white transition hover:bg-blue-700 disabled:bg-slate-300"
                >
                  {savingType === setting.automation_type ? "保存中..." : "保存"}
                </button>
                </aside>
              ) : (
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={savingType === setting.automation_type}
                    onClick={() => void saveSetting(setting)}
                    className="h-11 min-w-32 rounded-[5px] bg-blue-600 px-4 text-sm font-bold text-white transition hover:bg-blue-700 disabled:bg-slate-300"
                  >
                    {savingType === setting.automation_type ? "保存中..." : "保存"}
                  </button>
                </div>
              )}
            </div>
          </section>
        ))}
      </div>
      {!settings.length ? (
        <div className="rounded-[5px] border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-800">
          自動配信設定がありません。先に本番DB用SQLを適用してください。
        </div>
      ) : null}
    </main>
  );
}
