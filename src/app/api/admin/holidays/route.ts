import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  adminSessionCookieName,
  verifyAdminSessionValue,
} from "@/lib/auth/admin-session";
import {
  fetchHolidays,
  isHolidayType,
  normalizeHoliday,
} from "@/lib/holidays/holidays";
import { supabaseServer } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

const unauthorizedResponse = () =>
  NextResponse.json(
    { ok: false, message: "ログインが必要です。" },
    { status: 401 },
  );

const isAuthenticated = (request: NextRequest) =>
  verifyAdminSessionValue(request.cookies.get(adminSessionCookieName)?.value);

const normalizeOptional = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export async function GET(request: NextRequest) {
  if (!isAuthenticated(request)) {
    return unauthorizedResponse();
  }

  const { data, error } = await fetchHolidays();

  if (error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    items: data.map(normalizeHoliday),
  });
}

export async function POST(request: NextRequest) {
  if (!isAuthenticated(request)) {
    return unauthorizedResponse();
  }

  const body = (await request.json()) as {
    type?: unknown;
    date?: unknown;
    weekday?: unknown;
    label?: unknown;
  };

  if (!isHolidayType(body.type)) {
    return NextResponse.json(
      { ok: false, message: "休業日の種類が正しくありません。" },
      { status: 400 },
    );
  }

  const label = normalizeOptional(body.label);
  const weekday = Number(body.weekday);
  const payload: Database["public"]["Tables"]["holidays"]["Insert"] =
    body.type === "single"
      ? {
          type: body.type,
          date: normalizeOptional(body.date),
          weekday: null,
          label,
        }
      : {
          type: body.type,
          date: null,
          weekday,
          label,
        };

  if (payload.type === "single" && !payload.date) {
    return NextResponse.json(
      { ok: false, message: "休業日の日付を選択してください。" },
      { status: 400 },
    );
  }

  if (
    payload.type === "weekly" &&
    (!Number.isInteger(weekday) || weekday < 0 || weekday > 6)
  ) {
    return NextResponse.json(
      { ok: false, message: "曜日を選択してください。" },
      { status: 400 },
    );
  }

  const { data, error } = await supabaseServer
    .from("holidays")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, holiday: normalizeHoliday(data) });
}

export async function DELETE(request: NextRequest) {
  if (!isAuthenticated(request)) {
    return unauthorizedResponse();
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json(
      { ok: false, message: "id is required." },
      { status: 400 },
    );
  }

  const { error } = await supabaseServer.from("holidays").delete().eq("id", id);

  if (error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
