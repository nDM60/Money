export interface Account {
  id: string; name: string; type: string; institution: string | null; icon: string; color: string; currency: string;
  openingBalance: number; openingDate: string; notes: string | null; status: string; sortOrder: number; balance: number;
}
export interface Category { id: string; name: string; systemKey: string | null; kind: "expense" | "income"; icon: string; color: string; parentId: string | null; archived: boolean }
export interface Settings {
  language: string; primaryCurrency: string; theme: string; timezone: string; reminderTime: string;
  notifyDaily: boolean; notifyWeekly: boolean; notifyMonthly: boolean; notifyBudget: boolean; notifyBills: boolean; notifyUncategorized: boolean;
  channelPush: boolean; channelEmail: boolean; onboarded: boolean;
}
export interface Me {
  user: { id: string; email: string; name: string; isDemo: boolean };
  settings: Settings; accounts: Account[]; categories: Category[]; unread: number; features: { ai: boolean };
}
export interface Transaction {
  id: string; type: string; localDate: string; occurredAt: string; fromAccountId: string | null; toAccountId: string | null;
  amount: number; currency: string; fromAmount: number | null; toAmount: number | null; reportingAmount: number; reportingCurrency: string;
  categoryId: string | null; description: string; merchant: string | null; paymentMethod: string | null; tags: string[]; notes: string | null;
  receiptId: string | null; recurringId: string | null; goalId: string | null; holdingId: string | null; units: string | null; parentId: string | null;
}
