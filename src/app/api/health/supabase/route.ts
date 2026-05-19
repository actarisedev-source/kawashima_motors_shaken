import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

const tables = ["customers", "vehicles", "reservations", "line_profiles"] as const;

export async function GET() {
  const checks = await Promise.all(
    tables.map(async (table) => {
      const { error } = await supabaseServer.from(table).select("id").limit(1);

      return {
        table,
        ok: !error,
        error: error?.message ?? null,
      };
    }),
  );

  const ok = checks.every((check) => check.ok);

  return NextResponse.json({ ok, checks }, { status: ok ? 200 : 503 });
}
