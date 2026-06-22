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
import { getJstDateKey } from "@/lib/reservations/slots";
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

const isDateKey = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

export async function GET(request: NextRequest) {
  if (!isAuthenticated(request)) {
    return unauthorizedResponse();
  }

  const [{ data, error }, reservationsResult] = await Promise.all([
    fetchHolidays(),
    supabaseServer
      .from("reservations")
      .select("reserved_at,status")
      .neq("status", "キャンセル")
      .gte("reserved_at", `${getJstDateKey(new Date())}T00:00:00+09:00`),
  ]);

  if (error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 500 },
    );
  }

  if (reservationsResult.error) {
    return NextResponse.json(
      { ok: false, message: reservationsResult.error.message },
      { status: 500 },
    );
  }

  const reservationCounts = (reservationsResult.data ?? []).reduce<
    Record<string, number>
  >((counts, reservation) => {
    const dateKey = getJstDateKey(reservation.reserved_at);
    counts[dateKey] = (counts[dateKey] ?? 0) + 1;
    return counts;
  }, {});

  return NextResponse.json({
    ok: true,
    items: data.map(normalizeHoliday),
    reservationCounts,
  });
}

export async function POST(request: NextRequest) {
  if (!isAuthenticated(request)) {
    return unauthorizedResponse();
  }

  const body = (await request.json()) as {
    type?: unknown;
    date?: unknown;
    dates?: unknown;
    weekday?: unknown;
    label?: unknown;
  };

  if (body.type === "single-bulk") {
    const dates = Array.isArray(body.dates)
      ? [...new Set(body.dates.filter((date): date is string => typeof date === "string"))]
      : [];
    const today = getJstDateKey(new Date());

    if (
      !dates.length ||
      dates.length > 31 ||
      dates.some((date) => !isDateKey(date) || date < today)
    ) {
      return NextResponse.json(
        { ok: false, message: "一括設定する日付が正しくありません。" },
        { status: 400 },
      );
    }

    const { data: existing, error: existingError } = await supabaseServer
      .from("holidays")
      .select("type,date,weekday");

    if (existingError) {
      return NextResponse.json(
        { ok: false, message: existingError.message },
        { status: 500 },
      );
    }

    const existingDates = new Set(
      (existing ?? [])
        .filter((holiday) => holiday.type === "single")
        .map((holiday) => holiday.date)
        .filter(Boolean),
    );
    const existingWeekdays = new Set(
      (existing ?? [])
        .filter((holiday) => holiday.type === "weekly")
        .map((holiday) => holiday.weekday)
        .filter((weekday): weekday is number => weekday !== null),
    );
    const insertDates = dates.filter(
      (date) =>
        !existingDates.has(date) &&
        !existingWeekdays.has(new Date(`${date}T00:00:00+09:00`).getDay()),
    );

    if (!insertDates.length) {
      return NextResponse.json({ ok: true, holidays: [] });
    }

    const { data, error } = await supabaseServer
      .from("holidays")
      .insert(
        insertDates.map((date) => ({
          type: "single" as const,
          date,
          weekday: null,
          label: null,
        })),
      )
      .select("*");

    if (error) {
      return NextResponse.json(
        { ok: false, message: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      holidays: (data ?? []).map(normalizeHoliday),
    });
  }

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
  const dates = [...new Set(searchParams.getAll("date"))];
  const today = getJstDateKey(new Date());

  if (!id && !dates.length) {
    return NextResponse.json(
      { ok: false, message: "削除する定休日を指定してください。" },
      { status: 400 },
    );
  }

  if (
    dates.length > 31 ||
    dates.some((date) => !isDateKey(date) || date < today)
  ) {
    return NextResponse.json(
      { ok: false, message: "一括解除する日付が正しくありません。" },
      { status: 400 },
    );
  }

  if (id) {
    const { error } = await supabaseServer
      .from("holidays")
      .delete()
      .eq("id", id);

    if (error) {
      return NextResponse.json(
        { ok: false, message: error.message },
        { status: 500 },
      );
    }
  }

  if (dates.length) {
    const { error } = await supabaseServer
      .from("holidays")
      .delete()
      .eq("type", "single")
      .in("date", dates);

    if (error) {
      return NextResponse.json(
        { ok: false, message: error.message },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ ok: true });
}
