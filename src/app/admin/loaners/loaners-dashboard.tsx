"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  loanerCategories,
  loanerCategoryLabels,
  type LoanerCategory,
  type LoanerVehicle,
} from "@/lib/loaners/loaner-vehicle";
import {
  formatLoanerDate,
  getLoanerReturnDateKey,
} from "@/lib/loaners/loaner-period";
import {
  emptyLoanerFleetSummary,
  filterLoanerFleetByStatus,
  getLoanerFleetStatus,
  getRepresentativeLoanerAssignment,
  isLoanerAssignmentCurrent,
  summarizeLoanerFleet,
  type LoanerFleetAssignment,
  type LoanerFleetSummary,
  type LoanerFleetStatus,
} from "@/lib/loaners/loaner-summary";
import { AdminHeader } from "../admin-header";
import { LoanerCategoryBadge } from "./loaner-category-badge";
import { LoanerAdminTabs } from "./loaner-admin-tabs";
import { LoanerVehicleModal } from "./loaner-vehicle-modal";

type LoadState =
  | { status: "loading"; message: "読み込み中です。" }
  | { status: "ready"; message: "" }
  | { status: "error"; message: string };
type PendingAction = {
  type: "activate" | "deactivate" | "delete";
  item: LoanerVehicle;
};

const actionCopy = (action: PendingAction) => {
  if (action.type === "delete") {
    return {
      title: "代車を削除しますか？",
      body: "この代車を削除します。よろしいですか？通常は削除せず、使用停止での管理をおすすめします。",
      button: "削除する",
    };
  }
  if (action.type === "deactivate") {
    return {
      title: "代車を使用停止にしますか？",
      body: "この代車を使用停止にします。よろしいですか？",
      button: "使用停止にする",
    };
  }
  return {
    title: "代車を使用可能に戻しますか？",
    body: "この代車を使用可能に戻します。よろしいですか？",
    button: "使用可能に戻す",
  };
};

const loanerFleetStatusLabels: Record<LoanerFleetStatus, string> = {
  loaned: "貸出中",
  available: "空車",
  inactive: "使用停止",
};

const loanerFleetStatusBadgeClasses: Record<LoanerFleetStatus, string> = {
  loaned: "bg-orange-50 text-orange-700 ring-orange-200",
  available: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  inactive: "bg-slate-200 text-slate-600 ring-slate-300",
};

const getJstDateKey = (value: string) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));

export function LoanersDashboard() {
  const [items, setItems] = useState<LoanerVehicle[]>([]);
  const [checkedOutAssignments, setCheckedOutAssignments] = useState<
    LoanerFleetAssignment[]
  >([]);
  const [referenceNow, setReferenceNow] = useState(() => new Date().toISOString());
  const [summary, setSummary] = useState<LoanerFleetSummary>(
    emptyLoanerFleetSummary,
  );
  const [suggestedSortOrder, setSuggestedSortOrder] = useState(10);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [isQueryComposing, setIsQueryComposing] = useState(false);
  const [category, setCategory] = useState<LoanerCategory | "all">("all");
  const [status, setStatus] = useState<LoanerFleetStatus | "all">("all");
  const [loadState, setLoadState] = useState<LoadState>({
    status: "loading",
    message: "読み込み中です。",
  });
  const [editingItem, setEditingItem] = useState<LoanerVehicle | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const assignmentsByVehicleId = useMemo(() => {
    const map = new Map<string, LoanerFleetAssignment[]>();
    for (const assignment of checkedOutAssignments) {
      const current = map.get(assignment.loanerVehicleId) ?? [];
      current.push(assignment);
      map.set(assignment.loanerVehicleId, current);
    }
    return map;
  }, [checkedOutAssignments]);
  const representativeAssignmentMap = useMemo(() => {
    const map = new Map<string, LoanerFleetAssignment>();
    for (const [vehicleId, assignments] of assignmentsByVehicleId) {
      const assignment = getRepresentativeLoanerAssignment(assignments, referenceNow);
      if (assignment) map.set(vehicleId, assignment);
    }
    return map;
  }, [assignmentsByVehicleId, referenceNow]);
  const currentLoanedIdSet = useMemo(
    () =>
      new Set(
        checkedOutAssignments
          .filter((assignment) => isLoanerAssignmentCurrent(assignment, referenceNow))
          .map((assignment) => assignment.loanerVehicleId),
      ),
    [checkedOutAssignments, referenceNow],
  );
  const displayedItems = useMemo(
    () => filterLoanerFleetByStatus(items, currentLoanedIdSet, status),
    [currentLoanedIdSet, items, status],
  );

  useEffect(() => {
    if (isQueryComposing) return;

    const timer = window.setTimeout(() => {
      setQuery(queryInput.trim());
    }, 350);

    return () => window.clearTimeout(timer);
  }, [isQueryComposing, queryInput]);

  const loadLoaners = useCallback(
    async (signal?: AbortSignal) => {
      setLoadState({ status: "loading", message: "読み込み中です。" });
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (category !== "all") params.set("category", category);

      try {
        const listUrl = `/api/admin/loaners${params.size ? `?${params}` : ""}`;
        const [response, allVehiclesResponse] =
          await Promise.all([
            fetch(listUrl, { cache: "no-store", signal }),
            params.size
              ? fetch("/api/admin/loaners", { cache: "no-store", signal })
              : Promise.resolve(null),
          ]);
        const result = (await response.json()) as {
          ok: boolean;
          items?: LoanerVehicle[];
          checkedOutAssignments?: LoanerFleetAssignment[];
          referenceNow?: string;
          suggestedNextSortOrder?: number;
          message?: string;
        };
        const allVehiclesResult = allVehiclesResponse
          ? ((await allVehiclesResponse.json()) as {
              ok: boolean;
              items?: LoanerVehicle[];
              checkedOutAssignments?: LoanerFleetAssignment[];
              referenceNow?: string;
              message?: string;
            })
          : result;

        if (
          !response.ok ||
          !result.ok ||
          !result.items ||
          (allVehiclesResponse && !allVehiclesResponse.ok) ||
          !allVehiclesResult.ok ||
          !allVehiclesResult.items
        ) {
          setLoadState({
            status: "error",
            message:
              result.message ??
              allVehiclesResult.message ??
              "代車一覧の取得に失敗しました。",
          });
          return;
        }

        const checkedOutItems =
          allVehiclesResult.checkedOutAssignments ?? result.checkedOutAssignments ?? [];
        const nextReferenceNow =
          allVehiclesResult.referenceNow ?? result.referenceNow ?? new Date().toISOString();
        setItems(result.items);
        setCheckedOutAssignments(checkedOutItems);
        setReferenceNow(nextReferenceNow);
        setSummary(
          summarizeLoanerFleet(
            allVehiclesResult.items,
            checkedOutItems
              .filter((item) => isLoanerAssignmentCurrent(item, nextReferenceNow))
              .map((item) => item.loanerVehicleId),
          ),
        );
        setSuggestedSortOrder(result.suggestedNextSortOrder ?? 10);
        setLoadState({ status: "ready", message: "" });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadState({ status: "error", message: "代車一覧の取得に失敗しました。" });
      }
    },
    [category, query],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadLoaners(controller.signal);
    return () => controller.abort();
  }, [loadLoaners]);

  function clearFilters() {
    setQueryInput("");
    setQuery("");
    setCategory("all");
    setStatus("all");
  }

  function openCreateModal() {
    setEditingItem(null);
    setModalOpen(true);
  }

  function openEditModal(item: LoanerVehicle) {
    setEditingItem(item);
    setModalOpen(true);
  }

  async function handleSaved(message: string) {
    setModalOpen(false);
    setEditingItem(null);
    setNotice(message);
    await loadLoaners();
  }

  async function runPendingAction() {
    if (!pendingAction || actionSubmitting) return;
    setActionSubmitting(true);
    const isDelete = pendingAction.type === "delete";
    const response = await fetch(`/api/admin/loaners/${pendingAction.item.id}`, {
      method: isDelete ? "DELETE" : "PATCH",
      headers: isDelete ? undefined : { "Content-Type": "application/json" },
      body: isDelete
        ? undefined
        : JSON.stringify({ isActive: pendingAction.type === "activate" }),
    });
    const result = (await response.json()) as { ok: boolean; message?: string };

    if (!response.ok || !result.ok) {
      setLoadState({
        status: "error",
        message: result.message ?? (isDelete ? "代車の削除に失敗しました。" : "代車の保存に失敗しました。"),
      });
      setActionSubmitting(false);
      setPendingAction(null);
      return;
    }

    setNotice(
      isDelete
        ? "代車を削除しました。"
        : pendingAction.type === "activate"
          ? "代車を使用可能に戻しました。"
          : "代車を使用停止にしました。",
    );
    setActionSubmitting(false);
    setPendingAction(null);
    await loadLoaners();
  }

  function renderFleetStatusBadge(item: LoanerVehicle) {
    const fleetStatus = getLoanerFleetStatus(item, currentLoanedIdSet);
    return (
      <span
        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${loanerFleetStatusBadgeClasses[fleetStatus]}`}
      >
        {loanerFleetStatusLabels[fleetStatus]}
      </span>
    );
  }

  function renderLoanerPeriod(item: LoanerVehicle) {
    const assignment = representativeAssignmentMap.get(item.id);
    if (!assignment) return <span className="text-slate-400">—</span>;

    return (
      <span className="whitespace-nowrap font-semibold text-slate-700">
        {formatLoanerDate(getJstDateKey(assignment.scheduledStartAt))}
        <span className="px-1 text-slate-400">〜</span>
        {formatLoanerDate(getLoanerReturnDateKey(assignment.scheduledEndAt))}
      </span>
    );
  }

  const hasActiveFilters =
    queryInput.trim() !== "" || category !== "all" || status !== "all";
  const noRegisteredVehicles =
    summary.total === 0 && !hasActiveFilters;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <AdminHeader
        title="代車管理"
        description="代車の登録、編集、使用停止を管理します。"
        onRefresh={() => loadLoaners()}
      />
      <main className="mx-auto grid max-w-7xl gap-5 px-5 py-6 sm:px-6 lg:px-8">
        <LoanerAdminTabs active="vehicles" />
        {loadState.status === "error" ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {loadState.message}
          </p>
        ) : null}
        {notice ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">
            <p>{notice}</p>
            <button type="button" onClick={() => setNotice("")} className="cursor-pointer text-xs underline">
              閉じる
            </button>
          </div>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              label: "総台数",
              value: summary.total,
              color: "text-blue-600",
              filter: "all" as const,
            },
            {
              label: "貸出中",
              value: summary.loaned,
              color: "text-orange-600",
              filter: "loaned" as const,
            },
            {
              label: "空車",
              value: summary.available,
              color: "text-emerald-600",
              filter: "available" as const,
            },
            {
              label: "使用停止",
              value: summary.inactive,
              color: "text-slate-600",
              filter: "inactive" as const,
            },
          ].map(({ label, value, color, filter }) => (
            <button
              key={label}
              type="button"
              aria-pressed={status === filter}
              onClick={() => setStatus(filter)}
              className={`cursor-pointer rounded-md border px-4 py-3 text-left transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                status === filter
                  ? "border-blue-400 bg-blue-50/60 shadow-md ring-1 ring-blue-100"
                  : "border-slate-200 bg-white shadow-sm hover:border-blue-200 hover:bg-blue-50/30"
              }`}
            >
              <p className="text-sm font-semibold text-slate-500">{label}</p>
              <p className={`mt-1 text-2xl font-bold ${color}`}>
                {value}<span className="ml-1 text-sm text-slate-600">台</span>
              </p>
            </button>
          ))}
        </section>

        <section className="rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-end">
            <label className="min-w-0 flex-1 text-sm font-semibold text-slate-700">
              キーワード検索
              <input
                value={queryInput}
                onChange={(event) => setQueryInput(event.target.value)}
                onCompositionStart={() => setIsQueryComposing(true)}
                onCompositionEnd={(event) => {
                  setQueryInput(event.currentTarget.value);
                  setIsQueryComposing(false);
                }}
                placeholder="車名・ナンバー・メモ"
                className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <label className="w-full text-sm font-semibold text-slate-700 lg:w-48 lg:shrink-0">
              分類
              <select value={category} onChange={(event) => setCategory(event.target.value as LoanerCategory | "all")} className="mt-1.5 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm">
                <option value="all">すべて</option>
                {loanerCategories.map((value) => <option key={value} value={value}>{loanerCategoryLabels[value]}</option>)}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2 lg:ml-auto lg:flex lg:shrink-0">
              {hasActiveFilters ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="h-10 w-full cursor-pointer rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 lg:w-auto"
                >
                  条件をクリア
                </button>
              ) : null}
              <button type="button" onClick={openCreateModal} className="h-10 w-full cursor-pointer rounded-md bg-blue-600 px-5 text-sm font-bold text-white shadow-sm hover:bg-blue-700 lg:w-auto">
                ＋ 代車を追加
              </button>
            </div>
          </div>

          {loadState.status === "loading" ? (
            <p className="px-5 py-12 text-center text-sm text-slate-500">代車一覧を読み込んでいます。</p>
          ) : !displayedItems.length ? (
            <p className="px-5 py-12 text-center text-sm text-slate-500">
              {noRegisteredVehicles ? "代車がまだ登録されていません。" : "条件に一致する代車がありません。"}
            </p>
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[960px] border-collapse text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500">
                    <tr>
                      <th className="px-4 py-3">分類</th><th className="px-4 py-3">車種</th><th className="px-4 py-3">ナンバー</th><th className="px-4 py-3">状態</th><th className="px-4 py-3">貸出期間</th><th className="px-4 py-3 text-center">表示順</th><th className="px-4 py-3">メモ</th><th className="px-4 py-3 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {displayedItems.map((item) => (
                      <tr key={item.id} className={item.isActive ? "" : "bg-slate-50/70"}>
                        <td className="px-4 py-4"><LoanerCategoryBadge category={item.category} /></td>
                        <td className="px-4 py-4 font-bold text-slate-950">{item.vehicleName}</td>
                        <td className="whitespace-nowrap px-4 py-4 text-slate-700">{item.plateNumber}</td>
                        <td className="px-4 py-4">{renderFleetStatusBadge(item)}</td>
                        <td className="px-4 py-4 text-xs">{renderLoanerPeriod(item)}</td>
                        <td className="px-4 py-4 text-center font-semibold text-slate-600">{item.sortOrder}</td>
                        <td className="max-w-56 px-4 py-4"><p className="line-clamp-2 whitespace-pre-wrap text-slate-600">{item.memo || "—"}</p></td>
                        <td className="px-4 py-4"><div className="flex justify-end gap-2"><button type="button" onClick={() => openEditModal(item)} className="cursor-pointer rounded-md border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50">編集</button><button type="button" onClick={() => setPendingAction({ type: item.isActive ? "deactivate" : "activate", item })} className="cursor-pointer rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">{item.isActive ? "使用停止" : "使用再開"}</button><button type="button" onClick={() => setPendingAction({ type: "delete", item })} className="cursor-pointer rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50">削除</button></div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-3 p-4 md:hidden">
                {displayedItems.map((item) => (
                  <article key={item.id} className="rounded-md border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3"><div><LoanerCategoryBadge category={item.category} /><h2 className="mt-2 font-bold">{item.vehicleName}</h2><p className="mt-1 text-sm font-semibold text-slate-600">{item.plateNumber}</p></div>{renderFleetStatusBadge(item)}</div>
                    <dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="font-semibold text-slate-500">貸出期間</dt><dd className="mt-1 text-slate-800">{renderLoanerPeriod(item)}</dd></div><div><dt className="font-semibold text-slate-500">表示順</dt><dd className="mt-1 text-slate-800">{item.sortOrder}</dd></div><div className="col-span-2"><dt className="font-semibold text-slate-500">メモ</dt><dd className="mt-1 whitespace-pre-wrap text-slate-800">{item.memo || "—"}</dd></div></dl>
                    <div className="mt-4 grid grid-cols-3 gap-2"><button type="button" onClick={() => openEditModal(item)} className="h-9 rounded-md border border-blue-200 text-xs font-semibold text-blue-700">編集</button><button type="button" onClick={() => setPendingAction({ type: item.isActive ? "deactivate" : "activate", item })} className="h-9 rounded-md border border-slate-300 text-xs font-semibold text-slate-700">{item.isActive ? "使用停止" : "使用再開"}</button><button type="button" onClick={() => setPendingAction({ type: "delete", item })} className="h-9 rounded-md border border-red-200 text-xs font-semibold text-red-700">削除</button></div>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      </main>

      {modalOpen ? <LoanerVehicleModal item={editingItem} suggestedSortOrder={suggestedSortOrder} onClose={() => setModalOpen(false)} onSaved={handleSaved} /> : null}
      {pendingAction ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-5" role="dialog" aria-modal="true" aria-labelledby="loaner-action-title">
          <div className="w-full max-w-md rounded-md border border-slate-200 bg-white p-6 shadow-xl">
            <h2 id="loaner-action-title" className="text-lg font-bold">{actionCopy(pendingAction).title}</h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">{actionCopy(pendingAction).body}</p>
            <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm font-bold text-slate-800">{pendingAction.item.vehicleName}（{pendingAction.item.plateNumber}）</p>
            <div className="mt-6 grid grid-cols-2 gap-3"><button type="button" disabled={actionSubmitting} onClick={() => setPendingAction(null)} className="h-11 rounded-md border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50">キャンセル</button><button type="button" disabled={actionSubmitting} onClick={() => void runPendingAction()} className={`h-11 rounded-md text-sm font-bold text-white ${pendingAction.type === "delete" ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"}`}>{actionSubmitting ? "処理中..." : actionCopy(pendingAction).button}</button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
