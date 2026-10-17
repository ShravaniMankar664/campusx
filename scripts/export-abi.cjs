const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const artifactPath = path.join(
  root,
  ".hardhat-artifacts",
  "contracts",
  "CampusX.sol",
  "CampusX.json",
);
const outputPath = path.join(root, "src", "lib", "CampusXAbi.json");

if (!fs.existsSync(artifactPath)) {
  throw new Error("Compile CampusX.sol first: pnpm contract:compile");
}

const { abi } = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify({ abi }, null, 2)}\n`);
console.log(`Exported ${abi.length} ABI entries to src/lib/CampusXAbi.json`);
