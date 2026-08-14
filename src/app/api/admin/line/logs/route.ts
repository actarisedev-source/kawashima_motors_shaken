import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAdminAuthFromRequest } from "@/lib/auth/admin-session";
import { supabaseServer } from "@/lib/supabase/server";

const defaultPageSize = 20;
const maxPageSize = 100;

const quotePostgrestPattern = (keyword: string) =>
  `"*${keyword.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}*"`;

const parsePositiveInteger = (
  value: string | null,
  fallback: number,
  maxValue?: number,
) => {
  const parsed = Number(value ?? "");
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return maxValue ? Math.min(parsed, maxValue) : parsed;
};

export async function GET(request: NextRequest) {
  const auth = await getAdminAuthFromRequest(request);
  if (!auth.authenticated) {
    return NextResponse.json(
      { ok: false, message: "ログインが必要です。" },
      { status: 401 },
    );
  }

  const page = parsePositiveInteger(request.nextUrl.searchParams.get("page"), 1);
  const pageSize = parsePositiveInteger(
    request.nextUrl.searchParams.get("page_size"),
    defaultPageSize,
    maxPageSize,
  );
  const search = (request.nextUrl.searchParams.get("search") ?? "")
    .normalize("NFKC")
    .trim();

  if (search.length > 100) {
    return NextResponse.json(
      { ok: false, message: "検索文字は100文字以内で入力してください。" },
      { status: 400 },
    );
  }

  let customerIds: string[] = [];
  if (search) {
    const pattern = quotePostgrestPattern(search);
    const { data: customers, error: customerError } = await supabaseServer
      .from("customers")
      .select("id")
      .or(
        [
          `name.ilike.${pattern}`,
          `line_display_name.ilike.${pattern}`,
          `phone.ilike.${pattern}`,
        ].join(","),
      );
    if (customerError) {
      return NextResponse.json(
        { ok: false, message: customerError.message },
        { status: 500 },
      );
    }
    customerIds = (customers ?? []).map((customer) => customer.id);
  }

  let query = supabaseServer
    .from("line_message_logs")
    .select(
      "id,customer_id,target_type,title,body,status,error_message,image_url,image_urls,sent_at,created_at,automation_type",
      { count: "exact" },
    )
    .order("created_at", { ascending: false });

  if (search) {
    const pattern = quotePostgrestPattern(search);
    const conditions = [
      `target_type.ilike.${pattern}`,
      `title.ilike.${pattern}`,
      `body.ilike.${pattern}`,
      `status.ilike.${pattern}`,
      `error_message.ilike.${pattern}`,
      `line_user_id.ilike.${pattern}`,
      `automation_type.ilike.${pattern}`,
    ];
    if (customerIds.length) {
      conditions.push(`customer_id.in.(${customerIds.join(",")})`);
    }
    query = query.or(conditions.join(","));
  }

  const rangeStart = (page - 1) * pageSize;
  const rangeEnd = rangeStart + pageSize - 1;
  const { data, error, count } = await query.range(rangeStart, rangeEnd);

  if (error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 500 },
    );
  }

  const total = count ?? 0;
  return NextResponse.json({
    ok: true,
    logs: data ?? [],
    total,
    page,
    page_size: pageSize,
    total_pages: Math.max(1, Math.ceil(total / pageSize)),
  });
}
