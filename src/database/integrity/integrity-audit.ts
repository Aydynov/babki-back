import {
  IntegrityRelation,
  integrityRelations,
} from './integrity-relations';

export type OrphanReference = {
  sourceId: string;
  targetId: string;
};

export type IntegrityViolation = OrphanReference & {
  relation: string;
  sourceModel: string;
  sourceField: string;
  targetModel: string;
};

export type IntegrityAuditResult = {
  ok: boolean;
  checkedRelations: number;
  violationCount: number;
  byRelation: Record<string, number>;
  violations: IntegrityViolation[];
};

export interface IntegrityReader {
  findOrphans(relation: IntegrityRelation): Promise<OrphanReference[]>;
}

export async function runIntegrityAudit(
  reader: IntegrityReader,
): Promise<IntegrityAuditResult> {
  const violations: IntegrityViolation[] = [];
  const byRelation: Record<string, number> = {};

  for (const relation of integrityRelations) {
    const orphans = await reader.findOrphans(relation);
    byRelation[relation.id] = orphans.length;
    violations.push(
      ...orphans.map((orphan) => ({
        ...orphan,
        relation: relation.id,
        sourceModel: relation.sourceModel,
        sourceField: relation.sourceField,
        targetModel: relation.targetModel,
      })),
    );
  }

  return {
    ok: violations.length === 0,
    checkedRelations: integrityRelations.length,
    violationCount: violations.length,
    byRelation,
    violations,
  };
}

export function auditExitCode(result: IntegrityAuditResult) {
  return result.ok ? 0 : 1;
}
