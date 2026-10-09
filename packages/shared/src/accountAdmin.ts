import type { AccountRole } from "./auth";

export const ACCOUNT_STATUSES = ["active", "banned"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export interface AdminAccountSummary {
  id: string;
  username: string;
  role: AccountRole;
  status: AccountStatus;
  createdAt: string;
  updatedAt?: string;
}

export interface AdminAccountQuery {
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface AdminAccountPage {
  accounts: AdminAccountSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UpdateAccountAccessInput {
  role?: AccountRole;
  status?: AccountStatus;
}
