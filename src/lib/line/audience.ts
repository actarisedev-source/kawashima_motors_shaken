import { getAgeFromBirthDate } from "@/lib/customers/birth-date";
import { supabaseServer } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type Customer = Database["public"]["Tables"]["customers"]["Row"];
type Vehicle = Database["public"]["Tables"]["vehicles"]["Row"];
type Reservation = Database["public"]["Tables"]["reservations"]["Row"];

export type LineAudienceFilters = {
  shaken?: string[];
  visits?: string[];
  genders?: string[];
  ages?: string[];
  customerIds?: string[];
  query?: string;
};

export type LineAudienceMember = {
  customer: Customer;
  vehicles: Vehicle[];
  reservations: Reservation[];
  age: number | null;
};

const dateKey = (date: Date) =>
  new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(date);

const daysFromToday = (value: string) => {
  const today = new Date(`${dateKey(new Date())}T00:00:00+09:00`).getTime();
  const target = new Date(`${value}T00:00:00+09:00`).getTime();
  return Math.ceil((target - today) / 86_400_000);
};

const matchesAge = (age: number | null, filters: string[]) => {
  if (!filters.length) return true;
  if (age === null) return false;
  return filters.some((filter) => {
    if (filter === "10代") return age >= 13 && age <= 19;
    if (filter === "70代以上") return age >= 70;
    const decade = Number.parseInt(filter, 10);
    return age >= decade && age <= decade + 9;
  });
};

const matchesShaken = (vehicles: Vehicle[], filters: string[]) => {
  if (!filters.length) return true;
  return vehicles.some((vehicle) => {
    if (!vehicle.shaken_expiry_date) return false;
    const days = daysFromToday(vehicle.shaken_expiry_date);
    return filters.some((filter) => {
      if (filter === "期限切れ") return days < 0;
      const limit = Number.parseInt(filter, 10);
      return days >= 0 && days <= limit;
    });
  });
};

const matchesVisits = (reservations: Reservation[], filters: string[]) => {
  if (!filters.length) return true;
  const completed = reservations.filter((item) => item.status === "完了");
  const yearAgo = Date.now() - 365 * 86_400_000;
  return filters.some((filter) => {
    if (filter === "予約あり") return reservations.length > 0;
    if (filter === "予約なし") return reservations.length === 0;
    if (filter === "過去1年以内来店") {
      return completed.some(
        (item) => new Date(item.reserved_at).getTime() >= yearAgo,
      );
    }
    if (filter === "過去1年以上来店なし") {
      return !completed.some(
        (item) => new Date(item.reserved_at).getTime() >= yearAgo,
      );
    }
    return false;
  });
};

export async function getLineAudience(
  filters: LineAudienceFilters,
  linkedOnly = true,
) {
  let customersQuery = supabaseServer.from("customers").select("*");
  if (linkedOnly) {
    customersQuery = customersQuery
      .not("line_user_id", "is", null)
      .eq("line_status", "連携済み");
  }
  const [customersResult, vehiclesResult, reservationsResult] = await Promise.all([
    customersQuery,
    supabaseServer.from("vehicles").select("*"),
    supabaseServer.from("reservations").select("*"),
  ]);

  const error =
    customersResult.error || vehiclesResult.error || reservationsResult.error;
  if (error) throw new Error(error.message);

  const vehiclesByCustomer = new Map<string, Vehicle[]>();
  const reservationsByCustomer = new Map<string, Reservation[]>();
  for (const vehicle of vehiclesResult.data ?? []) {
    vehiclesByCustomer.set(vehicle.customer_id, [
      ...(vehiclesByCustomer.get(vehicle.customer_id) ?? []),
      vehicle,
    ]);
  }
  for (const reservation of reservationsResult.data ?? []) {
    reservationsByCustomer.set(reservation.customer_id, [
      ...(reservationsByCustomer.get(reservation.customer_id) ?? []),
      reservation,
    ]);
  }

  const selectedIds = new Set(filters.customerIds ?? []);
  const query = filters.query?.trim().toLocaleLowerCase("ja") ?? "";

  return (customersResult.data ?? [])
    .map((customer): LineAudienceMember => ({
      customer,
      vehicles: vehiclesByCustomer.get(customer.id) ?? [],
      reservations: reservationsByCustomer.get(customer.id) ?? [],
      age: getAgeFromBirthDate(customer.birth_date),
    }))
    .filter((member) => {
      if (selectedIds.size && !selectedIds.has(member.customer.id)) return false;
      if (
        filters.genders?.length &&
        !filters.genders.includes(member.customer.gender ?? "未設定")
      )
        return false;
      if (!matchesAge(member.age, filters.ages ?? [])) return false;
      if (!matchesShaken(member.vehicles, filters.shaken ?? [])) return false;
      if (!matchesVisits(member.reservations, filters.visits ?? [])) return false;
      if (query) {
        const haystack = [
          member.customer.name,
          member.customer.phone,
          ...member.vehicles.map((vehicle) => vehicle.plate_number),
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("ja");
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
}

const displayDate = (value: string | null | undefined) =>
  value ? value.replaceAll("-", "/") : "未登録";

export function renderLineMessage(
  template: string,
  member: LineAudienceMember,
) {
  const vehicle = [...member.vehicles].sort((a, b) =>
    (a.shaken_expiry_date ?? "9999-12-31").localeCompare(
      b.shaken_expiry_date ?? "9999-12-31",
    ),
  )[0];
  const reservation = [...member.reservations].sort((a, b) =>
    b.reserved_at.localeCompare(a.reserved_at),
  )[0];
  const values: Record<string, string> = {
    name: member.customer.name,
    phone: member.customer.phone ?? "未登録",
    vehicle_name: vehicle?.model_name ?? "未登録",
    plate_number: vehicle?.plate_number ?? "未登録",
    shaken_expiry_date: displayDate(vehicle?.shaken_expiry_date),
    reservation_date: reservation
      ? new Intl.DateTimeFormat("ja-JP", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "Asia/Tokyo",
        }).format(new Date(reservation.reserved_at))
      : "未登録",
    age: member.age === null ? "未登録" : `${member.age}`,
  };
  return template.replace(/\{\{([a-z_]+)\}\}/g, (_, key: string) =>
    key in values ? values[key] : `{{${key}}}`,
  );
}
