import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAdminAuthFromRequest } from "@/lib/auth/admin-session";
import {
  getLineAudience,
  type LineAudienceFilters,
} from "@/lib/line/audience";
import {
  allowedLineImageTypes,
  maxLineImageBytes,
  removeLineImages,
  uploadLineImages,
} from "@/lib/line/distribution";
import { maxLineImageCount } from "@/lib/line/images";
import { isAllowedLineScheduledTime } from "@/lib/line/scheduled-time";
import { supabaseServer } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

const isAuthenticated = async (request: NextRequest) =>
  (await getAdminAuthFromRequest(request)).authenticated;

const defaultPageSize = 25;
const maxPageSize = 100;
const scheduledStatuses = ["予約中", "送信済み", "取消済み", "失敗"] as const;

const quotePostgrestPattern = (keyword: string) =>
  `"*${keyword.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}*"`;

const parsePositiveInteger = (
  value: string | null,
  fallback: number,
  maxValue?: number,
) => {
  const parsed = Number(value ?? "");
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return maxValue ? Math.min(parsed, maxValue) : parsed;
};

const textValue = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value.trim() : "";

const parseFilters = (value: FormDataEntryValue | null) => {
  if (typeof value !== "string" || !value) return {};
  try {
    return JSON.parse(value) as LineAudienceFilters;
  } catch {
    throw new Error("配信対象の指定が正しくありません。");
  }
};

const parseScheduledAt = (date: string, time: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("配信日を選択してください。");
  }
  if (!time) {
    throw new Error("配信時刻を選択してください。");
  }
  if (!isAllowedLineScheduledTime(time)) {
    throw new Error("配信時刻は08:00から20:00までの15分単位で選択してください。");
  }
  const scheduledAt = new Date(`${date}T${time}:00+09:00`);
  if (Number.isNaN(scheduledAt.getTime())) {
    throw new Error("配信日時が正しくありません。");
  }
  const normalizedDate = new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(scheduledAt);
  if (normalizedDate !== date) throw new Error("配信日が正しくありません。");
  if (scheduledAt.getTime() <= Date.now()) {
    throw new Error("過去の日時は予約できません。");
  }
  return scheduledAt.toISOString();
};

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json(
      { ok: false, message: "ログインが必要です。" },
      { status: 401 },
    );
  }

  const page = parsePositiveInteger(request.nextUrl.searchParams.get("page"), 1);
  const pageSize = parsePositiveInteger(
    request.nextUrl.searchParams.get("page_size"),
    defaultPageSize,
    maxPageSize,
  );
  const search = (request.nextUrl.searchParams.get("search") ?? "")
    .normalize("NFKC")
    .trim();
  const statusParam = request.nextUrl.searchParams.get("status") ?? "all";

  if (search.length > 100) {
    return NextResponse.json(
      { ok: false, message: "検索文字は100文字以内で入力してください。" },
      { status: 400 },
    );
  }
  if (
    statusParam !== "all" &&
    !scheduledStatuses.includes(statusParam as (typeof scheduledStatuses)[number])
  ) {
    return NextResponse.json(
      { ok: false, message: "状態の指定が正しくありません。" },
      { status: 400 },
    );
  }
  const status = statusParam as "all" | (typeof scheduledStatuses)[number];

  let query = supabaseServer
    .from("line_scheduled_messages")
    .select("*", { count: "exact" })
    .order("scheduled_at", { ascending: false });

  if (status !== "all") {
    query = query.eq("status", status);
  }
  if (search) {
    const pattern = quotePostgrestPattern(search);
    query = query.or(
      [
        `title.ilike.${pattern}`,
        `body.ilike.${pattern}`,
        `target_label.ilike.${pattern}`,
        `status.ilike.${pattern}`,
        `error_message.ilike.${pattern}`,
      ].join(","),
    );
  }

  const rangeStart = (page - 1) * pageSize;
  const rangeEnd = rangeStart + pageSize - 1;
  const { data, error, count } = await query.range(rangeStart, rangeEnd);
  if (error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 500 },
    );
  }
  const total = count ?? 0;
  return NextResponse.json({
    ok: true,
    messages: data ?? [],
    total,
    page,
    page_size: pageSize,
    total_pages: Math.max(1, Math.ceil(total / pageSize)),
  });
}

export async function POST(request: NextRequest) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json(
      { ok: false, message: "ログインが必要です。" },
      { status: 401 },
    );
  }

  try {
    const formData = await request.formData();
    const rawTitle = textValue(formData.get("title"));
    const rawBody = textValue(formData.get("messageBody"));
    const scheduledDate = textValue(formData.get("scheduledDate"));
    const scheduledTime = textValue(formData.get("scheduledTime"));
    const targetLabel =
      textValue(formData.get("targetLabel")) || "LINE連携済み全員";
    const filters = parseFilters(formData.get("filters"));
    const legacyImageValue = formData.get("image");
    const images = [
      ...formData.getAll("images"),
      ...(legacyImageValue ? [legacyImageValue] : []),
    ].filter(
      (value): value is File => value instanceof File && value.size > 0,
    );

    if (!rawTitle && !rawBody && !images.length) {
      return NextResponse.json(
        { ok: false, message: "配信タイトル、本文、画像のいずれかを入力してください。" },
        { status: 400 },
      );
    }
    if (rawBody.length > 5000) {
      return NextResponse.json(
        { ok: false, message: "配信本文は5000文字以内で入力してください。" },
        { status: 400 },
      );
    }
    if (images.length > maxLineImageCount) {
      return NextResponse.json(
        { ok: false, message: "添付画像は4枚まで選択できます。" },
        { status: 400 },
      );
    }
    if (
      images.some(
        (image) =>
          !allowedLineImageTypes.has(image.type) || image.size > maxLineImageBytes,
      )
    ) {
      return NextResponse.json(
        {
          ok: false,
          message: "画像はjpg・jpeg・png・webp形式、1MB以内で指定してください。",
        },
        { status: 400 },
      );
    }

    const scheduledAt = parseScheduledAt(scheduledDate, scheduledTime);
    const audience = await getLineAudience(filters);
    if (!audience.length) {
      return NextResponse.json(
        { ok: false, message: "配信対象のLINE連携済み顧客がいません。" },
        { status: 400 },
      );
    }

    const imageUrls = await uploadLineImages(images, "scheduled");
    const title = rawTitle || (rawBody ? rawBody.slice(0, 50) : "画像配信");
    const body = rawBody || (!images.length ? rawTitle : "");
    const { data, error } = await supabaseServer
      .from("line_scheduled_messages")
      .insert({
        title,
        body,
        image_url: imageUrls[0] ?? null,
        image_urls: imageUrls,
        target_label: targetLabel,
        target_conditions: filters as unknown as Json,
        target_count: audience.length,
        scheduled_at: scheduledAt,
      })
      .select("*")
      .single();
    if (error) {
      if (imageUrls.length) await removeLineImages(imageUrls);
      throw new Error(error.message);
    }

    return NextResponse.json({ ok: true, message: data });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "予約配信の登録に失敗しました。";
    const isValidationError =
      message.includes("選択") ||
      message.includes("正しく") ||
      message.includes("過去");
    return NextResponse.json(
      { ok: false, message },
      { status: isValidationError ? 400 : 500 },
    );
  }
}
