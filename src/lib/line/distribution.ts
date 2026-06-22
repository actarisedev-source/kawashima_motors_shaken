import {
  getLineAudience,
  renderLineMessage,
  type LineAudienceFilters,
} from "@/lib/line/audience";
import {
  pushLineMessages,
  type LinePushMessage,
} from "@/lib/line/messaging";
import { supabaseServer } from "@/lib/supabase/server";

export const lineImageBucket = "line-message-images";
export const maxLineImageBytes = 1024 * 1024;
export const allowedLineImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export async function uploadLineImage(image: File, folder: "manual" | "scheduled") {
  const extension =
    image.type === "image/png"
      ? "png"
      : image.type === "image/webp"
        ? "webp"
        : "jpg";
  const objectPath = `${folder}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabaseServer.storage
    .from(lineImageBucket)
    .upload(objectPath, image, {
      contentType: image.type,
      cacheControl: "31536000",
      upsert: false,
    });
  if (error) throw new Error(`画像の保存に失敗しました: ${error.message}`);

  return supabaseServer.storage.from(lineImageBucket).getPublicUrl(objectPath)
    .data.publicUrl;
}

type SendLineDistributionInput = {
  accessToken: string;
  title: string;
  messageBody: string;
  imageUrl: string | null;
  targetLabel: string;
  filters: LineAudienceFilters;
  targetTypePrefix?: string;
};

export async function sendLineDistribution(input: SendLineDistributionInput) {
  const [audience, allMatches] = await Promise.all([
    getLineAudience(input.filters),
    getLineAudience(input.filters, false),
  ]);
  if (!audience.length) {
    throw new Error("配信対象のLINE連携済み顧客がいません。");
  }

  let successCount = 0;
  let failureCount = 0;
  let logSavedCount = 0;
  let logFailureCount = 0;
  const targetType = input.targetTypePrefix
    ? `${input.targetTypePrefix}: ${input.targetLabel}`
    : input.targetLabel;

  for (const member of audience) {
    const lineUserId = member.customer.line_user_id;
    if (!lineUserId) continue;
    const renderedBody = input.messageBody
      ? renderLineMessage(input.messageBody, member)
      : "";
    let status: "成功" | "失敗" = "成功";
    let errorMessage: string | null = null;

    try {
      const messages: LinePushMessage[] = [];
      if (renderedBody) messages.push({ type: "text", text: renderedBody });
      if (input.imageUrl) {
        messages.push({
          type: "image",
          originalContentUrl: input.imageUrl,
          previewImageUrl: input.imageUrl,
        });
      }
      await pushLineMessages(input.accessToken, lineUserId, messages);
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
        target_type: targetType,
        title: input.title,
        body: renderedBody,
        image_url: input.imageUrl,
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

  return {
    targetCount: audience.length,
    successCount,
    failureCount,
    excludedCount: Math.max(allMatches.length - audience.length, 0),
    logSavedCount,
    logFailureCount,
  };
}
