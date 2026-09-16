'use client';

import type { ProcessingStatus } from '@unipods/types';
import { Badge } from '@unipods/ui';
import { AlertTriangle, CheckCircle2, Clock, Loader2 } from 'lucide-react';

const STATUS: Record<
  ProcessingStatus,
  { label: string; variant: 'default' | 'outline' | 'success' | 'warning' | 'destructive' }
> = {
  PENDING: { label: 'Queued', variant: 'outline' },
  PROCESSING: { label: 'Processing', variant: 'warning' },
  COMPLETED: { label: 'Indexed', variant: 'success' },
  FAILED: { label: 'Failed', variant: 'destructive' },
};

export function StatusBadge({ status }: { status: ProcessingStatus }) {
  const config = STATUS[status];
  const Icon =
    status === 'COMPLETED'
      ? CheckCircle2
      : status === 'FAILED'
        ? AlertTriangle
        : status === 'PROCESSING'
          ? Loader2
          : Clock;
  return (
    <Badge variant={config.variant}>
      <Icon className={`size-3 ${status === 'PROCESSING' ? 'animate-spin' : ''}`} aria-hidden />
      {config.label}
    </Badge>
  );
}

/** True while the item is still moving through the pipeline. */
export function isInFlight(status: ProcessingStatus): boolean {
  return status === 'PENDING' || status === 'PROCESSING';
}
