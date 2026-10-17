export interface CategoryExpense {
  categoryId: string;
  total: number;
}
export interface CurrencyPeriodReport {
  currency: string;
  incomes: number;
  expenses: number;
  transfersIn: number;
  transfersOut: number;
  balance: number;
  saving: number;
  expensesByCategory: CategoryExpense[];
}
export interface PeriodReport {
  period: string;
  currencies: CurrencyPeriodReport[];
}
