import { NextResponse } from "next/server";
import { getLineConfigurationStatus } from "@/lib/line/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const configuration = getLineConfigurationStatus();

  return NextResponse.json({
    ok: configuration.webhook,
    configuration,
  });
}
