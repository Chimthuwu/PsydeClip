import { useEffect, useRef } from 'react';
import { AudioAnalyser, drawVisualizer } from '../lib/visualizer';
import { Theme, VisualizerMode } from '../../shared/types';

interface Props {
  analyser: AudioAnalyser | null;
  mode: VisualizerMode;
  theme: Theme;
  className?: string;
}

export function VisualizerBoard({ analyser, mode, theme, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;

    const fit = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    };
    fit();
    // The canvas box changes for reasons other than a window resize — the
    // footer chip row wrapping, the HUD gaining/losing the error line, a
    // breakpoint firing — so observe the element itself, not just `window`.
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);
    window.addEventListener('resize', fit);

    const draw = () => {
      if (analyser) {
        drawVisualizer(
          {
            ctx: ctx as unknown as CanvasRenderingContext2D,
            width: canvas.width,
            height: canvas.height,
            theme,
            mode,
            rms: 0,
          },
          analyser,
        );
      } else {
        // Idle screen: pulsing placeholder.
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let grad: CanvasGradient;
        if (theme === 'modern') {
          grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
          grad.addColorStop(0, '#0c1133');
          grad.addColorStop(1, '#070a1c');
        } else {
          grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
          grad.addColorStop(0, '#001100');
          grad.addColorStop(1, '#000000');
        }
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = theme === 'classic' ? '#003300' : 'rgba(120,150,255,0.15)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Drop to the terse message once the long one can't fit, and cap the
        // font size off the width too so it never runs past the canvas edges.
        const msg = canvas.width < 260 ? 'no source' : 'Pick a source and press Start';
        const size = Math.max(
          8,
          Math.floor(Math.min(canvas.height / 14, (canvas.width * 0.82) / (msg.length * 0.6))),
        );
        ctx.font = `${size}px ui-monospace, Consolas, monospace`;
        ctx.fillText(msg, canvas.width / 2, canvas.height / 2);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [analyser, mode, theme]);

  return <canvas ref={canvasRef} className={className} />;
}
