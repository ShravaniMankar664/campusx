# CAMPUSX — Anonymous Campus Accountability Protocol

**Your voice. Verifiable action.**

CAMPUSX is a campus issue-reporting and accountability prototype built with Solidity, Hardhat, React, and Ethers. The frontend is live, but deployment of the smart contract to Sepolia has not yet been verified. Once deployed and configured, the app can interact with the contract through MetaMask. There is no issue database or seeded demo data.

This is a hackathon prototype, not an official Savitribai Phule Pune University service. Do not enter sensitive personal details into a public report.

## Architecture

- `contracts/CampusX.sol` — roles, issue state, category routing, voting, proof-of-fix commitments, and audit events.
- `test/CampusX.test.cjs` — Hardhat contract tests.
- `scripts/deploy.cjs` — Sepolia deployment and post-deployment bytecode/admin checks.
- `scripts/export-abi.cjs` — exports the compiled contract ABI for the React app.
- `src/lib/campusx.ts` — Ethers v6 wallet and contract gateway.
- `src/App.tsx` — landing page, dashboard, issue explorer and detail, report form, resolver workspace, authority console, and protocol guide.
- `src/lib/CampusXAbi.json` — generated from the compiled Solidity artifact.
- Replit API server and PostgreSQL are intentionally not used for issue data.

## Workflow and contract rules

1. A wallet creates a report. Its public address remains on-chain for reporter-only authorization; the app does not display it as a public identity.
2. Contract category routing assigns a responsible team label. The administrator must separately assign an authorized resolver.
3. Any wallet can cast one vote per issue. The contract prevents duplicate votes from the same wallet. One person can still control multiple wallets; there is no Sybil protection.
4. The assigned resolver records work in progress, then submits a repair description and a SHA-256 file commitment.
5. The original reporter alone can confirm or dispute a proposed resolution.
6. An administrator may reopen a disputed issue and assign an authorized resolver for reinspection.

Status transitions are enforced in Solidity:

`Reported → Assigned → InProgress → AwaitingVerification → VerifiedResolved`

or

`AwaitingVerification → Disputed → Reinspection → InProgress → AwaitingVerification`

An administrator may reassign a report only while it is `Reported` or `Assigned`. Reopening a dispute creates the next repair cycle. There is no admin override to mark another person's repair confirmed.

## Privacy and evidence limitations

- A missing public name does not make a blockchain transaction anonymous. Ethereum exposes sending addresses, transaction data, and transaction history; addresses may be linked to people elsewhere.
- Report titles, descriptions, locations, votes, repair descriptions, and evidence hashes are public and persistent. Do not put student names, IDs, phone numbers, email addresses, or other private information in a report.
- A browser-selected evidence file is hashed locally. This app does not upload or persist the file. The on-chain hash can establish that later bytes match the commitment, but cannot establish that a photo is authentic, recent, or proof that a physical repair happened.
- Reporter confirmation is a reporter's decision, not independent physical verification.
- Contract records and events cannot simply be deleted.

## Prerequisites

- Node.js 24 and pnpm (already available in this workspace).
- MetaMask or another EIP-1193-compatible browser wallet.
- Sepolia ETH for deployment and live transactions. Obtain test ETH from a current Sepolia faucet; never use mainnet funds for this demo.
- An authorized Sepolia RPC URL and a deployment account for the deployment step.

## Install, compile, and test

From the workspace root:

```bash
pnpm install
pnpm --filter @workspace/campusx contract:compile
pnpm --filter @workspace/campusx contract:test
pnpm --filter @workspace/campusx contract:export-abi
```

Or run the compile, test, and ABI export steps together:

```bash
pnpm --filter @workspace/campusx contract:verify-local
```

Run the web app through its Replit workflow. To build from the workspace root:

```bash
pnpm --filter @workspace/campusx run typecheck
pnpm --filter @workspace/campusx run build
```

## Sepolia deployment

Deployment is not complete until a real signed transaction is confirmed and the post-deployment checks succeed. No deployment address is included in this repository.

1. Add `SEPOLIA_RPC_URL` and `DEPLOYER_PRIVATE_KEY` through Replit Secrets. The private key must belong to the authorized testnet deployer and must never be pasted into chat, added to a `VITE_` variable, or committed. A local `.env.local` file is also supported for a personal machine and is ignored by Git.
2. Ensure the deployer account has Sepolia ETH for gas.
3. Run:

   ```bash
   pnpm --filter @workspace/campusx contract:deploy:sepolia
   ```

4. Confirm the output reports Sepolia chain ID `11155111`, the deployed address, transaction hash, block number, and verified non-empty bytecode.
5. Set the public app configuration in `artifacts/campusx/.env.local` or the web artifact's environment:

   ```env
   VITE_CAMPUSX_CONTRACT_ADDRESS=0x<verified-deployment-address>
   VITE_CAMPUSX_DEPLOYMENT_BLOCK=<confirmed-deployment-block>
   ```

6. Restart the web workflow. Confirm the wallet is on Sepolia. Recompile/export the ABI if the contract changes.

The app refuses contract reads and writes when the address is unset or invalid, or the wallet is not on Sepolia. It never substitutes sample records.

## MetaMask and demo setup

1. Install MetaMask, create or select a dedicated hackathon test wallet, and switch to Ethereum Sepolia. Never share a seed phrase or private key.
2. Ask the contract administrator wallet to authorize resolver wallets from the Authority console.
3. Submit a report from a student wallet using non-sensitive issue details.
4. Use the admin wallet to assign an authorized resolver to the report's category-routed team.
5. Use the resolver wallet to move the issue to in progress, select a real evidence file, review its browser-calculated hash, and submit the repair commitment.
6. Use a separate wallet to vote; submit a duplicate vote from that same wallet and confirm Solidity rejects it.
7. Return to the original reporter wallet and confirm or dispute the proposed resolution.
8. For a dispute, use the administrator to reopen the issue to an authorized resolver for reinspection.
9. Inspect real transaction hashes and blocks in the interface and on Sepolia Etherscan.

Until a deployment, configured contract address, funded test accounts, and resolver permissions exist, these actions remain unavailable. The local Hardhat tests exercise contract logic but do not simulate a Sepolia deployment.

## 60-second presentation

> Campus issues are easy to report and hard to track. Students may not know who took ownership, what work happened, or whether a proposed fix was accepted. CAMPUSX records the lifecycle on an Ethereum smart contract: a report is routed to a team, an authorized resolver is assigned, community members can prioritize it, and repair details are committed with an evidence hash. The reporter—not an administrator—confirms or disputes the proposed resolution, and a dispute can enter an auditable reinspection cycle. Ethereum gives the workflow inspectable permissions, transitions, and event history. The interface never shows a reporter name, but it does not promise anonymity: wallet addresses and transaction data are public. A hash can match a file; it cannot prove that a repair happened. CAMPUSX is a Sepolia hackathon prototype, not an official university service.

### Likely judge questions

1. **Does this make reporting anonymous?** No. The app omits names and does not display a reporter address, but the transaction sender and transaction data remain public on Ethereum.
2. **Why put this workflow on Ethereum?** Solidity enforces the permitted actors and state transitions, while public contract events make assignment and resolution decisions inspectable independently of a private app database.
3. **Does an evidence hash prove that the repair is real?** No. It only lets someone compare a later file with the committed bytes. It cannot validate authenticity, date, or physical work.
4. **Can someone vote many times?** The contract prevents the same address from voting twice per issue. It cannot stop one person from controlling multiple wallets.
5. **Who can resolve or reopen a report?** An authorized resolver submits a repair; only the original reporter can confirm or dispute it. An administrator can reopen a dispute for reinspection but cannot confirm on the reporter's behalf.

## Known limitations

- This prototype has no private messaging, user identity verification, notifications, backend indexer, or persistent evidence-file storage.
- Issue lists are read from contract pages; event history is queried from the configured deployment block. Public RPC providers may rate-limit requests.
- Campus team names are fixed category routing labels in this contract. Resolver permissions and assignments are managed separately by the contract administrator.
- No campus authority or university endorsement is claimed.
