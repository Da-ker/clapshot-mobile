# Sync from Local -> NAS (Clapshot)
# Rules: NEVER upload node_modules/.next/etc to NAS.
# Allowed to sync: source changes + dist (build output).

$NAS_PATH   = "\\192.168.1.169\EnderChest\Repository\Clapshot"
$LOCAL_PATH = "D:\Clapshot"

Write-Host "[Local -> NAS] Sync Clapshot" -ForegroundColor Cyan
Write-Host "  From: $LOCAL_PATH" -ForegroundColor Gray
Write-Host "  To:   $NAS_PATH" -ForegroundColor Gray

# 1) Sync source (exclude build outputs and caches)
robocopy $LOCAL_PATH $NAS_PATH /MIR /XD node_modules dist .next .turbo .vite build coverage .local /MT:8 /NFL /NDL

# 2) Sync dist (allowed) if present
if (Test-Path "$LOCAL_PATH\client\dist") {
  Write-Host "Syncing client/dist ..." -ForegroundColor Yellow
  robocopy "$LOCAL_PATH\client\dist" "$NAS_PATH\client\dist" /MIR /XD node_modules /MT:8 /NFL /NDL
}

Write-Host "Done." -ForegroundColor Green
