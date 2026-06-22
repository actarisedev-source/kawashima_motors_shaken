import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  adminSessionCookieName,
  verifyAdminSessionValue,
} from "@/lib/auth/admin-session";
import { supabaseServer } from "@/lib/supabase/server";

const lineImageBucket = "line-message-images";

const isAuthenticated = (request: NextRequest) =>
  verifyAdminSessionValue(request.cookies.get(adminSessionCookieName)?.value);

const getStorageObjectPath = (imageUrl: string) => {
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

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!isAuthenticated(request)) {
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
    .select("id,image_url")
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

  let storageObjectPath: string | null = null;
  if (log.image_url) {
    const { count, error: referenceError } = await supabaseServer
      .from("line_message_logs")
      .select("id", { count: "exact", head: true })
      .eq("image_url", log.image_url)
      .neq("id", id);

    if (referenceError) {
      return NextResponse.json(
        { ok: false, message: referenceError.message },
        { status: 500 },
      );
    }

    if ((count ?? 0) === 0) {
      storageObjectPath = getStorageObjectPath(log.image_url);
    }
  }

  if (storageObjectPath) {
    const { error: storageError } = await supabaseServer.storage
      .from(lineImageBucket)
      .remove([storageObjectPath]);

    if (storageError) {
      return NextResponse.json(
        {
          ok: false,
          message: `添付画像の削除に失敗しました: ${storageError.message}`,
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
    imageDeleted: Boolean(storageObjectPath),
  });
}
