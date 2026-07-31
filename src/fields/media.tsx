/**
 * `media` — references an uploaded asset by its media id (the bytes live in R2;
 * metadata in the `media` table). The edit widget is the id input + a
 * "Browse…" button that the media-picker island (src/client/media-picker.ts,
 * D38 — supersedes D12/Uppy) enhances into a dialog-based browser/uploader.
 * Without JS the button stays hidden and the id input + library link work.
 */

import { z } from 'zod';
import { Input, Button, Dialog } from '@/components/ui';
import { FieldShell, controlProps } from '@/fields/field-shell';
import type { FieldType, FieldDescriptor } from '@/fields/types';

interface MediaConfig {
  /** Restrict acceptable kinds (advisory in v1). */
  readonly kinds?: ('image' | 'audio' | 'video' | 'document')[];
}

const configSchema = z
  .object({ kinds: z.array(z.enum(['image', 'audio', 'video', 'document'])).optional() })
  .strict();

function valueSchema(_cfg: MediaConfig, field: FieldDescriptor) {
  // Media ids are prefixed nanoids; a generous length cap bounds the value (SEC-4).
  const id = z.string().max(64).regex(/^med_[A-Za-z0-9_-]+$/, 'Must be a media id');
  return field.required ? id : id.optional();
}

export const mediaField: FieldType<MediaConfig, string> = {
  key: 'media',
  configSchema,
  valueSchema,
  toIndex: (v) => v ?? null,
  EditComponent: ({ field, value, signal }) => (
    <FieldShell
      field={field}
      signal={signal}
      help="Browse the media library, or paste a media id."
    >
      <div class="flex items-center gap-3" data-media-picker data-picker-dialog={`rm-media-picker-${signal}`}>
        <img
          data-picker-preview
          src={value ? `/media/${value}` : undefined}
          alt=""
          class={`size-12 rounded-md object-cover ${value ? '' : 'hidden'}`}
        />
        <Input
          {...controlProps({ field, signal }, { placeholder: 'med_…', required: false })}
          type="text"
          value={value ?? ''}
        />
        {/* Hidden until the island mounts — useless without JS. type=button:
            this sits inside #editor-form. */}
        <Button type="button" variant="secondary" size="sm" class="hidden whitespace-nowrap" data-picker-open>
          Browse…
        </Button>
        <a href="/admin/media" target="_blank" rel="noopener" class="whitespace-nowrap text-sm text-accent-text hover:underline">
          Media library ↗
        </a>
      </div>
      {/* Empty shell; the island fetches the picker fragment into it on open.
          The fragment carries NO <form> — this dialog lives inside the editor
          form, and nested forms are invalid HTML. */}
      <Dialog id={`rm-media-picker-${signal}`} title="Media library" size="lg">
        <div data-picker-body>
          <p class="text-sm text-ink-muted">Loading…</p>
        </div>
      </Dialog>
    </FieldShell>
  ),
  CellComponent: ({ value }) =>
    value ? <img src={`/media/${value}`} alt="" class="size-8 rounded object-cover" /> : <span class="text-ink-subtle">—</span>,
  ViewComponent: ({ value, media }) =>
    value ? (
      <img
        src={`/media/${value}`}
        alt={media?.alt ?? ''}
        width={media?.width ?? undefined}
        height={media?.height ?? undefined}
        class="h-auto max-w-full rounded-lg"
      />
    ) : null,
};
