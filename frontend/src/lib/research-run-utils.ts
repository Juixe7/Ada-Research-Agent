/** Resolves provider and pipeline stage labels to the six UI stage identifiers. */
export function toPipelineStage(value: unknown): string | null {
  const stage = String(value ?? "").toLowerCase();
  if (/scop/.test(stage)) return "scope";
  if (/plan/.test(stage)) return "plan";
  if (/scrap|gather|research/.test(stage)) return "gather";
  if (/critic|audit|arbiter/.test(stage)) return "audit";
  if (/synth|outline|write|assembl/.test(stage)) return "write";
  if (/verif|score|final|export/.test(stage)) return "verify";
  return null;
}
