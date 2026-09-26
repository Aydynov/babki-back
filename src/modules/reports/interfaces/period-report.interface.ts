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
export interface SingleCurrencyPeriodReport {
  period: string;
  expenses: number;
  incomes: number;
  saves: number;
  saving: number;
  balance: number;
  expensesByCategory: CategoryExpense[];
}
