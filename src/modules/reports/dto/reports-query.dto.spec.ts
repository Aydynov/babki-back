import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ReportsQueryDto } from './reports-query.dto';
describe('ReportsQueryDto', () => {
  const firstId = '507f1f77bcf86cd799439021';
  const secondId = '507f1f77bcf86cd799439022';
  it('splits a comma-separated categories param into an array', async () => {
    const dto = plainToInstance(ReportsQueryDto, {
      categories: `${firstId},${secondId}`,
    });
    expect(dto.categories).toEqual([firstId, secondId]);
    expect(await validate(dto)).toEqual([]);
  });
  it('keeps repeated categories params as an array', async () => {
    const dto = plainToInstance(ReportsQueryDto, {
      categories: [firstId, secondId],
    });
    expect(dto.categories).toEqual([firstId, secondId]);
    expect(await validate(dto)).toEqual([]);
  });
  it('rejects values that are not Mongo ids', async () => {
    const dto = plainToInstance(ReportsQueryDto, {
      categories: `${firstId},not-an-id`,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('isMongoId');
  });
  it('allows omitting categories entirely', async () => {
    const dto = plainToInstance(ReportsQueryDto, {});
    expect(dto.categories).toBeUndefined();
    expect(await validate(dto)).toEqual([]);
  });
});
