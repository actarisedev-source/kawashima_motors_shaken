import { NextResponse } from "next/server";
import { isLineConfigured } from "@/lib/line/config";

export async function GET() {
  return NextResponse.json({
    ok: true,
    configured: isLineConfigured,
  });
}

export async function POST() {
  if (!isLineConfigured) {
    return NextResponse.json(
      {
        ok: false,
        message: "LINE channel secret and access token are not configured.",
      },
      { status: 501 },
    );
  }

  return NextResponse.json({ ok: true });
}
