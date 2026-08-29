$ErrorActionPreference = "Stop"

$Version = "17.11-1"
$ArchiveSha256 = "6eabdf00d2893713b75db4336a23c3fdf505f056e217ec6e2e95d901750cfea3"
$Source = "https://get.enterprisedb.com/postgresql/postgresql-$Version-windows-x64-binaries.zip"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Destination = Join-Path $Root "src-tauri/resources/bin/windows-x86_64"
$Archive = Join-Path $env:TEMP "postgresql-$Version-windows-x64-binaries.zip"
$Extracted = Join-Path $env:TEMP "kawashima-postgresql-$Version"

Invoke-WebRequest -Uri $Source -OutFile $Archive
if ((Get-FileHash -Path $Archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ArchiveSha256) {
  throw "PostgreSQL archive checksum mismatch"
}

if (Test-Path $Extracted) { Remove-Item $Extracted -Recurse -Force }
Expand-Archive -Path $Archive -DestinationPath $Extracted
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Destination "licenses") | Out-Null

$RuntimeFiles = @(
  "pg_dump.exe", "pg_restore.exe", "libpq.dll", "libintl-9.dll", "libiconv-2.dll",
  "libwinpthread-1.dll", "liblz4.dll", "libzstd.dll", "libcrypto-3-x64.dll", "libssl-3-x64.dll"
)
foreach ($File in $RuntimeFiles) {
  Copy-Item (Join-Path $Extracted "pgsql/bin/$File") (Join-Path $Destination $File) -Force
}
Copy-Item (Join-Path $Extracted "pgsql/pgAdmin 4/python/vcruntime140.dll") (Join-Path $Destination "vcruntime140.dll") -Force
Copy-Item (Join-Path $Extracted "pgsql/server_license.txt") (Join-Path $Destination "licenses/PostgreSQL-server-license.txt") -Force
Copy-Item (Join-Path $Extracted "pgsql/commandlinetools_3rd_party_licenses.txt") (Join-Path $Destination "licenses/commandlinetools-3rd-party-licenses.txt") -Force

Write-Host "PostgreSQL $Version Windows x64 runtime packaged from $Source"
