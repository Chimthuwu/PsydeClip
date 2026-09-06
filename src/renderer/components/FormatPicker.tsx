import { useEffect, useRef, useState } from 'react';
import { RecordingFormat } from '../../shared/types';

interface Props {
  value: RecordingFormat;
  onChange: (f: RecordingFormat) => void;
  /** Drop the label, leave just the trigger (compact layouts). */
  compact?: boolean;
}

const OPTIONS: { value: RecordingFormat; label: string; hint: string }[] = [
  { value: 'webm', label: 'WebM', hint: 'Opus, smallest' },
  { value: 'wav', label: 'WAV', hint: 'lossless PCM' },
  { value: 'mp3', label: 'MP3', hint: 'lossy, portable' },
];

/**
 * Save-format selector that sits next to the device picker in the footer.
 * Same in-DOM button + popover as SourcePicker (native <option>s ignore our
 * theme), opening upward so it isn't clipped by `.app { overflow: hidden }`.
 */
export function FormatPicker({ value, onChange, compact }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = OPTIONS.find((o) => o.value === value) ?? OPTIONS[0];

  return (
    <div
      className={`picker-row picker-row-stack format-picker${compact ? ' is-compact' : ''}`}
      ref={wrapRef}
    >
      {!compact && <label htmlFor="format-trigger">Format</label>}

      <div className="picker-select-wrap">
        <button
          id="format-trigger"
          type="button"
          className="dd-trigger"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-label="Save format"
          aria-expanded={open}
        >
          <span className="dd-label">{current.label}</span>
          <span className="dd-chevron" aria-hidden="true">
            ▾
          </span>
        </button>

        {open && (
          <div className="dd-popover dd-popover-tight" role="listbox" aria-label="Save format">
            <ul className="dd-list">
              {OPTIONS.map((o) => (
                <li
                  key={o.value}
                  role="option"
                  aria-selected={o.value === value}
                  className={'dd-item' + (o.value === value ? ' is-selected' : '')}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  <span className="dd-item-label">
                    {o.label}
                    <small className="dd-item-hint"> · {o.hint}</small>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export default FormatPicker;
