/**
 * Persona — the human-facing classification of a principal (ACCESS_CONTROL.md).
 *
 * remill has exactly two SECURITY kinds: `user` (human) and `agent` (machine).
 * `manage_access` gating and `refuseAgentEscalation` key off `kind` alone. But the
 * three PERSONAS a person manages are Person / Service / Agent: a data-pulling
 * system and an autonomous AI agent are both machine principals (`kind: 'agent'`)
 * yet mean different things operationally. `principals.subtype` records which, for
 * display / grouping / filtering only — it is never consulted by authorize().
 */

export type Persona = 'person' | 'service' | 'agent';

export const PERSONAS: readonly Persona[] = ['person', 'service', 'agent'] as const;

/** The two machine personas a `kind: 'agent'` principal may be created as. */
export type MachinePersona = 'service' | 'agent';

/** Derive the persona from a principal's (kind, subtype). Legacy machine
 *  principals with a null subtype read as `agent`; humans are always `person`. */
export function personaOf(kind: 'user' | 'agent', subtype: string | null | undefined): Persona {
  if (kind === 'user') return 'person';
  return subtype === 'service' ? 'service' : 'agent';
}

export const PERSONA_LABEL: Record<Persona, string> = {
  person: 'Person',
  service: 'Service',
  agent: 'Agent',
};

/** Badge tone per persona (semantic reinforcement; label carries the meaning). */
export const PERSONA_TONE: Record<Persona, 'info' | 'accent' | 'warning'> = {
  person: 'info',
  service: 'accent',
  agent: 'warning',
};
