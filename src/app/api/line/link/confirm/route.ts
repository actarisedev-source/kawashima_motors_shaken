import { NextResponse } from "next/server";
import { isValidNormalizedPhone, normalizePhone } from "@/lib/customers/phone";
import {
  LineLoginConfigurationError,
  verifyLineIdToken,
} from "@/lib/line/id-token";
import {
  isSupabaseServiceRoleConfigured,
  supabaseServer,
} from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSupabaseServiceRoleConfigured) {
    return NextResponse.json(
      { ok: false, message: "LINE連携のサーバー設定が完了していません。" },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    idToken?: unknown;
    customerId?: unknown;
    phone?: unknown;
  } | null;
  const idToken = typeof body?.idToken === "string" ? body.idToken : "";
  const customerId =
    typeof body?.customerId === "string" ? body.customerId : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const normalizedPhone = normalizePhone(phone);

  if (!idToken) {
    return NextResponse.json(
      { ok: false, message: "LINEログインが必要です。" },
      { status: 401 },
    );
  }

  if (!customerId || !isValidNormalizedPhone(normalizedPhone)) {
    return NextResponse.json(
      { ok: false, message: "連携する顧客情報が正しくありません。" },
      { status: 400 },
    );
  }

  try {
    const lineProfile = await verifyLineIdToken(idToken);

    if (!lineProfile) {
      return NextResponse.json(
        { ok: false, message: "LINEログインの有効期限が切れています。" },
        { status: 401 },
      );
    }

    const { data: customer, error: customerError } = await supabaseServer
      .from("customers")
      .select("id,line_user_id")
      .eq("id", customerId)
      .eq("normalized_phone", normalizedPhone)
      .maybeSingle();

    if (customerError) {
      throw customerError;
    }

    if (!customer) {
      return NextResponse.json(
        { ok: false, message: "顧客情報を再確認してください。" },
        { status: 404 },
      );
    }

    if (customer.line_user_id === lineProfile.sub) {
      return NextResponse.json({ ok: true, alreadyLinked: true });
    }

    if (customer.line_user_id) {
      return NextResponse.json(
        {
          ok: false,
          message: "この顧客情報は別のLINEアカウントと連携済みです。",
        },
        { status: 409 },
      );
    }

    const { data: updatedCustomer, error: updateError } = await supabaseServer
      .from("customers")
      .update({
        line_user_id: lineProfile.sub,
        line_display_name: lineProfile.name,
        line_picture_url: lineProfile.picture,
        line_linked_at: new Date().toISOString(),
        line_status: "連携済み",
      })
      .eq("id", customer.id)
      .is("line_user_id", null)
      .select("id")
      .maybeSingle();

    if (updateError) {
      if (updateError.code === "23505") {
        return NextResponse.json(
          {
            ok: false,
            message: "このLINEアカウントは別の顧客情報と連携済みです。",
          },
          { status: 409 },
        );
      }
      throw updateError;
    }

    if (!updatedCustomer) {
      return NextResponse.json(
        { ok: false, message: "連携状態が変更されました。再度お試しください。" },
        { status: 409 },
      );
    }

    return NextResponse.json({ ok: true, alreadyLinked: false });
  } catch (error) {
    if (error instanceof LineLoginConfigurationError) {
      return NextResponse.json(
        { ok: false, message: "LINEログイン設定が完了していません。" },
        { status: 503 },
      );
    }

    console.error("LINE customer link failed", error);
    return NextResponse.json(
      { ok: false, message: "LINE連携に失敗しました。" },
      { status: 500 },
    );
  }
}
