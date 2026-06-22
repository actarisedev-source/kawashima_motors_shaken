import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  adminSessionCookieName,
  verifyAdminSessionValue,
} from "@/lib/auth/admin-session";
import {
  type LineAudienceFilters,
} from "@/lib/line/audience";
import { getLineConfig } from "@/lib/line/config";
import {
  allowedLineImageTypes,
  maxLineImageBytes,
  sendLineDistribution,
  uploadLineImage,
} from "@/lib/line/distribution";

const isAuthenticated = (request: NextRequest) =>
  verifyAdminSessionValue(request.cookies.get(adminSessionCookieName)?.value);

const textValue = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

type SendPayload = {
  title: string;
  messageBody: string;
  targetLabel: string;
  filters: LineAudienceFilters;
  image: File | null;
};

const parseFilters = (value: FormDataEntryValue | null) => {
  if (typeof value !== "string" || !value) return {};
  try {
    return JSON.parse(value) as LineAudienceFilters;
  } catch {
    throw new Error("配信対象の指定が正しくありません。");
  }
};

async function parsePayload(request: NextRequest): Promise<SendPayload> {
  if (request.headers.get("content-type")?.includes("multipart/form-data")) {
    const formData = await request.formData();
    const imageValue = formData.get("image");
    return {
      title: textValue(formData.get("title")),
      messageBody: textValue(formData.get("messageBody")),
      targetLabel:
        textValue(formData.get("targetLabel")) || "LINE連携済み全員",
      filters: parseFilters(formData.get("filters")),
      image:
        imageValue instanceof File && imageValue.size > 0 ? imageValue : null,
    };
  }

  const body = (await request.json()) as {
    title?: unknown;
    messageBody?: unknown;
    targetLabel?: unknown;
    filters?: LineAudienceFilters;
  };
  return {
    title: textValue(body.title),
    messageBody: textValue(body.messageBody),
    targetLabel: textValue(body.targetLabel) || "LINE連携済み全員",
    filters: body.filters ?? {},
    image: null,
  };
}

export async function POST(request: NextRequest) {
  if (!isAuthenticated(request)) {
    return NextResponse.json(
      { ok: false, message: "ログインが必要です。" },
      { status: 401 },
    );
  }

  let payload: SendPayload;
  try {
    payload = await parsePayload(request);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "配信内容が正しくありません。",
      },
      { status: 400 },
    );
  }

  const { title, messageBody, targetLabel, filters, image } = payload;
  if (!title || (!messageBody && !image)) {
    return NextResponse.json(
      {
        ok: false,
        message: "配信タイトルと、本文または画像を入力してください。",
      },
      { status: 400 },
    );
  }
  if (messageBody.length > 5000) {
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

  const accessToken = getLineConfig().channelAccessToken;
  if (!accessToken) {
    return NextResponse.json(
      { ok: false, message: "LINE_CHANNEL_ACCESS_TOKEN が未設定です" },
      { status: 503 },
    );
  }

  try {
    const imageUrl = image ? await uploadLineImage(image, "manual") : null;
    const result = await sendLineDistribution({
      accessToken,
      title,
      messageBody,
      imageUrl,
      targetLabel,
      filters,
    });

    return NextResponse.json({
      ok: true,
      ...result,
      imageUrl,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "LINE配信に失敗しました。";
    return NextResponse.json(
      { ok: false, message },
      {
        status:
          message === "配信対象のLINE連携済み顧客がいません。" ? 400 : 500,
      },
    );
  }
}
