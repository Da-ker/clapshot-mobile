# Sync from NAS -> Local (Clapshot)
# Rules: do NOT bring node_modules/.next/etc to local; we build locally anyway.

$NAS_PATH   = "\\192.168.1.169\EnderChest\Repository\Clapshot"
$LOCAL_PATH = "D:\Clapshot"

Write-Host "[NAS -> Local] Sync Clapshot" -ForegroundColor Cyan
Write-Host "  From: $NAS_PATH" -ForegroundColor Gray
Write-Host "  To:   $LOCAL_PATH" -ForegroundColor Gray

# Mirror source tree BUT keep local-only folder .local
robocopy $NAS_PATH $LOCAL_PATH /MIR /XD node_modules dist .next .turbo .vite build coverage .local /MT:8 /NFL /NDL

Write-Host "Done." -ForegroundColor Green
