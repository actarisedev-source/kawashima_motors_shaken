import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  adminSessionCookieName,
  verifyAdminSessionValue,
} from "@/lib/auth/admin-session";
import {
  getLineAudience,
  type LineAudienceFilters,
} from "@/lib/line/audience";
import {
  allowedLineImageTypes,
  maxLineImageBytes,
  uploadLineImage,
} from "@/lib/line/distribution";
import { supabaseServer } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

const isAuthenticated = (request: NextRequest) =>
  verifyAdminSessionValue(request.cookies.get(adminSessionCookieName)?.value);

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
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error("配信時刻を選択してください。");
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
  if (!isAuthenticated(request)) {
    return NextResponse.json(
      { ok: false, message: "ログインが必要です。" },
      { status: 401 },
    );
  }

  const { data, error } = await supabaseServer
    .from("line_scheduled_messages")
    .select("*")
    .order("scheduled_at", { ascending: false })
    .limit(100);
  if (error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, messages: data ?? [] });
}

export async function POST(request: NextRequest) {
  if (!isAuthenticated(request)) {
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
    const imageValue = formData.get("image");
    const image =
      imageValue instanceof File && imageValue.size > 0 ? imageValue : null;

    if (!rawTitle && !rawBody && !image) {
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
    if (
      image &&
      (!allowedLineImageTypes.has(image.type) || image.size > maxLineImageBytes)
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

    const imageUrl = image
      ? await uploadLineImage(image, "scheduled")
      : null;
    const title = rawTitle || (rawBody ? rawBody.slice(0, 50) : "画像配信");
    const body = rawBody || (!image ? rawTitle : "");
    const { data, error } = await supabaseServer
      .from("line_scheduled_messages")
      .insert({
        title,
        body,
        image_url: imageUrl,
        target_label: targetLabel,
        target_conditions: filters as unknown as Json,
        target_count: audience.length,
        scheduled_at: scheduledAt,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

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
