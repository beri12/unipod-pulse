'use client';

import { Button } from '@unipods/ui';
import { Moon, Sun } from 'lucide-react';
import * as React from 'react';

const STORAGE_KEY = 'unipods.theme';

/**
 * Light/dark toggle. The initial class is applied by an inline script in the
 * root layout, so this only has to keep the two in sync after hydration.
 */
export function ThemeToggle() {
  const [dark, setDark] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
    setMounted(true);
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light');
    } catch {
      // Storage unavailable: the choice simply will not persist.
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-pressed={mounted ? dark : undefined}
    >
      {mounted && dark ? <Moon aria-hidden /> : <Sun aria-hidden />}
    </Button>
  );
}
