import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAdminAuthFromRequest } from "@/lib/auth/admin-session";
import {
  getLineImageObjectPath,
  removeLineImages,
} from "@/lib/line/distribution";
import { resolveLineImageUrls } from "@/lib/line/images";
import { supabaseServer } from "@/lib/supabase/server";

const isAuthenticated = async (request: NextRequest) =>
  (await getAdminAuthFromRequest(request)).authenticated;

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json(
      { ok: false, message: "ログインが必要です。" },
      { status: 401 },
    );
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json(
      { ok: false, message: "配信履歴IDが必要です。" },
      { status: 400 },
    );
  }

  const { data: log, error: logError } = await supabaseServer
    .from("line_message_logs")
    .select("id,image_url,image_urls")
    .eq("id", id)
    .maybeSingle();

  if (logError) {
    return NextResponse.json(
      { ok: false, message: logError.message },
      { status: 500 },
    );
  }
  if (!log) {
    return NextResponse.json(
      { ok: false, message: "配信履歴が見つかりません。" },
      { status: 404 },
    );
  }

  const removableImageUrls: string[] = [];
  for (const imageUrl of resolveLineImageUrls(log.image_urls, log.image_url)) {
    const [legacyLogs, arrayLogs, legacyScheduled, arrayScheduled] =
      await Promise.all([
        supabaseServer
          .from("line_message_logs")
          .select("id", { count: "exact", head: true })
          .eq("image_url", imageUrl)
          .neq("id", id),
        supabaseServer
          .from("line_message_logs")
          .select("id", { count: "exact", head: true })
          .contains("image_urls", [imageUrl])
          .neq("id", id),
        supabaseServer
          .from("line_scheduled_messages")
          .select("id", { count: "exact", head: true })
          .eq("image_url", imageUrl),
        supabaseServer
          .from("line_scheduled_messages")
          .select("id", { count: "exact", head: true })
          .contains("image_urls", [imageUrl]),
      ]);
    const referenceError =
      legacyLogs.error ||
      arrayLogs.error ||
      legacyScheduled.error ||
      arrayScheduled.error;
    if (referenceError) {
      return NextResponse.json(
        { ok: false, message: referenceError.message },
        { status: 500 },
      );
    }
    const hasReference = [
      legacyLogs,
      arrayLogs,
      legacyScheduled,
      arrayScheduled,
    ].some((result) => (result.count ?? 0) > 0);
    if (!hasReference && getLineImageObjectPath(imageUrl)) {
      removableImageUrls.push(imageUrl);
    }
  }

  if (removableImageUrls.length) {
    try {
      await removeLineImages(removableImageUrls);
    } catch (error) {
      return NextResponse.json(
        {
          ok: false,
          message:
            error instanceof Error
              ? error.message
              : "添付画像の削除に失敗しました。",
        },
        { status: 500 },
      );
    }
  }

  const { data: deletedLog, error: deleteError } = await supabaseServer
    .from("line_message_logs")
    .delete()
    .eq("id", id)
    .select("id")
    .single();
  if (deleteError) {
    return NextResponse.json(
      { ok: false, message: deleteError.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    deletedId: deletedLog.id,
    imageDeleted: removableImageUrls.length > 0,
    imageDeletedCount: removableImageUrls.length,
  });
}
