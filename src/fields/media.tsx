/**
 * `media` — references an uploaded asset by its media id (the bytes live in R2;
 * metadata in the `media` table). The edit widget links to the media library where
 * uploads happen; a full inline picker (Uppy) is a deferred enhancement.
 */

import { z } from 'zod';
import { Input } from '@/components/ui';
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
      help="Upload in the Media library, then paste the media id here."
    >
      <div class="flex items-center gap-3">
        {value ? (
          <img src={`/media/${value}`} alt="" class="size-12 rounded-md object-cover" />
        ) : null}
        <Input
          {...controlProps({ field, signal }, { placeholder: 'med_…', required: false })}
          type="text"
          value={value ?? ''}
        />
        <a href="/admin/media" target="_blank" rel="noopener" class="whitespace-nowrap text-sm text-accent-text hover:underline">
          Media library ↗
        </a>
      </div>
    </FieldShell>
  ),
  CellComponent: ({ value }) =>
    value ? <img src={`/media/${value}`} alt="" class="size-8 rounded object-cover" /> : <span class="text-ink-subtle">—</span>,
  ViewComponent: ({ value }) =>
    value ? <img src={`/media/${value}`} alt="" class="max-w-full rounded-lg" /> : null,
};
