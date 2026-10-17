import {
  BrowserProvider,
  Contract,
  isAddress,
  isHexString,
  type EventLog,
  type Eip1193Provider,
  type Log,
  type TransactionReceipt,
} from "ethers";
import artifact from "./CampusXAbi.json";
import type {
  Activity,
  CampusXGateway,
  CreateIssueInput,
  DashboardStats,
  Issue,
  IssueStatus,
  Severity,
  TxReceipt,
  WalletState,
} from "./campusx-types";

const SEPOLIA_CHAIN_ID = 11155111n;
const CATEGORIES = [
  "IT & Laboratory Equipment",
  "Electrical Maintenance",
  "Plumbing",
  "Campus Infrastructure",
  "Network & Wi-Fi",
  "Other campus issue",
] as const;
const SEVERITIES: Severity[] = ["Low", "Medium", "High", "Critical"];
const STATUSES: IssueStatus[] = [
  "Submitted",
  "Assigned",
  "InProgress",
  "RepairSubmitted",
  "Resolved",
  "Disputed",
  "Reopened",
];
const DEFAULT_WALLET: WalletState = {
  isConnected: false,
  isAdministrator: false,
  isResolver: false,
};

type InjectedEthereum = Eip1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: InjectedEthereum;
  }
}

function contractAddress(): string {
  const address = import.meta.env.VITE_CAMPUSX_CONTRACT_ADDRESS?.trim();
  if (!address || !isAddress(address)) {
    throw new Error(
      "The CAMPUSX Sepolia contract is not configured yet. Deploy CampusX.sol, then set VITE_CAMPUSX_CONTRACT_ADDRESS.",
    );
  }
  return address;
}

function injectedEthereum(): InjectedEthereum {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error(
      "No Ethereum wallet was found. Install MetaMask, then reload this page.",
    );
  }
  return window.ethereum;
}

function provider(): BrowserProvider {
  return new BrowserProvider(injectedEthereum());
}

function statusError(chainId: bigint): Error {
  return new Error(
    `This wallet is on chain ${chainId}. Switch MetaMask to Ethereum Sepolia (11155111) before using the CAMPUSX contract.`,
  );
}

async function readContract(): Promise<Contract> {
  const address = contractAddress();
  const browserProvider = provider();
  const network = await browserProvider.getNetwork();
  if (network.chainId !== SEPOLIA_CHAIN_ID) throw statusError(network.chainId);
  return new Contract(address, artifact.abi, browserProvider);
}

async function writeContract(): Promise<Contract> {
  const address = contractAddress();
  const browserProvider = provider();
  const network = await browserProvider.getNetwork();
  if (network.chainId !== SEPOLIA_CHAIN_ID) throw statusError(network.chainId);
  const signer = await browserProvider.getSigner();
  return new Contract(address, artifact.abi, signer);
}

function normalizedError(error: unknown): Error {
  const details = error as { code?: string | number; shortMessage?: string; message?: string };
  const message = details?.shortMessage || details?.message || "The wallet request failed.";
  if (details?.code === 4001 || details?.code === "ACTION_REJECTED" || /user rejected|user denied|request rejected/i.test(message)) {
    return new Error("The wallet request was rejected. No transaction was recorded.");
  }
  if (/insufficient funds/i.test(message)) {
    return new Error("This wallet does not have enough Sepolia ETH to pay the transaction gas fee.");
  }
  return new Error(message);
}

async function confirmed(
  send: () => Promise<{ wait: (confirmations?: number) => Promise<TransactionReceipt | null>; hash: string }>,
): Promise<TxReceipt> {
  try {
    const transaction = await send();
    const receipt = await transaction.wait(1);
    if (!receipt || receipt.status !== 1) {
      throw new Error("The transaction was not confirmed successfully on Sepolia.");
    }
    return { transactionHash: receipt.hash, blockNumber: receipt.blockNumber };
  } catch (error) {
    throw normalizedError(error);
  }
}

function categoryIndex(category: string): number {
  const index = CATEGORIES.findIndex(
    (candidate) => candidate.toLowerCase() === category.trim().toLowerCase(),
  );
  if (index < 0) throw new Error("Choose one of the supported CAMPUSX issue categories.");
  return index;
}

function severityIndex(severity: Severity): number {
  const index = SEVERITIES.indexOf(severity);
  if (index < 0) throw new Error("Choose a valid severity level.");
  return index;
}

function statusFromContract(value: bigint | number): IssueStatus {
  const status = STATUSES[Number(value)];
  if (!status) throw new Error(`The contract returned an unknown issue status: ${value}.`);
  return status;
}

function toIssue(raw: Record<string, unknown>): Issue {
  const id = BigInt(String(raw.id));
  const categoryIndexValue = Number(raw.category);
  const severityValue = Number(raw.severity);
  return {
    id: id.toString(),
    title: String(raw.title),
    description: String(raw.description),
    category: CATEGORIES[categoryIndexValue] || `Unknown category (${categoryIndexValue})`,
    location: String(raw.location),
    severity: SEVERITIES[severityValue] || "Low",
    createdAt: Number(raw.createdAt),
    status: statusFromContract(raw.status as bigint | number),
    reporter: String(raw.reporter),
    assignedResolver: isAddress(String(raw.assignedResolver)) &&
      String(raw.assignedResolver).toLowerCase() !== "0x0000000000000000000000000000000000000000"
      ? String(raw.assignedResolver)
      : undefined,
    team: String(raw.team),
    voteCount: Number(raw.voteCount),
    repairDescription: String(raw.repairDescription) || undefined,
    evidenceHash:
      String(raw.evidenceHash) === `0x${"0".repeat(64)}`
        ? undefined
        : String(raw.evidenceHash),
    repairSubmittedAt:
      Number(raw.repairSubmittedAt) === 0 ? undefined : Number(raw.repairSubmittedAt),
  };
}

function parseLog(log: EventLog | Log) {
  const parsed = ContractInterface.parseLog({ topics: log.topics, data: log.data });
  if (!parsed) throw new Error("The provider returned an unrecognized CAMPUSX event.");
  return parsed;
}

const ContractInterface = new Contract(
  "0x0000000000000000000000000000000000000001",
  artifact.abi,
).interface;

async function readIsAdministrator(address: string): Promise<boolean> {
  if (!isAddress(address) || !gateway.isContractConfigured()) return false;
  const browserProvider = provider();
  if ((await browserProvider.getNetwork()).chainId !== SEPOLIA_CHAIN_ID) return false;
  const contract = new Contract(contractAddress(), artifact.abi, browserProvider);
  return (await contract.administrator()).toLowerCase() === address.toLowerCase();
}

async function readIsResolver(address: string): Promise<boolean> {
  if (!isAddress(address) || !gateway.isContractConfigured()) return false;
  const browserProvider = provider();
  if ((await browserProvider.getNetwork()).chainId !== SEPOLIA_CHAIN_ID) return false;
  const contract = new Contract(contractAddress(), artifact.abi, browserProvider);
  return Boolean(await contract.isResolver(address));
}

function friendlyActor(address: string, reporter: string): string {
  if (address.toLowerCase() === reporter.toLowerCase()) {
    return "Reporting wallet (address hidden)";
  }
  return address;
}

function shortAddress(address: string): string {
  return isAddress(address) ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

function describeEvent(name: string, args: Record<string, unknown>, reporter: string) {
  switch (name) {
    case "IssueCreated":
      return {
        actor: "Reporting wallet (address hidden)",
        summary: `Issue submitted and routed to ${String(args.team)}.`,
      };
    case "IssueAssigned":
      return {
        actor: String(args.resolver),
        summary: `Assigned to ${String(args.team)}.`,
      };
    case "IssueStatusChanged":
      return {
        actor: friendlyActor(String(args.actor), reporter),
        summary: `Status changed from ${statusFromContract(args.previousStatus as bigint | number)} to ${statusFromContract(args.newStatus as bigint | number)}.`,
      };
    case "VoteRecorded":
      return {
        actor: "Community wallet",
        summary: `Community support recorded. On-chain vote count: ${String(args.voteCount)}.`,
      };
    case "RepairSubmitted":
      return {
        actor: String(args.resolver),
        summary: `Repair commitment: ${String(args.repairDescription)}`,
      };
    case "ResolutionConfirmed":
      return {
        actor: "Reporting wallet (address hidden)",
        summary: "The reporter confirmed the proposed resolution.",
      };
    case "ResolutionDisputed":
      return {
        actor: "Reporting wallet (address hidden)",
        summary: `The reporter disputed the proposed resolution: ${String(args.reason)}`,
      };
    case "IssueReopened":
      return {
        actor: String(args.administrator),
        summary: `Reopened for reinspection and assigned to ${shortAddress(String(args.resolver))}.`,
      };
    default:
      return { actor: "CAMPUSX contract", summary: "A contract event was recorded." };
  }
}

const gateway: CampusXGateway = {
  isContractConfigured() {
    return isAddress(import.meta.env.VITE_CAMPUSX_CONTRACT_ADDRESS || "");
  },

  async connectWallet() {
    const browserProvider = provider();
    const accounts = (await browserProvider.send("eth_requestAccounts", [])) as string[];
    const network = await browserProvider.getNetwork();
    const address = accounts[0];
    return {
      address,
      chainId: Number(network.chainId),
      isConnected: Boolean(address),
      isAdministrator:
        Boolean(address) &&
        network.chainId === SEPOLIA_CHAIN_ID &&
        (await readIsAdministrator(address)),
      isResolver:
        Boolean(address) &&
        network.chainId === SEPOLIA_CHAIN_ID &&
        (await readIsResolver(address)),
    };
  },

  async switchToSepolia() {
    const ethereum = injectedEthereum();
    try {
      await ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0xaa36a7" }],
      });
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code !== 4902) throw normalizedError(error);
      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: "0xaa36a7",
            chainName: "Ethereum Sepolia",
            nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
            blockExplorerUrls: ["https://sepolia.etherscan.io"],
          },
        ],
      });
    }
  },

  subscribeWallet(listener) {
    const ethereum = typeof window === "undefined" ? undefined : window.ethereum;
    if (!ethereum?.on) return () => undefined;
    const sync = () => {
      void gateway.getWalletSnapshot()
        .then(listener)
        .catch(() => listener({ ...DEFAULT_WALLET }));
    };
    ethereum.on("accountsChanged", sync);
    ethereum.on("chainChanged", sync);
    return () => {
      ethereum.removeListener?.("accountsChanged", sync);
      ethereum.removeListener?.("chainChanged", sync);
    };
  },

  async getWalletSnapshot() {
    try {
      const browserProvider = provider();
      const [accounts, network] = await Promise.all([
        browserProvider.send("eth_accounts", []) as Promise<string[]>,
        browserProvider.getNetwork(),
      ]);
      const address = accounts[0];
      const isConnected = Boolean(address);
      const onSepolia = network.chainId === SEPOLIA_CHAIN_ID;
      const [isAdministrator, isResolver] =
        address && onSepolia && isAddress(import.meta.env.VITE_CAMPUSX_CONTRACT_ADDRESS || "")
          ? await Promise.all([
              gateway.isAdministrator(address),
              gateway.isResolver(address),
            ])
          : [false, false];
      return {
        address,
        chainId: Number(network.chainId),
        isConnected,
        isAdministrator,
        isResolver,
      };
    } catch {
      return { ...DEFAULT_WALLET };
    }
  },

  async getIssues() {
    const contract = await readContract();
    const count = Number(await contract.issueCount());
    const records: Issue[] = [];
    for (let offset = 0; offset < count; offset += 100) {
      const page = (await contract.getIssues(offset, Math.min(100, count - offset))) as Array<
        Record<string, unknown>
      >;
      records.push(...Array.from(page, toIssue));
    }
    return records.reverse();
  },

  async getIssue(id) {
    const contract = await readContract();
    return toIssue((await contract.getIssue(BigInt(id))) as Record<string, unknown>);
  },

  async getIssueActivity(id) {
    const contract = await readContract();
    const issue = await contract.getIssue(BigInt(id));
    const deploymentBlockValue = Number(import.meta.env.VITE_CAMPUSX_DEPLOYMENT_BLOCK || 0);
    const fromBlock =
      Number.isSafeInteger(deploymentBlockValue) && deploymentBlockValue >= 0
        ? deploymentBlockValue
        : 0;
    const issueId = BigInt(id);
    const filters = [
      contract.filters.IssueCreated(issueId),
      contract.filters.IssueAssigned(issueId),
      contract.filters.IssueStatusChanged(issueId),
      contract.filters.VoteRecorded(issueId),
      contract.filters.RepairSubmitted(issueId),
      contract.filters.ResolutionConfirmed(issueId),
      contract.filters.ResolutionDisputed(issueId),
      contract.filters.IssueReopened(issueId),
    ];
    const logs = (await Promise.all(
      filters.map((filter) => contract.queryFilter(filter, fromBlock, "latest")),
    )).flat() as Array<EventLog | Log>;
    const providerForBlocks = provider();
    const items = await Promise.all(
      logs.map(async (log) => {
        const parsed = parseLog(log);
        const args = parsed.args as unknown as Record<string, unknown>;
        const description = describeEvent(parsed.name, args, String(issue.reporter));
        const block = await providerForBlocks.getBlock(log.blockNumber);
        return {
          eventName: parsed.name,
          transactionHash: log.transactionHash,
          blockNumber: log.blockNumber,
          timestamp: block?.timestamp || 0,
          actor: description.actor,
          summary: description.summary,
          logIndex: log.index,
        };
      }),
    );
    return items
      .sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex)
      .map(({ logIndex: _logIndex, ...item }) => item satisfies Activity);
  },

  async getDashboardStats(): Promise<DashboardStats> {
    const [issues, latestBlock] = await Promise.all([
      gateway.getIssues(),
      provider().getBlockNumber(),
    ]);
    return {
      totalIssues: issues.length,
      openIssues: issues.filter(
        (issue) => issue.status !== "InProgress" && issue.status !== "Resolved",
      ).length,
      highPriority: issues.filter(
        (issue) => issue.severity === "High" || issue.severity === "Critical",
      ).length,
      inProgress: issues.filter((issue) => issue.status === "InProgress").length,
      awaitingVerification: issues.filter((issue) => issue.status === "RepairSubmitted").length,
      resolved: issues.filter((issue) => issue.status === "Resolved").length,
      disputed: issues.filter((issue) => issue.status === "Disputed").length,
      latestBlock,
    };
  },

  async isAdministrator(address) {
    return readIsAdministrator(address);
  },

  async isResolver(address) {
    return readIsResolver(address);
  },

  async createIssue(input: CreateIssueInput) {
    const contract = await writeContract();
    const receipt = await confirmed(() =>
      contract.createIssue(
        input.title.trim(),
        input.description.trim(),
        categoryIndex(input.category),
        input.location.trim(),
        severityIndex(input.severity),
      ),
    );
    const transactionReceipt = await provider().getTransactionReceipt(receipt.transactionHash);
    if (!transactionReceipt) {
      throw new Error("The transaction was confirmed, but its issue ID could not be read yet.");
    }
    const issueCreated = transactionReceipt.logs
      .map((log) => {
        try {
          return parseLog(log);
        } catch {
          return null;
        }
      })
      .find((event) => event?.name === "IssueCreated");
    if (!issueCreated) {
      throw new Error("The confirmed transaction did not include the expected IssueCreated event.");
    }
    return { ...receipt, issueId: String(issueCreated.args.issueId) };
  },

  async voteForIssue(id) {
    const contract = await writeContract();
    return confirmed(() => contract.voteForIssue(BigInt(id)));
  },

  async assignIssue(id, resolver) {
    if (!isAddress(resolver)) throw new Error("Enter a valid resolver wallet address.");
    const contract = await writeContract();
    return confirmed(() => contract.assignIssue(BigInt(id), resolver));
  },

  async setResolver(address, enabled) {
    if (!isAddress(address)) throw new Error("Enter a valid resolver wallet address.");
    const contract = await writeContract();
    return confirmed(() => contract.setResolver(address, enabled));
  },

  async setIssueInProgress(id) {
    const contract = await writeContract();
    return confirmed(() => contract.setIssueInProgress(BigInt(id)));
  },

  async submitRepair(id, description, evidenceHash) {
    const hash = evidenceHash.startsWith("0x") ? evidenceHash : `0x${evidenceHash}`;
    if (!isHexString(hash, 32)) {
      throw new Error("Select an evidence file so CAMPUSX can commit its SHA-256 hash.");
    }
    const contract = await writeContract();
    return confirmed(() => contract.submitRepair(BigInt(id), description.trim(), hash));
  },

  async confirmResolution(id) {
    const contract = await writeContract();
    return confirmed(() => contract.confirmResolution(BigInt(id)));
  },

  async disputeResolution(id, reason) {
    const contract = await writeContract();
    return confirmed(() => contract.disputeResolution(BigInt(id), reason.trim()));
  },

  async reopenIssue(id, resolver) {
    if (!isAddress(resolver)) throw new Error("Enter a valid authorized resolver wallet address.");
    const contract = await writeContract();
    return confirmed(() => contract.reopenIssue(BigInt(id), resolver));
  },
};

export const {
  isContractConfigured,
  connectWallet,
  switchToSepolia,
  subscribeWallet,
  getWalletSnapshot,
  getIssues,
  getIssue,
  getIssueActivity,
  getDashboardStats,
  isAdministrator,
  isResolver,
  createIssue,
  voteForIssue,
  assignIssue,
  setResolver,
  setIssueInProgress,
  submitRepair,
  confirmResolution,
  disputeResolution,
  reopenIssue,
} = gateway;
