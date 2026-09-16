'use client';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Textarea,
} from '@unipods/ui';
import { Upload } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { describeError } from '@/lib/errors';

export interface UploadField {
  name: string;
  label: string;
  type?: 'text' | 'textarea' | 'date' | 'datetime-local' | 'select';
  required?: boolean;
  placeholder?: string;
  hint?: string;
  options?: Array<{ value: string; label: string }>;
  defaultValue?: string;
}

export interface UploadDialogProps {
  title: string;
  description: string;
  /** `accept` attribute for the file input, e.g. ".pdf,.docx". */
  accept: string;
  fileLabel: string;
  fileRequired?: boolean;
  fields?: UploadField[];
  submitLabel?: string;
  triggerLabel: string;
  onSubmit: (form: FormData) => Promise<unknown>;
  onDone?: () => void;
}

/**
 * Shared upload form used by documents, meetings, transcripts and message
 * imports. It reports the API's own error message rather than a generic
 * failure, because those messages explain what to fix.
 */
export function UploadDialog({
  title,
  description,
  accept,
  fileLabel,
  fileRequired = true,
  fields = [],
  submitLabel = 'Upload',
  triggerLabel,
  onSubmit,
  onDone,
}: UploadDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const formRef = React.useRef<HTMLFormElement>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);

    const file = form.get('file');
    if (fileRequired && (!(file instanceof File) || file.size === 0)) {
      setError('Choose a file to upload.');
      return;
    }
    if (!fileRequired && file instanceof File && file.size === 0) {
      form.delete('file');
    }
    // Empty optional text fields would fail validation as empty strings.
    for (const [key, value] of Array.from(form.entries())) {
      if (typeof value === 'string' && value.trim() === '') form.delete(key);
    }

    setBusy(true);
    try {
      await onSubmit(form);
      toast.success(`${title} succeeded`);
      formRef.current?.reset();
      setOpen(false);
      onDone?.();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Upload aria-hidden />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="upload-file">{fileLabel}</Label>
            <Input
              id="upload-file"
              name="file"
              type="file"
              accept={accept}
              required={fileRequired}
              className="cursor-pointer file:mr-3 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs"
            />
          </div>

          {fields.map((field) => (
            <div key={field.name} className="space-y-1.5">
              <Label htmlFor={`upload-${field.name}`}>{field.label}</Label>
              {field.type === 'textarea' ? (
                <Textarea
                  id={`upload-${field.name}`}
                  name={field.name}
                  required={field.required}
                  placeholder={field.placeholder}
                  defaultValue={field.defaultValue}
                  rows={3}
                />
              ) : field.type === 'select' ? (
                <select
                  id={`upload-${field.name}`}
                  name={field.name}
                  required={field.required}
                  defaultValue={field.defaultValue}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {field.options?.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id={`upload-${field.name}`}
                  name={field.name}
                  type={field.type ?? 'text'}
                  required={field.required}
                  placeholder={field.placeholder}
                  defaultValue={field.defaultValue}
                />
              )}
              {field.hint ? (
                <p className="text-xs text-muted-foreground">{field.hint}</p>
              ) : null}
            </div>
          ))}

          {error ? (
            <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
