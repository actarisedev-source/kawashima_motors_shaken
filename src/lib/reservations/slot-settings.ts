import {
  defaultSlotType,
  getJstDateKey,
  getJstWeekday,
  reservationSlotCapacity,
  reservationTimeSlots,
  type ReservationTimeSlot,
} from "@/lib/reservations/slots";
import { supabaseServer } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export type SlotSettingRow =
  Database["public"]["Tables"]["slot_settings"]["Row"];
export type SpecialSlotSettingRow =
  Database["public"]["Tables"]["special_slot_settings"]["Row"];

export type SlotCapacityMap = Record<string, Record<ReservationTimeSlot, number>>;

const createDefaultDayCapacity = () =>
  Object.fromEntries(
    reservationTimeSlots.map((time) => [time, reservationSlotCapacity]),
  ) as Record<ReservationTimeSlot, number>;

export const createDefaultWeeklyCapacity = () =>
  Object.fromEntries(
    Array.from({ length: 7 }, (_, weekday) => [
      weekday,
      createDefaultDayCapacity(),
    ]),
  ) as SlotCapacityMap;

export const fetchSlotSettings = async (slotType = defaultSlotType) => {
  const [{ data: weekly, error: weeklyError }, { data: special, error: specialError }] =
    await Promise.all([
      supabaseServer
        .from("slot_settings")
        .select("*")
        .eq("slot_type", slotType)
        .order("weekday", { ascending: true })
        .order("time", { ascending: true }),
      supabaseServer
        .from("special_slot_settings")
        .select("*")
        .eq("slot_type", slotType)
        .order("date", { ascending: true })
        .order("time", { ascending: true }),
    ]);

  return {
    weekly: weekly ?? [],
    special: special ?? [],
    error: weeklyError ?? specialError,
  };
};

export const buildWeeklyCapacityMap = (settings: SlotSettingRow[]) => {
  const weekly = createDefaultWeeklyCapacity();

  for (const setting of settings) {
    if (
      setting.weekday >= 0 &&
      setting.weekday <= 6 &&
      reservationTimeSlots.includes(setting.time as ReservationTimeSlot)
    ) {
      weekly[String(setting.weekday)][setting.time as ReservationTimeSlot] =
        setting.capacity;
    }
  }

  return weekly;
};

export const buildSpecialCapacityMap = (
  settings: SpecialSlotSettingRow[],
) => {
  const special = new Map<string, Partial<Record<ReservationTimeSlot, number>>>();

  for (const setting of settings) {
    if (!reservationTimeSlots.includes(setting.time as ReservationTimeSlot)) {
      continue;
    }

    const current = special.get(setting.date) ?? {};
    current[setting.time as ReservationTimeSlot] = setting.capacity;
    special.set(setting.date, current);
  }

  return special;
};

export const getSlotCapacity = ({
  date,
  time,
  weekly,
  special,
}: {
  date: string | Date;
  time: ReservationTimeSlot;
  weekly: SlotCapacityMap;
  special: Map<string, Partial<Record<ReservationTimeSlot, number>>>;
}) => {
  const dateKey = getJstDateKey(date);
  const specialDay = special.get(dateKey);

  if (specialDay) {
    return specialDay[time] ?? 0;
  }

  const weekday = getJstWeekday(date);
  return weekly[String(weekday)]?.[time] ?? reservationSlotCapacity;
};

export const getSlotCapacitiesForDate = ({
  date,
  weekly,
  special,
}: {
  date: string | Date;
  weekly: SlotCapacityMap;
  special: Map<string, Partial<Record<ReservationTimeSlot, number>>>;
}) =>
  Object.fromEntries(
    reservationTimeSlots.map((time) => [
      time,
      getSlotCapacity({ date, time, weekly, special }),
    ]),
  ) as Record<ReservationTimeSlot, number>;
