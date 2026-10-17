import { Transfer } from '../schemas/transfer.schema';

export function transferResponse<T extends Transfer>(transfer: T) {
  return {
    ...transfer,
    effectiveRate: {
      baseCurrency: transfer.source.currency,
      quoteCurrency: transfer.destination.currency,
      rate: transfer.destination.amount / transfer.source.amount,
    },
  };
}
