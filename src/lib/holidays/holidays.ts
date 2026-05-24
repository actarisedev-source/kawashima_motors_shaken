import { getJstDateKey } from "@/lib/reservations/slots";
import { supabaseServer } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const holidayTypes = ["single", "weekly"] as const;

export type HolidayType = (typeof holidayTypes)[number];
export type HolidayRow = Database["public"]["Tables"]["holidays"]["Row"];

export const weekdayLabels = ["日", "月", "火", "水", "木", "金", "土"] as const;

export const isHolidayType = (value: unknown): value is HolidayType =>
  typeof value === "string" && holidayTypes.includes(value as HolidayType);

export const getJstWeekday = (value: string | Date) => {
  const dateKey = getJstDateKey(value);
  return new Date(`${dateKey}T00:00:00+09:00`).getDay();
};

export const normalizeHoliday = (holiday: HolidayRow) => ({
  id: holiday.id,
  type: holiday.type,
  date: holiday.date,
  weekday: holiday.weekday,
  label: holiday.label,
  createdAt: holiday.created_at,
});

export const fetchHolidays = async () => {
  const { data, error } = await supabaseServer
    .from("holidays")
    .select("*")
    .order("created_at", { ascending: false });

  return { data: data ?? [], error };
};

export const findHolidayForDate = (
  date: string | Date,
  holidays: HolidayRow[],
) => {
  const dateKey = getJstDateKey(date);
  const weekday = getJstWeekday(date);

  return holidays.find((holiday) => {
    if (holiday.type === "single") {
      return holiday.date === dateKey;
    }

    return holiday.weekday === weekday;
  });
};
