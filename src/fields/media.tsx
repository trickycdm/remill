/**
 * `media` — references an uploaded asset by its media id (the bytes live in R2;
 * metadata in the `media` table). The edit widget links to the media library where
 * uploads happen; a full inline picker (Uppy) is a deferred enhancement.
 */

import { z } from 'zod';
import { FormField, Input } from '@/components/ui';
import type { FieldType, FieldDescriptor } from '@/fields/types';

interface MediaConfig {
  /** Restrict acceptable kinds (advisory in v1). */
  readonly kinds?: ('image' | 'audio' | 'video' | 'document')[];
}

const configSchema = z
  .object({ kinds: z.array(z.enum(['image', 'audio', 'video', 'document'])).optional() })
  .strict();

function valueSchema(_cfg: MediaConfig, field: FieldDescriptor) {
  const id = z.string().regex(/^med_[A-Za-z0-9_-]+$/, 'Must be a media id');
  return field.required ? id : id.optional();
}

export const mediaField: FieldType<MediaConfig, string> = {
  key: 'media',
  configSchema,
  valueSchema,
  toIndex: (v) => v ?? null,
  EditComponent: ({ field, value, signal }) => (
    <FormField
      fieldId={signal}
      label={field.label ?? field.key}
      required={field.required}
      description="Upload in the Media library, then paste the media id here."
    >
      <div class="flex items-center gap-3">
        {value ? (
          <img src={`/media/${value}`} alt="" class="size-12 rounded-md object-cover" />
        ) : null}
        <Input id={signal} name={field.key} type="text" value={value ?? ''} placeholder="med_…" data-bind={signal} />
        <a href="/admin/media" target="_blank" rel="noopener" class="whitespace-nowrap text-sm text-accent-text hover:underline">
          Media library ↗
        </a>
      </div>
    </FormField>
  ),
  CellComponent: ({ value }) =>
    value ? <img src={`/media/${value}`} alt="" class="size-8 rounded object-cover" /> : <span class="text-ink-subtle">—</span>,
};
