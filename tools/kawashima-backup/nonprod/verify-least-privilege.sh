#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
PSQL=${PSQL:-/opt/homebrew/opt/postgresql@17/bin/psql}
PG_DUMP=${PG_DUMP:-"$ROOT/tools/kawashima-backup/src-tauri/resources/bin/macos-aarch64/pg_dump"}
PG_RESTORE=${PG_RESTORE:-"$ROOT/tools/kawashima-backup/src-tauri/resources/bin/macos-aarch64/pg_restore"}
DB_URL=${DB_URL:-postgresql://supabase_admin:postgres@127.0.0.1:55422/postgres}
API_URL=${API_URL:-http://127.0.0.1:55421}
WIN_ROLE=kawashima_backup_win
MAC_ROLE=kawashima_backup_mac
SERVICE_KEY=
WIN_UID=
MAC_UID=

case "$DB_URL" in
  postgresql://*@127.0.0.1:55422/postgres) ;;
  *) echo "Refusing non-local database URL." >&2; exit 1 ;;
esac

for command_path in "$PSQL" "$PG_DUMP" "$PG_RESTORE"; do
  test -x "$command_path" || { echo "Missing executable." >&2; exit 1; }
done
for command_name in curl node openssl supabase; do
  command -v "$command_name" >/dev/null 2>&1 || { echo "Missing command: $command_name" >&2; exit 1; }
done

TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/kawashima-phase4a2.XXXXXX")
chmod 700 "$TEMP_DIR"
cleanup() {
  if [ -n "$SERVICE_KEY" ]; then
    curl -sS -X DELETE "$API_URL/storage/v1/object/line-message-images/phase4a2/readable.png" -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" >/dev/null 2>&1 || true
    curl -sS -X DELETE "$API_URL/storage/v1/object/phase4a2-other-bucket/forbidden.png" -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" >/dev/null 2>&1 || true
    curl -sS -X POST "$API_URL/storage/v1/bucket/phase4a2-other-bucket/empty" -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" >/dev/null 2>&1 || true
    curl -sS -X DELETE "$API_URL/storage/v1/bucket/phase4a2-other-bucket" -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" >/dev/null 2>&1 || true
    for user_id in "$WIN_UID" "$MAC_UID"; do
      if [ -n "$user_id" ]; then
        curl -sS -X DELETE "$API_URL/auth/v1/admin/users/$user_id" -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" >/dev/null 2>&1 || true
      fi
    done
  fi
  "$PSQL" "$DB_URL" -v ON_ERROR_STOP=1 -c "drop policy if exists \"backup endpoint windows read line images\" on storage.objects; drop policy if exists \"backup endpoint mac read line images\" on storage.objects; drop policy if exists \"backup endpoint windows read line bucket\" on storage.buckets; drop policy if exists \"backup endpoint mac read line bucket\" on storage.buckets;" >/dev/null 2>&1 || true
  "$PSQL" "$DB_URL" -v ON_ERROR_STOP=1 -c "drop owned by $WIN_ROLE; drop owned by $MAC_ROLE; drop role if exists $WIN_ROLE; drop role if exists $MAC_ROLE;" >/dev/null 2>&1 || true
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT INT TERM

STATUS=$(cd "$ROOT" && supabase status -o env)
ANON_KEY=$(printf '%s\n' "$STATUS" | sed -n 's/^ANON_KEY="\([^"]*\)"/\1/p')
SERVICE_KEY=$(printf '%s\n' "$STATUS" | sed -n 's/^SERVICE_ROLE_KEY="\([^"]*\)"/\1/p')
test -n "$ANON_KEY"
test -n "$SERVICE_KEY"

# Remove fixtures left by an interrupted prior local-only run.
"$PSQL" "$DB_URL" -Atc "select id from auth.users where email like 'backup-%@nonprod.invalid'" | while IFS= read -r stale_uid; do
  test -z "$stale_uid" || curl -sS -X DELETE "$API_URL/auth/v1/admin/users/$stale_uid" -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" >/dev/null
done

WIN_DB_PASSWORD=$(openssl rand -base64 36 | tr -d '\n')
MAC_DB_PASSWORD=$(openssl rand -base64 36 | tr -d '\n')
WIN_AUTH_PASSWORD=$(openssl rand -base64 36 | tr -d '\n')
MAC_AUTH_PASSWORD=$(openssl rand -base64 36 | tr -d '\n')
WIN_EMAIL="backup-win-$(date +%s)@nonprod.invalid"
MAC_EMAIL="backup-mac-$(date +%s)@nonprod.invalid"

"$PSQL" "$DB_URL" -v win_role="$WIN_ROLE" -v mac_role="$MAC_ROLE" -v win_password="$WIN_DB_PASSWORD" -v mac_password="$MAC_DB_PASSWORD" -f "$ROOT/tools/kawashima-backup/nonprod/create-backup-roles.sql" >/dev/null
"$PSQL" "$DB_URL" -f "$ROOT/tools/kawashima-backup/nonprod/harden-storage-auth-role.sql" >/dev/null

create_user() {
  email=$1
  password=$2
  output=$3
  curl -fsS "$API_URL/auth/v1/admin/users" -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" -H "Content-Type: application/json" --data "{\"email\":\"$email\",\"password\":\"$password\",\"email_confirm\":true}" >"$output"
}
json_field() {
  node -e 'const fs=require("fs"); const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))[process.argv[2]]; if(!value) process.exit(1); process.stdout.write(value)' "$1" "$2"
}
login_user() {
  email=$1
  password=$2
  output=$3
  curl -fsS "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H "Content-Type: application/json" --data "{\"email\":\"$email\",\"password\":\"$password\"}" >"$output"
}

create_user "$WIN_EMAIL" "$WIN_AUTH_PASSWORD" "$TEMP_DIR/win-user.json"
create_user "$MAC_EMAIL" "$MAC_AUTH_PASSWORD" "$TEMP_DIR/mac-user.json"
WIN_UID=$(json_field "$TEMP_DIR/win-user.json" id)
MAC_UID=$(json_field "$TEMP_DIR/mac-user.json" id)
login_user "$WIN_EMAIL" "$WIN_AUTH_PASSWORD" "$TEMP_DIR/win-login.json"
login_user "$MAC_EMAIL" "$MAC_AUTH_PASSWORD" "$TEMP_DIR/mac-login.json"
WIN_JWT=$(json_field "$TEMP_DIR/win-login.json" access_token)
MAC_JWT=$(json_field "$TEMP_DIR/mac-login.json" access_token)

"$PSQL" "$DB_URL" -v win_uid="$WIN_UID" -v mac_uid="$MAC_UID" -f "$ROOT/tools/kawashima-backup/nonprod/storage-endpoint-policies.sql" >/dev/null

create_bucket() {
  bucket=$1
  status=$(curl -sS -o "$TEMP_DIR/bucket.json" -w '%{http_code}' "$API_URL/storage/v1/bucket" -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" -H "Content-Type: application/json" --data "{\"id\":\"$bucket\",\"name\":\"$bucket\",\"public\":false}")
  if [ "$status" != 200 ]; then
    curl -fsS "$API_URL/storage/v1/bucket/$bucket" -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" >/dev/null
  fi
}
create_bucket line-message-images
create_bucket phase4a2-other-bucket
printf '\211PNG\r\n\032\nsynthetic-non-production' >"$TEMP_DIR/object.png"
curl -fsS "$API_URL/storage/v1/object/line-message-images/phase4a2/readable.png" -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" -H "x-upsert: true" -H "Content-Type: image/png" --data-binary @"$TEMP_DIR/object.png" >/dev/null
curl -fsS "$API_URL/storage/v1/object/phase4a2-other-bucket/forbidden.png" -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" -H "x-upsert: true" -H "Content-Type: image/png" --data-binary @"$TEMP_DIR/object.png" >/dev/null

storage_status() {
  method=$1
  url=$2
  token=$3
  shift 3
  curl -sS -o "$TEMP_DIR/storage-response" -w '%{http_code}' -X "$method" "$url" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $token" "$@"
}
assert_success() { case "$1" in 2??) ;; *) echo "Expected success, got HTTP $1" >&2; exit 1;; esac; }
assert_failure() { case "$1" in 2??) echo "Expected rejection for $2, got HTTP $1" >&2; exit 1;; *) :;; esac; }

for token in "$WIN_JWT" "$MAC_JWT"; do
  status=$(storage_status GET "$API_URL/storage/v1/bucket/line-message-images" "$token")
  assert_success "$status"
  status=$(storage_status POST "$API_URL/storage/v1/object/list/line-message-images" "$token" -H "Content-Type: application/json" --data '{"prefix":"phase4a2","limit":100,"offset":0}')
  assert_success "$status"
  grep -q 'readable.png' "$TEMP_DIR/storage-response"
  status=$(storage_status GET "$API_URL/storage/v1/object/authenticated/line-message-images/phase4a2/readable.png" "$token")
  assert_success "$status"
  status=$(storage_status POST "$API_URL/storage/v1/object/line-message-images/phase4a2/write.png" "$token" -H "Content-Type: image/png" --data-binary @"$TEMP_DIR/object.png")
  assert_failure "$status" "target-bucket insert"
  status=$(storage_status PUT "$API_URL/storage/v1/object/line-message-images/phase4a2/readable.png" "$token" -H "Content-Type: image/png" --data-binary @"$TEMP_DIR/object.png")
  assert_failure "$status" "target-bucket update"
  status=$(storage_status DELETE "$API_URL/storage/v1/object/line-message-images/phase4a2/readable.png" "$token")
  assert_failure "$status" "target-bucket delete"
  status=$(storage_status POST "$API_URL/storage/v1/object/list/phase4a2-other-bucket" "$token" -H "Content-Type: application/json" --data '{"prefix":"","limit":100,"offset":0}')
  assert_success "$status"
  if grep -q 'forbidden.png' "$TEMP_DIR/storage-response"; then
    echo "Other bucket object was exposed." >&2
    exit 1
  fi
  status=$(storage_status GET "$API_URL/storage/v1/object/authenticated/phase4a2-other-bucket/forbidden.png" "$token")
  assert_failure "$status" "other-bucket download"

  status=$(storage_status GET "$API_URL/rest/v1/line_message_logs?select=id&limit=1" "$token")
  assert_failure "$status" "public-table read"
  status=$(storage_status POST "$API_URL/rest/v1/line_message_logs" "$token" -H "Content-Type: application/json" --data '{}')
  assert_failure "$status" "public-table write"
done

"$PSQL" "$DB_URL" -c 'drop policy "backup endpoint windows read line images" on storage.objects; drop policy "backup endpoint windows read line bucket" on storage.buckets' >/dev/null
status=$(storage_status GET "$API_URL/storage/v1/bucket/line-message-images" "$WIN_JWT")
assert_failure "$status" "revoked Windows target-bucket metadata"
status=$(storage_status POST "$API_URL/storage/v1/object/list/line-message-images" "$WIN_JWT" -H "Content-Type: application/json" --data '{"prefix":"phase4a2","limit":100,"offset":0}')
assert_success "$status"
if grep -q 'readable.png' "$TEMP_DIR/storage-response"; then
  echo "Revoked Windows endpoint can still list target objects." >&2
  exit 1
fi
status=$(storage_status POST "$API_URL/storage/v1/object/list/line-message-images" "$MAC_JWT" -H "Content-Type: application/json" --data '{"prefix":"phase4a2","limit":100,"offset":0}')
assert_success "$status"
grep -q 'readable.png' "$TEMP_DIR/storage-response"
"$PSQL" "$DB_URL" -c 'drop policy "backup endpoint mac read line images" on storage.objects; drop policy "backup endpoint mac read line bucket" on storage.buckets' >/dev/null
status=$(storage_status GET "$API_URL/storage/v1/bucket/line-message-images" "$MAC_JWT")
assert_failure "$status" "revoked macOS target-bucket metadata"
status=$(storage_status POST "$API_URL/storage/v1/object/list/line-message-images" "$MAC_JWT" -H "Content-Type: application/json" --data '{"prefix":"phase4a2","limit":100,"offset":0}')
assert_success "$status"
if grep -q 'readable.png' "$TEMP_DIR/storage-response"; then
  echo "Revoked macOS endpoint can still list target objects." >&2
  exit 1
fi

expect_db_failure() {
  role=$1
  password=$2
  sql=$3
  if PGPASSWORD="$password" "$PSQL" "postgresql://$role@127.0.0.1:55422/postgres" -v ON_ERROR_STOP=1 -c "$sql" >"$TEMP_DIR/db-output" 2>&1; then
    echo "Expected DB rejection for a prohibited statement." >&2
    exit 1
  fi
}

for tuple in "$WIN_ROLE:$WIN_DB_PASSWORD" "$MAC_ROLE:$MAC_DB_PASSWORD"; do
  role=${tuple%%:*}
  password=${tuple#*:}
  PGPASSWORD="$password" "$PSQL" "postgresql://$role@127.0.0.1:55422/postgres" -v ON_ERROR_STOP=1 -Atc "select count(*) from information_schema.tables where table_schema='public'" >/dev/null
  expect_db_failure "$role" "$password" "insert into public.reservations default values"
  expect_db_failure "$role" "$password" "update public.reservations set id=id where false"
  expect_db_failure "$role" "$password" "delete from public.reservations where false"
  expect_db_failure "$role" "$password" "truncate public.reservations"
  expect_db_failure "$role" "$password" "create table public.phase4a2_forbidden(id integer)"
  expect_db_failure "$role" "$password" "alter table public.reservations add column phase4a2_forbidden integer"
  expect_db_failure "$role" "$password" "drop table public.reservations"
  expect_db_failure "$role" "$password" "set default_transaction_read_only=off; insert into public.reservations default values"
done

ROLE_ATTRIBUTE_COUNT=$("$PSQL" "$DB_URL" -Atc "select count(*) from pg_roles where rolname in ('$WIN_ROLE','$MAC_ROLE') and rolcanlogin and rolbypassrls and not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication")
[ "$ROLE_ATTRIBUTE_COUNT" = 2 ] || { echo "Backup role attributes are not least privilege." >&2; exit 1; }

SECURITY_DEFINER_COUNT=$("$PSQL" "$DB_URL" -Atc "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and (has_function_privilege('kawashima_backup_win',p.oid,'execute') or has_function_privilege('kawashima_backup_mac',p.oid,'execute'))")
[ "$SECURITY_DEFINER_COUNT" = 0 ] || { echo "Backup roles can execute SECURITY DEFINER functions." >&2; exit 1; }
AUTHENTICATED_TABLE_GRANT_COUNT=$("$PSQL" "$DB_URL" -Atc "select count(*) from information_schema.role_table_grants where grantee='authenticated' and table_schema='public'")
[ "$AUTHENTICATED_TABLE_GRANT_COUNT" = 0 ] || { echo "authenticated retains public table grants." >&2; exit 1; }
AUTHENTICATED_SECURITY_DEFINER_COUNT=$("$PSQL" "$DB_URL" -Atc "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and (has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('public',p.oid,'execute'))")
[ "$AUTHENTICATED_SECURITY_DEFINER_COUNT" = 0 ] || { echo "authenticated can execute a public SECURITY DEFINER function." >&2; exit 1; }

BASE_DUMP="$TEMP_DIR/baseline.dump"
WIN_DUMP="$TEMP_DIR/win.dump"
PGPASSWORD=postgres "$PG_DUMP" --host 127.0.0.1 --port 55422 --username supabase_admin --dbname postgres --format custom --schema public --no-owner --no-acl --file "$BASE_DUMP"
PGPASSWORD="$WIN_DB_PASSWORD" "$PG_DUMP" --host 127.0.0.1 --port 55422 --username "$WIN_ROLE" --dbname postgres --format custom --schema public --no-owner --no-acl --file "$WIN_DUMP"
"$PG_RESTORE" --list "$BASE_DUMP" | sed '/^;/d' >"$TEMP_DIR/baseline.list"
"$PG_RESTORE" --list "$WIN_DUMP" | sed '/^;/d' >"$TEMP_DIR/win.list"
diff -u "$TEMP_DIR/baseline.list" "$TEMP_DIR/win.list" >/dev/null

"$PSQL" "$DB_URL" -Atc "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1" >"$TEMP_DIR/tables"
: >"$TEMP_DIR/baseline-rows"
: >"$TEMP_DIR/endpoint-rows"
while IFS= read -r table; do
  baseline=$("$PSQL" "$DB_URL" -Atc "select count(*) from public.\"$table\"")
  endpoint=$(PGPASSWORD="$WIN_DB_PASSWORD" "$PSQL" "postgresql://$WIN_ROLE@127.0.0.1:55422/postgres" -Atc "select count(*) from public.\"$table\"")
  printf '%s\t%s\n' "$table" "$baseline" >>"$TEMP_DIR/baseline-rows"
  printf '%s\t%s\n' "$table" "$endpoint" >>"$TEMP_DIR/endpoint-rows"
  [ "$baseline" = "$endpoint" ] || { echo "Row count mismatch: $table" >&2; exit 1; }
done <"$TEMP_DIR/tables"
diff -u "$TEMP_DIR/baseline-rows" "$TEMP_DIR/endpoint-rows" >/dev/null

"$PSQL" "$DB_URL" -Atc "select sequence_name from information_schema.sequences where sequence_schema='public' order by 1" >"$TEMP_DIR/sequences"
while IFS= read -r sequence; do
  test -z "$sequence" && continue
  baseline=$("$PSQL" "$DB_URL" -Atc "select last_value from public.\"$sequence\"")
  endpoint=$(PGPASSWORD="$WIN_DB_PASSWORD" "$PSQL" "postgresql://$WIN_ROLE@127.0.0.1:55422/postgres" -Atc "select last_value from public.\"$sequence\"")
  [ "$baseline" = "$endpoint" ] || { echo "Sequence mismatch: $sequence" >&2; exit 1; }
done <"$TEMP_DIR/sequences"

"$PSQL" "$DB_URL" -v win_role="$WIN_ROLE" -v mac_role="$MAC_ROLE" -f "$ROOT/tools/kawashima-backup/nonprod/audit-privileges.sql" >"$TEMP_DIR/privilege-audit.txt"

node - "$TEMP_DIR" <<'NODE'
const fs = require("fs");
const path = require("path");
const dir = process.argv[2];
const report = {
  environment: "local Supabase only",
  endpoints: ["windows", "macos"],
  database: {
    select: "allowed",
    mutationsAndDdl: "rejected",
    bypassRls: true,
    securityDefinerExecutable: false,
    pgDumpLogicalTocEqual: true,
    tableCount: fs.readFileSync(path.join(dir, "tables"), "utf8").trim().split("\n").filter(Boolean).length,
    sequenceCount: fs.readFileSync(path.join(dir, "sequences"), "utf8").trim().split("\n").filter(Boolean).length,
  },
  storage: {
    targetBucketSelect: "allowed",
    targetBucketWrites: "rejected",
    otherBucketObjectsExposed: false,
    independentRevocation: "verified by endpoint policy removal",
    authenticatedPublicAccess: "rejected",
  },
  secretsPersisted: false,
};
fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
NODE
