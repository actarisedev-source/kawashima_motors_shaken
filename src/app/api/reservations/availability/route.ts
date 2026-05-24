import { NextResponse } from "next/server";
import { fetchHolidays, findHolidayForDate } from "@/lib/holidays/holidays";
import {
  getJstDateKey,
  getJstTimeKey,
  getMonthRangeFromJstMonth,
  reservationSlotCapacity,
  reservationTimeSlots,
} from "@/lib/reservations/slots";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month");

  if (!month) {
    return NextResponse.json(
      { ok: false, message: "month is required." },
      { status: 400 },
    );
  }

  const range = getMonthRangeFromJstMonth(month);

  if (!range) {
    return NextResponse.json(
      { ok: false, message: "month must be YYYY-MM." },
      { status: 400 },
    );
  }

  const { data, error } = await supabaseServer
    .from("reservations")
    .select("id,reserved_at,status")
    .neq("status", "キャンセル")
    .gte("reserved_at", range.start.toISOString())
    .lt("reserved_at", range.end.toISOString());

  if (error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 500 },
    );
  }

  const { data: holidays, error: holidaysError } = await fetchHolidays();
  const holidaysUnavailable = holidaysError?.code === "PGRST205";

  if (holidaysError && !holidaysUnavailable) {
    return NextResponse.json(
      { ok: false, message: holidaysError.message },
      { status: 500 },
    );
  }

  const countsByDateTime = new Map<string, number>();

  for (const reservation of data ?? []) {
    const date = getJstDateKey(reservation.reserved_at);
    const time = getJstTimeKey(reservation.reserved_at);
    const key = `${date}T${time}`;
    countsByDateTime.set(key, (countsByDateTime.get(key) ?? 0) + 1);
  }

  const days: Record<
    string,
    {
      totalReserved: number;
      totalCapacity: number;
      holiday: {
        id: string;
        type: "single" | "weekly";
        label: string | null;
      } | null;
      slots: Record<
        string,
        { reservedCount: number; capacity: number; available: boolean }
      >;
    }
  > = {};

  for (let date = new Date(range.start); date < range.end; date.setDate(date.getDate() + 1)) {
    const dateKey = getJstDateKey(date);
    const slots: Record<
      string,
      { reservedCount: number; capacity: number; available: boolean }
    > = {};

    for (const time of reservationTimeSlots) {
      const reservedCount = countsByDateTime.get(`${dateKey}T${time}`) ?? 0;
      const holiday = holidaysUnavailable ? undefined : findHolidayForDate(date, holidays);
      slots[time] = {
        reservedCount,
        capacity: reservationSlotCapacity,
        available: !holiday && reservedCount < reservationSlotCapacity,
      };
    }

    const totalReserved = Object.values(slots).reduce(
      (sum, slot) => sum + slot.reservedCount,
      0,
    );

    days[dateKey] = {
      totalReserved,
      totalCapacity: reservationTimeSlots.length * reservationSlotCapacity,
      holiday: holidaysUnavailable
        ? null
        : (() => {
            const holiday = findHolidayForDate(date, holidays);
            return holiday
              ? {
                  id: holiday.id,
                  type: holiday.type,
                  label: holiday.label,
                }
              : null;
          })(),
      slots,
    };
  }

  return NextResponse.json({
    ok: true,
    month,
    slotCapacity: reservationSlotCapacity,
    timeSlots: reservationTimeSlots,
    days,
  });
}
