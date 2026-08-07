import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAdminAuthFromRequest } from "@/lib/auth/admin-session";
import {
  type LineAudienceFilters,
} from "@/lib/line/audience";
import { getLineConfig } from "@/lib/line/config";
import {
  allowedLineImageTypes,
  maxLineImageBytes,
  removeLineImages,
  sendLineDistribution,
  uploadLineImages,
} from "@/lib/line/distribution";
import { maxLineImageCount } from "@/lib/line/images";

const isAuthenticated = async (request: NextRequest) =>
  (await getAdminAuthFromRequest(request)).authenticated;

const textValue = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

type SendPayload = {
  title: string;
  messageBody: string;
  targetLabel: string;
  filters: LineAudienceFilters;
  images: File[];
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
    const legacyImageValue = formData.get("image");
    const images = [
      ...formData.getAll("images"),
      ...(legacyImageValue ? [legacyImageValue] : []),
    ].filter(
      (value): value is File => value instanceof File && value.size > 0,
    );
    return {
      title: textValue(formData.get("title")),
      messageBody: textValue(formData.get("messageBody")),
      targetLabel:
        textValue(formData.get("targetLabel")) || "LINE連携済み全員",
      filters: parseFilters(formData.get("filters")),
      images,
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
    images: [],
  };
}

export async function POST(request: NextRequest) {
  if (!(await isAuthenticated(request))) {
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

  const { title, messageBody, targetLabel, filters, images } = payload;
  if (!title || (!messageBody && !images.length)) {
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

  const accessToken = getLineConfig().channelAccessToken;
  if (!accessToken) {
    return NextResponse.json(
      { ok: false, message: "LINE_CHANNEL_ACCESS_TOKEN が未設定です" },
      { status: 503 },
    );
  }

  try {
    const imageUrls = await uploadLineImages(images, "manual");
    let result;
    try {
      result = await sendLineDistribution({
        accessToken,
        title,
        messageBody,
        imageUrls,
        targetLabel,
        filters,
      });
    } catch (error) {
      if (imageUrls.length) await removeLineImages(imageUrls);
      throw error;
    }

    return NextResponse.json({
      ok: true,
      ...result,
      imageUrl: imageUrls[0] ?? null,
      imageUrls,
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
