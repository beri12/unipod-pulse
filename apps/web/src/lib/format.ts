import type { SourceKind, SourceLocator } from '@unipods/types';

/** Formats seconds as `MM:SS`, or `H:MM:SS` past an hour. */
export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number) => value.toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return 'Unknown length';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelative(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (Math.abs(minutes) < 1) return 'just now';
  if (Math.abs(minutes) < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 7) return `${days}d ago`;
  return formatDate(value);
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** The label shown under a citation title: where inside the source it lives. */
export function describeLocation(type: SourceKind, locator: SourceLocator): string {
  switch (type) {
    case 'DOCUMENT': {
      if (typeof locator.page === 'number') {
        const end = typeof locator.pageEnd === 'number' ? locator.pageEnd : undefined;
        return end && end !== locator.page ? `Pages ${locator.page}–${end}` : `Page ${locator.page}`;
      }
      if (typeof locator.section === 'string' && locator.section.trim()) return locator.section;
      // No position information: the card already says it is a document.
      return typeof locator.chunkIndex === 'number' ? `Part ${locator.chunkIndex + 1}` : '';
    }
    case 'MEETING':
      return typeof locator.startTime === 'number' ? formatTimestamp(locator.startTime) : '';
    case 'MESSAGE':
    case 'ANNOUNCEMENT': {
      const channel = typeof locator.channel === 'string' ? locator.channel : '';
      const date = typeof locator.messageDate === 'string' ? formatDate(locator.messageDate) : '';
      return [channel, date].filter(Boolean).join(' · ');
    }
    default:
      return '';
  }
}

export const SOURCE_LABELS: Record<SourceKind, string> = {
  DOCUMENT: 'Document',
  MEETING: 'Meeting',
  MESSAGE: 'Message',
  ANNOUNCEMENT: 'Announcement',
};

/** Percentage string for a 0–1 confidence value. */
export function formatConfidence(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}
