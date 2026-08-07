import {
  getLineAudience,
  type LineAudienceFilters,
} from "@/lib/line/audience";
import {
  buildLinePushMessages,
  pushLineMessages,
} from "@/lib/line/messaging";
import { maxLineImageCount } from "@/lib/line/images";
import { supabaseServer } from "@/lib/supabase/server";

export const lineImageBucket = "line-message-images";
export const maxLineImageBytes = 1024 * 1024;
export const allowedLineImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const getLineImageStoragePath = (
  image: File,
  folder: "manual" | "scheduled",
) => {
  const extension =
    image.type === "image/png"
      ? "png"
      : image.type === "image/webp"
        ? "webp"
        : "jpg";
  return `${folder}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;
};

export const getLineImageObjectPath = (imageUrl: string) => {
  try {
    const pathname = new URL(imageUrl).pathname;
    const marker = `/storage/v1/object/public/${lineImageBucket}/`;
    const markerIndex = pathname.indexOf(marker);
    if (markerIndex < 0) return null;
    const objectPath = decodeURIComponent(
      pathname.slice(markerIndex + marker.length),
    );
    if (!objectPath || objectPath.startsWith("/") || objectPath.includes("..")) {
      return null;
    }
    return objectPath;
  } catch {
    return null;
  }
};

export async function removeLineImages(imageUrls: string[]) {
  const objectPaths = imageUrls
    .map(getLineImageObjectPath)
    .filter((value): value is string => Boolean(value));
  if (!objectPaths.length) return;
  const { error } = await supabaseServer.storage
    .from(lineImageBucket)
    .remove(objectPaths);
  if (error) throw new Error(`画像の削除に失敗しました: ${error.message}`);
}

export async function uploadLineImage(
  image: File,
  folder: "manual" | "scheduled",
) {
  const objectPath = getLineImageStoragePath(image, folder);
  const { error } = await supabaseServer.storage
    .from(lineImageBucket)
    .upload(objectPath, image, {
      contentType: image.type,
      cacheControl: "31536000",
      upsert: false,
    });
  if (error) throw new Error(`画像の保存に失敗しました: ${error.message}`);

  const publicUrl = supabaseServer.storage
    .from(lineImageBucket)
    .getPublicUrl(objectPath).data.publicUrl;
  if (!publicUrl) {
    await supabaseServer.storage.from(lineImageBucket).remove([objectPath]);
    throw new Error("画像URLの生成に失敗しました。");
  }
  return publicUrl;
}

export async function uploadLineImages(
  images: File[],
  folder: "manual" | "scheduled",
) {
  if (images.length > maxLineImageCount) {
    throw new Error("添付画像は4枚まで選択できます。");
  }

  const uploadedUrls: string[] = [];
  try {
    for (const image of images) {
      uploadedUrls.push(await uploadLineImage(image, folder));
    }
    return uploadedUrls;
  } catch (error) {
    if (uploadedUrls.length) {
      try {
        await removeLineImages(uploadedUrls);
      } catch (cleanupError) {
        console.error("Failed to clean up LINE images", cleanupError);
      }
    }
    throw error;
  }
}

type SendLineDistributionInput = {
  accessToken: string;
  title: string;
  messageBody: string;
  imageUrls: string[];
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
    const messageBody = input.messageBody;
    let status: "成功" | "失敗" = "成功";
    let errorMessage: string | null = null;

    try {
      const messages = buildLinePushMessages(messageBody, input.imageUrls);
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
        body: messageBody,
        image_url: input.imageUrls[0] ?? null,
        image_urls: input.imageUrls,
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
