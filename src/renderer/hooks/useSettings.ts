import { useEffect, useState } from 'react';
import { AppSettings, DEFAULT_SETTINGS } from '../../shared/types';

/** Loads and reflects the persisted AppSettings; updates flow back via api.setSettings. */
export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    window.api.getSettings().then((s) => {
      setSettings(s);
      setLoaded(true);
    });
  }, []);

  async function update(patch: Partial<AppSettings>): Promise<AppSettings> {
    const merged = await window.api.setSettings(patch);
    setSettings(merged);
    return merged;
  }

  return { settings, loaded, update };
}
