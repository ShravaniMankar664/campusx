const hre = require("hardhat");

async function main() {
  if (!process.env.SEPOLIA_RPC_URL) {
    throw new Error("Set SEPOLIA_RPC_URL through Replit Secrets before deploying.");
  }
  if (!process.env.DEPLOYER_PRIVATE_KEY) {
    throw new Error(
      "Set DEPLOYER_PRIVATE_KEY through Replit Secrets before deploying. Never paste it into chat or source files.",
    );
  }

  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== 11155111n) {
    throw new Error(`Refusing deployment: expected Sepolia (11155111), got ${network.chainId}.`);
  }

  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) throw new Error("No deployment signer is configured.");
  const CampusX = await hre.ethers.getContractFactory("CampusX", deployer);
  const campusX = await CampusX.deploy();
  const receipt = await campusX.deploymentTransaction().wait(1);
  const address = await campusX.getAddress();
  const bytecode = await hre.ethers.provider.getCode(address);
  if (bytecode === "0x") throw new Error("Deployment receipt exists, but no contract bytecode was found.");
  if ((await campusX.administrator()).toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error("Deployed administrator does not match the configured deployer.");
  }

  console.log(
    JSON.stringify(
      {
        network: "Sepolia",
        chainId: Number(network.chainId),
        address,
        deployer: deployer.address,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        verifiedBytecode: true,
        explorer: `https://sepolia.etherscan.io/address/${address}`,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
