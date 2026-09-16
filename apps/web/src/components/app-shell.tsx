'use client';

import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
} from '@unipods/ui';
import {
  CalendarClock,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Search,
  Settings,
  Video,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';
import { useAuth } from '@/components/providers';
import { ThemeToggle } from '@/components/theme-toggle';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/chat', label: 'Ask', icon: MessageSquare },
  { href: '/catch-up', label: 'What did I miss?', icon: CalendarClock },
  { href: '/search', label: 'Search', icon: Search },
  { href: '/documents', label: 'Documents', icon: FileText },
  { href: '/meetings', label: 'Meetings', icon: Video },
  { href: '/admin', label: 'Admin', icon: LayoutDashboard, adminOnly: true },
];

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, isAdmin, signOut } = useAuth();
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);

  // A navigation always closes the mobile menu behind it.
  React.useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  const items = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);
  const initials =
    user?.name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || '?';

  return (
    <div className="flex min-h-dvh flex-col">
      {DEMO_MODE ? <DemoBanner /> : null}

      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-4">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-expanded={mobileNavOpen}
            aria-controls="mobile-nav"
            aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            {mobileNavOpen ? <X aria-hidden /> : <Menu aria-hidden />}
          </Button>

          <Link href="/chat" className="flex items-center gap-2 font-semibold">
            <PulseMark />
            <span className="hidden sm:inline">UniPods Pulse</span>
          </Link>

          <nav aria-label="Primary" className="ml-4 hidden items-center gap-1 md:flex">
            {items.map((item) => (
              <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Account menu">
                  <span className="flex size-8 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
                    {initials}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <div className="px-2 py-1.5">
                  <p className="truncate text-sm font-medium">{user?.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
                  {isAdmin ? (
                    <Badge variant="outline" className="mt-1.5">
                      Administrator
                    </Badge>
                  ) : null}
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/settings">
                    <Settings className="size-4" aria-hidden />
                    Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void signOut()}>
                  <LogOut className="size-4" aria-hidden />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {mobileNavOpen ? (
          <nav
            id="mobile-nav"
            aria-label="Primary"
            className="border-t border-border bg-background px-3 py-2 md:hidden"
          >
            <ul className="flex flex-col">
              {items.map((item) => (
                <li key={item.href}>
                  <NavLink item={item} active={isActive(pathname, item.href)} fullWidth />
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>
    </div>
  );
}

function NavLink({
  item,
  active,
  fullWidth = false,
}: {
  item: NavItem;
  active: boolean;
  fullWidth?: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted',
        fullWidth && 'w-full',
      )}
    >
      <Icon className="size-4" aria-hidden />
      {item.label}
    </Link>
  );
}

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Demo mode is stated plainly so nobody mistakes seeded content for real. */
function DemoBanner() {
  return (
    <div
      role="status"
      className="bg-warning px-4 py-1.5 text-center text-xs font-medium text-warning-foreground"
    >
      Demo mode — everything shown here is synthetic sample content, not real community data.
    </div>
  );
}

export function PulseMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'relative flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground',
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2">
        <path d="M2 12h4l2.5-7 4 14 3-9 2 2h4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
