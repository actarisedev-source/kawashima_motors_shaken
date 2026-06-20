import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  adminSessionCookieName,
  verifyAdminSessionValue,
} from "@/lib/auth/admin-session";
import {
  getLineAudience,
  renderLineMessage,
  type LineAudienceFilters,
} from "@/lib/line/audience";
import { getLineConfig } from "@/lib/line/config";
import {
  pushLineMessages,
  type LinePushMessage,
} from "@/lib/line/messaging";
import { supabaseServer } from "@/lib/supabase/server";

const lineImageBucket = "line-message-images";
const maxImageBytes = 1024 * 1024;
const allowedImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

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

async function uploadLineImage(image: File) {
  const extension =
    image.type === "image/png"
      ? "png"
      : image.type === "image/webp"
        ? "webp"
        : "jpg";
  const objectPath = `manual/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabaseServer.storage
    .from(lineImageBucket)
    .upload(objectPath, image, {
      contentType: image.type,
      cacheControl: "31536000",
      upsert: false,
    });
  if (error) {
    throw new Error(`画像の保存に失敗しました: ${error.message}`);
  }

  return supabaseServer.storage.from(lineImageBucket).getPublicUrl(objectPath)
    .data.publicUrl;
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
    (!allowedImageTypes.has(image.type) || image.size > maxImageBytes)
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
    const [audience, allMatches] = await Promise.all([
      getLineAudience(filters),
      getLineAudience(filters, false),
    ]);
    if (!audience.length) {
      return NextResponse.json(
        { ok: false, message: "配信対象のLINE連携済み顧客がいません。" },
        { status: 400 },
      );
    }

    const imageUrl = image ? await uploadLineImage(image) : null;

    let successCount = 0;
    let failureCount = 0;
    let logSavedCount = 0;
    let logFailureCount = 0;
    for (const member of audience) {
      const lineUserId = member.customer.line_user_id;
      if (!lineUserId) continue;
      const renderedBody = messageBody
        ? renderLineMessage(messageBody, member)
        : "";
      let status: "成功" | "失敗" = "成功";
      let errorMessage: string | null = null;
      try {
        const messages: LinePushMessage[] = [];
        if (renderedBody) {
          messages.push({ type: "text", text: renderedBody });
        }
        if (imageUrl) {
          messages.push({
            type: "image",
            originalContentUrl: imageUrl,
            previewImageUrl: imageUrl,
          });
        }
        await pushLineMessages(accessToken, lineUserId, messages);
        successCount += 1;
      } catch (error) {
        status = "失敗";
        failureCount += 1;
        errorMessage =
          error instanceof Error ? error.message.slice(0, 1000) : "送信失敗";
      }
      const { error: logError } = await supabaseServer
        .from("line_message_logs")
        .insert({
          customer_id: member.customer.id,
          line_user_id: lineUserId,
          target_type: targetLabel,
          title,
          body: renderedBody,
          image_url: imageUrl,
          status,
          error_message: errorMessage,
          sent_at: status === "成功" ? new Date().toISOString() : null,
        });
      if (logError) {
        logFailureCount += 1;
        console.error("Failed to save LINE message log", logError.message);
      } else {
        logSavedCount += 1;
      }
    }

    return NextResponse.json({
      ok: true,
      successCount,
      failureCount,
      excludedCount: Math.max(allMatches.length - audience.length, 0),
      logSavedCount,
      logFailureCount,
      imageUrl,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "LINE配信に失敗しました。",
      },
      { status: 500 },
    );
  }
}
