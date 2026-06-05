import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  adminSessionCookieName,
  verifyAdminSessionValue,
} from "@/lib/auth/admin-session";
import {
  buildSpecialCapacityMap,
  buildWeeklyCapacityMap,
  fetchSlotSettings,
} from "@/lib/reservations/slot-settings";
import {
  defaultSlotType,
  normalizeSlotCapacity,
  reservationTimeSlots,
  type ReservationTimeSlot,
} from "@/lib/reservations/slots";
import { supabaseServer } from "@/lib/supabase/server";

const unauthorizedResponse = () =>
  NextResponse.json(
    { ok: false, message: "ログインが必要です。" },
    { status: 401 },
  );

const isAuthenticated = (request: NextRequest) =>
  verifyAdminSessionValue(request.cookies.get(adminSessionCookieName)?.value);

const parseWeeklySettings = (value: unknown) => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const rows: {
    slot_type: string;
    weekday: number;
    time: ReservationTimeSlot;
    capacity: number;
  }[] = [];

  for (let weekday = 0; weekday <= 6; weekday += 1) {
    const daySettings = (value as Record<string, unknown>)[String(weekday)];

    if (!daySettings || typeof daySettings !== "object") {
      return null;
    }

    for (const time of reservationTimeSlots) {
      const capacity = normalizeSlotCapacity(
        (daySettings as Record<string, unknown>)[time],
      );

      if (capacity === null) {
        return null;
      }

      rows.push({
        slot_type: defaultSlotType,
        weekday,
        time,
        capacity,
      });
    }
  }

  return rows;
};

const parseSpecialSettings = (value: unknown) => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const rows: {
    slot_type: string;
    date: string;
    time: ReservationTimeSlot;
    capacity: number;
  }[] = [];

  const date = (value as Record<string, unknown>).date;
  const capacities = (value as Record<string, unknown>).capacities;

  if (
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !capacities ||
    typeof capacities !== "object"
  ) {
    return null;
  }

  for (const time of reservationTimeSlots) {
    const capacity = normalizeSlotCapacity(
      (capacities as Record<string, unknown>)[time],
    );

    if (capacity === null) {
      return null;
    }

    rows.push({
      slot_type: defaultSlotType,
      date,
      time,
      capacity,
    });
  }

  return { date, rows };
};

export async function GET(request: NextRequest) {
  if (!isAuthenticated(request)) {
    return unauthorizedResponse();
  }

  const { weekly, special, error } = await fetchSlotSettings();
  const unavailable = error?.code === "PGRST205";

  if (error && !unavailable) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 500 },
    );
  }

  const weeklyCapacity = buildWeeklyCapacityMap(unavailable ? [] : weekly);
  const specialCapacity = buildSpecialCapacityMap(unavailable ? [] : special);
  const specialItems = Array.from(specialCapacity.entries())
    .map(([date, capacities]) => ({
      date,
      capacities: Object.fromEntries(
        reservationTimeSlots.map((time) => [time, capacities[time] ?? 0]),
      ),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json({
    ok: true,
    timeSlots: reservationTimeSlots,
    weekly: weeklyCapacity,
    special: specialItems,
  });
}

export async function PUT(request: NextRequest) {
  if (!isAuthenticated(request)) {
    return unauthorizedResponse();
  }

  const body = (await request.json()) as { weekly?: unknown };
  const rows = parseWeeklySettings(body.weekly);

  if (!rows) {
    return NextResponse.json(
      { ok: false, message: "曜日別枠設定の形式が正しくありません。" },
      { status: 400 },
    );
  }

  const { error } = await supabaseServer.from("slot_settings").upsert(rows, {
    onConflict: "slot_type,weekday,time",
  });

  if (error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

export async function POST(request: NextRequest) {
  if (!isAuthenticated(request)) {
    return unauthorizedResponse();
  }

  const body = (await request.json()) as { special?: unknown };
  const parsed = parseSpecialSettings(body.special);

  if (!parsed) {
    return NextResponse.json(
      { ok: false, message: "特定日枠設定の形式が正しくありません。" },
      { status: 400 },
    );
  }

  const { error } = await supabaseServer
    .from("special_slot_settings")
    .upsert(parsed.rows, {
      onConflict: "slot_type,date,time",
    });

  if (error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  if (!isAuthenticated(request)) {
    return unauthorizedResponse();
  }

  const date = request.nextUrl.searchParams.get("date");

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { ok: false, message: "date is required." },
      { status: 400 },
    );
  }

  const { error } = await supabaseServer
    .from("special_slot_settings")
    .delete()
    .eq("slot_type", defaultSlotType)
    .eq("date", date);

  if (error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
