# Financial ownership inventory

Account, Transaction, ExpenseCategory, ExpenseLimit, Plan, Debt and DebtTransaction have an immutable spaceId. AccountSnapshot inherits its space through accountId. Author and participant references are independent of the space; Space.ownerId remains administrative ownership.

All HTTP finances use `/spaces/:spaceId`. Domain modules retain their shared providers and monetary rules; space adapters resolve current membership and delegated permissions before calling them in a shared transaction. There is no second ledger, personal financial controller or user-based fallback.

Account lifecycle, snapshot effects, transaction aggregation, category locks, currency baskets, plans, debts and repayment effects are mapped in [budget-financial-core.md](budget-financial-core.md). Read-only integrity checks validate both space boundaries and financial history. User deletion preserves space records and anonymizes actors.

Fixtures are created explicitly in a new disposable development database; see [space-finances-seed.md](space-finances-seed.md). Old ownership migration commands and compatibility promises have been removed.
