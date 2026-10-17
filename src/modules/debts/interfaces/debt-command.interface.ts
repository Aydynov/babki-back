import { DebtStatus } from '../schemas/debt.schema';

export interface CreateDebtCommand {
  debtor: string;
  principalAmount: number;
  currency: string;
  remainingAmount?: number;
  status?: DebtStatus;
  description?: string;
  dueDate?: string | null;
}

export interface UpdateDebtCommand {
  debtor?: string;
  principalAmount?: number;
  remainingAmount?: number;
  status?: DebtStatus;
  description?: string;
  dueDate?: string | null;
}

export interface RepayDebtCommand {
  amount: number;
  repaymentDate: string;
  description?: string;
  isIncome?: boolean;
  accountId?: string;
}
