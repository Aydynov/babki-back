import { ConflictException, NotFoundException } from '@nestjs/common';

export enum DeletionStrategy {
  RESTRICT = 'RESTRICT',
  ARCHIVE = 'ARCHIVE',
  CASCADE = 'CASCADE',
  ERASE_ANONYMIZE = 'ERASE/ANONYMIZE',
}

export class DeletionTargetNotFoundException extends NotFoundException {
  constructor(entityName = 'Entity') {
    super(`${entityName} not found`);
  }
}

export class DeletionRestrictedException extends ConflictException {
  constructor(message = 'Entity cannot be deleted because it is in use') {
    super(message);
  }
}
