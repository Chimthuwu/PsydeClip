Add-Type -AssemblyName System.Drawing
$src = 'Z:\GITHUB\rec\recordr\screenshots\Untitle3d.png'
$dst = 'Z:\GITHUB\rec\recordr\screenshots\warmed.png'
$img = [System.Drawing.Image]::FromFile($src)
$w = 640
$h = [int]($img.Height * $w / $img.Width)
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.DrawImage($img, 0, 0, $w, $h)
$g.Dispose()
$bmp.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
$img.Dispose()
Write-Output ('resized to ' + $w + 'x' + $h + ': ' + (Test-Path $dst))
