# Crop the OS-drawn title bar (with the old "recordr" wordmark) off each site
# screenshot, then place them under marketing-site/public/shots-user/.
# The app's own chrome is cropped, not the whole window: the site's hero frame
# supplies its own "unrecordable" branded chrome around the image.
Add-Type -AssemblyName System.Drawing

$map = @(
    # <src>, <dst>, <top crop px>, <bottom crop px>, <left crop>, <right crop>
    @{s='Untitled.png';              d='hero-modern.png';       t=100; b=86; l=0;  r=0}
    @{s='Untitl2d.png';              d='kawaii-grid.png';       t=82;  b=80; l=0;  r=0}
    @{s='Unt5656tle3674d.png';       d='bloodred-grid.png';     t=100; b=86; l=0;  r=0}
    @{s='Untitle34d.png';            d='modern-midi.png';       t=100; b=64; l=0;  r=0}
    @{s='Unt5656tle34d.png';         d='red-midi.png';          t=100; b=64; l=0;  r=0}
    @{s='Unt5656tle4564563674d.png'; d='docked.png';            t=0;   b=0;  l=0;  r=0}
)

$root = 'Z:\GITHUB\rec\recordr\screenshots'
$out  = 'Z:\GITHUB\rec\recordr\marketing-site\public\shots-user'
New-Item -ItemType Directory -Force -Path $out | Out-Null

foreach ($m in $map) {
    $src = Join-Path $root $m.s
    $dst = Join-Path $out $m.d
    $img = [System.Drawing.Image]::FromFile($src)
    $cw = $img.Width  - $m.l - $m.r
    $ch = $img.Height - $m.t - $m.b
    $bmp = New-Object System.Drawing.Bitmap($cw, $ch)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $dstRect = New-Object System.Drawing.Rectangle(0, 0, $cw, $ch)
    $srcRect = New-Object System.Drawing.Rectangle($m.l, $m.t, $cw, $ch)
    $g.DrawImage($img, $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()
    $bmp.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $img.Dispose()
    Write-Output ($m.d + '  ' + $cw + 'x' + $ch)
}
Write-Output 'done'
