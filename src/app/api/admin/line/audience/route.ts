import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAdminAuthFromRequest } from "@/lib/auth/admin-session";
import {
  getLineAudience,
  type LineAudienceFilters,
} from "@/lib/line/audience";
import { getLineConfig } from "@/lib/line/config";

const isAuthenticated = async (request: NextRequest) =>
  (await getAdminAuthFromRequest(request)).authenticated;

export async function POST(request: NextRequest) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json(
      { ok: false, message: "ログインが必要です。" },
      { status: 401 },
    );
  }

  try {
    const filters = (await request.json()) as LineAudienceFilters;
    const [audience, allMatches] = await Promise.all([
      getLineAudience(filters),
      getLineAudience(filters, false),
    ]);
    return NextResponse.json({
      ok: true,
      configured: Boolean(getLineConfig().channelAccessToken),
      count: audience.length,
      excludedCount: Math.max(allMatches.length - audience.length, 0),
      customers: audience.slice(0, 100).map((member) => ({
        id: member.customer.id,
        name: member.customer.name,
        phone: member.customer.phone ?? "",
        gender: member.customer.gender ?? "未設定",
        vehiclePlateNumbers: member.vehicles
          .map((vehicle) => vehicle.plate_number)
          .filter(Boolean),
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "対象件数の取得に失敗しました。",
      },
      { status: 500 },
    );
  }
}
