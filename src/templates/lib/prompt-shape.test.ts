import { describe, it, expect } from 'vitest';
import {
  interpolatePrompt,
  promptBodyFieldOf,
  promptVariables,
  promptVariablesFieldOf,
  splitPromptTokens,
} from '@/templates/lib/prompt-shape';
import { promptsCollectionScaffold } from '@/templates/packs';

describe('splitPromptTokens', () => {
  it('tokenizes text around placeholders', () => {
    expect(splitPromptTokens('Write about {{topic}} for {{audience}}.')).toEqual([
      { kind: 'text', value: 'Write about ' },
      { kind: 'var', value: 'topic', raw: '{{topic}}' },
      { kind: 'text', value: ' for ' },
      { kind: 'var', value: 'audience', raw: '{{audience}}' },
      { kind: 'text', value: '.' },
    ]);
  });

  it('handles adjacent placeholders and interior whitespace', () => {
    expect(splitPromptTokens('{{a}}{{ b }}')).toEqual([
      { kind: 'var', value: 'a', raw: '{{a}}' },
      { kind: 'var', value: 'b', raw: '{{ b }}' },
    ]);
  });

  it('leaves unclosed/malformed braces as plain text', () => {
    expect(splitPromptTokens('open {{nope and {single} braces')).toEqual([
      { kind: 'text', value: 'open {{nope and {single} braces' },
    ]);
  });

  it('returns no tokens for an empty body', () => {
    expect(splitPromptTokens('')).toEqual([]);
  });
});

describe('interpolatePrompt', () => {
  it('substitutes provided arguments and leaves missing ones verbatim', () => {
    expect(interpolatePrompt('Hi {{name}}, re: {{ topic }}', { name: 'Col' })).toBe(
      'Hi Col, re: {{ topic }}',
    );
  });

  it('is immune to replacement-pattern characters in values', () => {
    // String.replace would corrupt these ($& = matched string, $' = trailing).
    expect(interpolatePrompt('pay {{amount}}', { amount: "$&100 and $' more" })).toBe(
      "pay $&100 and $' more",
    );
  });

  it('does not re-interpolate placeholders produced by argument values', () => {
    expect(interpolatePrompt('{{a}}', { a: '{{b}}', b: 'nope' })).toBe('{{b}}');
  });
});

describe('prompt shape on the pack scaffold', () => {
  it('finds body (first markdown) and the variables tags field', () => {
    expect(promptBodyFieldOf(promptsCollectionScaffold)?.key).toBe('body');
    expect(promptVariablesFieldOf(promptsCollectionScaffold)?.key).toBe('variables');
  });

  it('unions declared and scanned variables, declared order first, deduped', () => {
    const vars = promptVariables(promptsCollectionScaffold, {
      body: 'Write about {{topic}} in {{tone}} for {{topic}}.',
      variables: ['audience', 'topic'],
    });
    expect(vars).toEqual(['audience', 'topic', 'tone']);
  });

  it('tolerates a missing body and non-array variables value', () => {
    expect(promptVariables(promptsCollectionScaffold, { variables: 'not-an-array' })).toEqual([]);
  });
});
