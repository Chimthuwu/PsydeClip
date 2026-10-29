import React, { useEffect, useRef } from 'react';

/**
 * The site's background: a real, live-drawn oscilloscope trace, not a photo.
 * Owner rejected a blurred-screenshot background twice ("looks like AI
 * slop" / "nah the background shit like this") before choosing this
 * direction explicitly — a canvas animation reads as premium and native to
 * an audio tool in a way a blurry raster image never did.
 *
 * Two lines (signal-teal, signal-violet), each the sum of a few slow sines
 * at different frequencies — not Math.random() per frame, which flickers
 * and reads as a rendering fault rather than a signal (the same lesson the
 * old VisualizerStage demo document, before it was retired for being a
 * fake-looking "live" widget next to a real video). A low-alpha fill each
 * frame (instead of a hard clear) leaves a soft phosphor trail behind the
 * lines, like a real scope's persistence — that trail is also what keeps
 * text legible without a separate dark overlay layered on top.
 */
export default function LiveWaveform() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let raf = 0;
    let w = 0;
    let h = 0;
    let dpr = 1;

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Start from solid black so the first frame isn't a flash of trails
      // compositing over whatever GPU memory happened to be there.
      ctx.fillStyle = '#07070b';
      ctx.fillRect(0, 0, w, h);
    };
    resize();
    window.addEventListener('resize', resize);

    /** One wandering trace: a handful of sines at incommensurate speeds, so
     *  it never visibly repeats, plus a slow drift in its baseline height. */
    function traceY(x, t, seed) {
      const k = (2 * Math.PI) / w;
      return (
        Math.sin(x * k * 1.3 + t * 0.6 + seed) * 0.42 +
        Math.sin(x * k * 2.7 - t * 0.9 + seed * 1.7) * 0.22 +
        Math.sin(x * k * 0.6 + t * 0.35 + seed * 2.3) * 0.3
      );
    }

    function drawTrace(t, baseline, amp, color, seed) {
      ctx.beginPath();
      const step = Math.max(2, Math.floor(w / 240));
      for (let x = 0; x <= w; x += step) {
        const y = baseline + traceY(x, t, seed) * amp;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.shadowColor = color;
      ctx.shadowBlur = 14;
      ctx.stroke();
    }

    let last = performance.now();
    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;

      // Phosphor-trail fade: paint a near-opaque black rect instead of
      // clearing, so each trace leaves a decaying ghost behind it.
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(7, 7, 11, 0.09)';
      ctx.fillRect(0, 0, w, h);

      drawTrace(t, h * (0.32 + Math.sin(t * 0.07) * 0.05), h * 0.1, 'rgba(94, 242, 214, 0.55)', 0);
      drawTrace(t, h * (0.68 + Math.sin(t * 0.05 + 2) * 0.06), h * 0.08, 'rgba(143, 123, 255, 0.45)', 4);

      void dt;
      raf = requestAnimationFrame(frame);
    }

    if (reduceMotion) {
      // One static frame: both traces at rest, no loop, no battery cost.
      drawTrace(0, h * 0.32, h * 0.1, 'rgba(94, 242, 214, 0.4)', 0);
      drawTrace(0, h * 0.68, h * 0.08, 'rgba(143, 123, 255, 0.32)', 4);
    } else {
      const onVisibility = () => {
        if (document.hidden) {
          cancelAnimationFrame(raf);
        } else {
          last = performance.now();
          raf = requestAnimationFrame(frame);
        }
      };
      document.addEventListener('visibilitychange', onVisibility);
      raf = requestAnimationFrame(frame);
      return () => {
        cancelAnimationFrame(raf);
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('resize', resize);
      };
    }

    return () => window.removeEventListener('resize', resize);
  }, []);

  return <canvas ref={canvasRef} className="fixed inset-0 z-0 pointer-events-none" aria-hidden="true" />;
}
