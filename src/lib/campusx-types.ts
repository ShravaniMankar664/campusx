/**
 * Frontend contract expected from the parent-provided `src/lib/campusx.ts`
 * gateway. Every write resolves only after the transaction is confirmed.
 */
export type IssueStatus =
  | 'Submitted'
  | 'Assigned'
  | 'InProgress'
  | 'RepairSubmitted'
  | 'Resolved'
  | 'Disputed'
  | 'Reopened';

export type Severity = 'Low' | 'Medium' | 'High' | 'Critical';

export interface Issue {
  id: string;
  title: string;
  description: string;
  category: string;
  location: string;
  severity: Severity;
  createdAt: number | string;
  status: IssueStatus;
  /** Authorization-only contract field. Never render publicly. */
  reporter?: string;
  assignedResolver?: string;
  team?: string;
  voteCount: number;
  repairDescription?: string;
  evidenceHash?: string;
  repairSubmittedAt?: number | string;
}

export interface Activity {
  eventName: string;
  transactionHash: string;
  blockNumber: number;
  timestamp: number | string;
  actor: string;
  summary: string;
}

export interface WalletState {
  address?: string;
  chainId?: number;
  isConnected: boolean;
  isAdministrator: boolean;
  isResolver: boolean;
}

export interface DashboardStats {
  totalIssues: number;
  openIssues: number;
  highPriority: number;
  inProgress: number;
  awaitingVerification: number;
  resolved: number;
  disputed: number;
  latestBlock?: number;
}

export interface TxReceipt {
  transactionHash: string;
  blockNumber: number;
  issueId?: string;
}

export interface CreateIssueInput {
  title: string;
  description: string;
  category: string;
  location: string;
  severity: Severity;
}

export interface CampusXGateway {
  isContractConfigured(): boolean;
  connectWallet(): Promise<WalletState>;
  getWalletSnapshot(): Promise<WalletState>;
  switchToSepolia(): Promise<void>;
  subscribeWallet(listener: (wallet: WalletState) => void): () => void;
  getIssues(): Promise<Issue[]>;
  getIssue(id: string): Promise<Issue>;
  getIssueActivity(id: string): Promise<Activity[]>;
  getDashboardStats(): Promise<DashboardStats>;
  isAdministrator(address: string): Promise<boolean>;
  isResolver(address: string): Promise<boolean>;
  createIssue(input: CreateIssueInput): Promise<TxReceipt>;
  voteForIssue(id: string): Promise<TxReceipt>;
  assignIssue(id: string, resolver: string): Promise<TxReceipt>;
  setResolver(address: string, enabled: boolean): Promise<TxReceipt>;
  setIssueInProgress(id: string): Promise<TxReceipt>;
  submitRepair(id: string, description: string, evidenceHash: string): Promise<TxReceipt>;
  confirmResolution(id: string): Promise<TxReceipt>;
  disputeResolution(id: string, reason: string): Promise<TxReceipt>;
  reopenIssue(id: string, resolver: string): Promise<TxReceipt>;
}
