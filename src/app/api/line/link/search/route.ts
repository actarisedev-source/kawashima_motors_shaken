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
    phone?: unknown;
  } | null;
  const idToken = typeof body?.idToken === "string" ? body.idToken : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const normalizedPhone = normalizePhone(phone);

  if (!idToken) {
    return NextResponse.json(
      { ok: false, message: "LINEログインが必要です。" },
      { status: 401 },
    );
  }

  if (!phone || !isValidNormalizedPhone(normalizedPhone)) {
    return NextResponse.json(
      { ok: false, message: "電話番号を入力してください。" },
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

    const { data: linkedCustomer, error: linkedCustomerError } =
      await supabaseServer
        .from("customers")
        .select("id")
        .eq("line_user_id", lineProfile.sub)
        .maybeSingle();

    if (linkedCustomerError) {
      throw linkedCustomerError;
    }

    const { data: customer, error: customerError } = await supabaseServer
      .from("customers")
      .select("id,name,phone,line_user_id")
      .eq("normalized_phone", normalizedPhone)
      .maybeSingle();

    if (customerError) {
      throw customerError;
    }

    if (!customer) {
      return NextResponse.json(
        {
          ok: false,
          notFound: true,
          message:
            "登録済み顧客情報が見つかりませんでした。店舗へお問い合わせください。",
        },
        { status: 404 },
      );
    }

    if (
      customer.line_user_id &&
      customer.line_user_id !== lineProfile.sub
    ) {
      return NextResponse.json(
        {
          ok: false,
          message: "この顧客情報は別のLINEアカウントと連携済みです。",
        },
        { status: 409 },
      );
    }

    if (linkedCustomer && linkedCustomer.id !== customer.id) {
      return NextResponse.json(
        {
          ok: false,
          message: "このLINEアカウントは別の顧客情報と連携済みです。",
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      ok: true,
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone ?? phone,
        alreadyLinked: customer.line_user_id === lineProfile.sub,
      },
    });
  } catch (error) {
    if (error instanceof LineLoginConfigurationError) {
      return NextResponse.json(
        { ok: false, message: "LINEログイン設定が完了していません。" },
        { status: 503 },
      );
    }

    console.error("LINE customer search failed", error);
    return NextResponse.json(
      { ok: false, message: "顧客情報の検索に失敗しました。" },
      { status: 500 },
    );
  }
}
