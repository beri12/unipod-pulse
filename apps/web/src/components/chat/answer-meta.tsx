'use client';

import type { AnswerDiagnostics } from '@unipods/types';
import { Badge } from '@unipods/ui';
import { ChevronDown } from 'lucide-react';
import * as React from 'react';
import { formatConfidence } from '@/lib/format';

/**
 * "How was this answered" panel.
 *
 * Showing retrieval counts, timings and the provider behind an answer is part
 * of the product's honesty: a reader can see how much evidence there was,
 * rather than judging an answer by how confident it sounds.
 */
export function AnswerMeta({ diagnostics }: { diagnostics: AnswerDiagnostics }) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronDown
          className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
        How this was answered
        {diagnostics.conflicting ? (
          <Badge variant="warning" className="ml-1">
            Sources disagree
          </Badge>
        ) : null}
      </button>

      {open ? (
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg border border-border bg-muted/40 p-3 text-xs sm:grid-cols-3">
          <Row label="Confidence" value={formatConfidence(diagnostics.confidence)} />
          <Row
            label="Passages used"
            value={`${diagnostics.usedChunks} of ${diagnostics.retrievedChunks} retrieved`}
          />
          <Row label="Retrieval" value={`${diagnostics.retrievalMs} ms`} />
          <Row label="Answer" value={`${diagnostics.generationMs} ms`} />
          <Row label="Provider" value={diagnostics.provider} />
          <Row label="Model" value={diagnostics.model} />
        </dl>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
