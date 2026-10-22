import {
  auditExitCode,
  IntegrityReader,
  runIntegrityAudit,
} from './integrity-audit';
import { integrityRelations } from './integrity-relations';

describe('referential integrity audit', () => {
  const expectedRelations = integrityRelations.map(({ id }) => id);

  it('defines every supported account, category, plan, debt, user and space reference', () => {
    expect(expectedRelations).toEqual(
      expect.arrayContaining([
        'transaction.account',
        'transfer.sourceSnapshot',
        'transfer.destinationSnapshot',
        'Account.space',
        'Debt.space',
        'plan.createdBy',
        'debt.space.balance',
        'income.debt.repayment',
      ]),
    );
    expect(
      integrityRelations.filter(({ targetModel }) => targetModel === 'Space'),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceModel: 'Transaction',
          sourceField: 'spaceId',
          required: true,
        }),
      ]),
    );
    expect(
      integrityRelations.some(({ sourceField }) =>
        ['ownerType', 'defaultAccountId'].includes(sourceField),
      ),
    ).toBe(false);
  });

  it('reports one deterministic orphan fixture for every supported relation without mutation', async () => {
    const fixtures = Object.fromEntries(
      integrityRelations.map((relation, index) => [
        relation.id,
        [
          {
            sourceId: `source-${index}`,
            targetId: `target-${index}`,
          },
        ],
      ]),
    );
    const before = JSON.stringify(fixtures);
    const reader: IntegrityReader = {
      findOrphans: jest.fn(async (relation) => fixtures[relation.id]),
    };

    const result = await runIntegrityAudit(reader);

    expect(result.ok).toBe(false);
    expect(result.checkedRelations).toBe(expectedRelations.length);
    expect(result.violationCount).toBe(expectedRelations.length);
    expect(result.byRelation).toEqual(
      Object.fromEntries(expectedRelations.map((id) => [id, 1])),
    );
    expect(result.violations[0]).toMatchObject({
      relation: expectedRelations[0],
      sourceId: 'source-0',
      targetId: 'target-0',
    });
    expect(JSON.stringify(fixtures)).toBe(before);
    expect(reader.findOrphans).toHaveBeenCalledTimes(expectedRelations.length);
    expect(auditExitCode(result)).toBe(1);
  });

  it('returns a successful machine-readable result for a clean database', async () => {
    const result = await runIntegrityAudit({
      findOrphans: async () => [],
    });

    expect(result).toMatchObject({
      ok: true,
      checkedRelations: expectedRelations.length,
      violationCount: 0,
      violations: [],
    });
    expect(auditExitCode(result)).toBe(0);
    expect(() => JSON.stringify(result)).not.toThrow();
  });
});
