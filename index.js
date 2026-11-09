// aave-rate-reader — read-only query of Aave V3 (Ethereum mainnet) lending rates.
// Calls Pool.getReserveData(asset) and converts the on-chain "ray" rates to APR/APY.
// No wallet, no private key, no transactions: every call is an eth_call (view).
//
// Usage:  node index.js [assetSymbol]      (default: USDC)
//         RPC_URL=https://your-rpc node index.js WETH

const { JsonRpcProvider, Contract, ZeroAddress, getAddress } = require("ethers");

// --- Addresses: Aave address book (bgd-labs/aave-address-book, src/AaveV3Ethereum.sol) ---
const POOL_ADDRESSES_PROVIDER = "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e";
const EXPECTED_POOL = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2";
const ASSETS = {
  USDC: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
  USDT: { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
  WETH: { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18 },
};

const RPC_URL = process.env.RPC_URL || "https://ethereum-rpc.publicnode.com";
const RAY = 10n ** 27n;
const SECONDS_PER_YEAR = 31_536_000;

const providerAbi = ["function getPool() view returns (address)"];
const poolAbi = [
  `function getReserveData(address asset) view returns (
     tuple(
       uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate,
       uint128 variableBorrowIndex, uint128 currentVariableBorrowRate,
       uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id,
       address aTokenAddress, address stableDebtTokenAddress,
       address variableDebtTokenAddress, address interestRateStrategyAddress,
       uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt
     ))`,
];
const erc20Abi = ["function totalSupply() view returns (uint256)"];

// ray (1e27-scaled annual rate) -> APR as a JS number (e.g. 0.0412 = 4.12%)
const rayToApr = (ray) => Number((ray * 10n ** 9n) / RAY) / 1e9;
// Aave's UI compounds per second to show APY
const aprToApy = (apr) => (1 + apr / SECONDS_PER_YEAR) ** SECONDS_PER_YEAR - 1;
const pct = (x) => (x * 100).toFixed(4) + "%";

async function main() {
  const symbol = (process.argv[2] || "USDC").toUpperCase();
  const asset = ASSETS[symbol];
  if (!asset) throw new Error(`Unknown asset ${symbol}. Options: ${Object.keys(ASSETS).join(", ")}`);

  const provider = new JsonRpcProvider(RPC_URL);

  // Check 1: we are on Ethereum mainnet (chainId 1), not a testnet/fork by mistake.
  const { chainId } = await provider.getNetwork();
  if (chainId !== 1n) throw new Error(`Expected chainId 1 (Ethereum mainnet), RPC returned ${chainId}`);

  // Check 2: resolve the Pool from the on-chain registry and compare with the hardcoded address.
  // Catches a typo'd / stale / spoofed Pool address.
  const registry = new Contract(POOL_ADDRESSES_PROVIDER, providerAbi, provider);
  const poolAddr = getAddress(await registry.getPool());
  if (poolAddr !== getAddress(EXPECTED_POOL)) {
    throw new Error(`Pool mismatch: registry says ${poolAddr}, expected ${EXPECTED_POOL}`);
  }

  // Pin every read to one block so all numbers describe the same moment.
  const block = await provider.getBlock("latest");
  const pool = new Contract(poolAddr, poolAbi, provider);
  const r = await pool.getReserveData(asset.address, { blockTag: block.number });

  // Check 3: a zero aToken means the asset is not listed in this market.
  if (r.aTokenAddress === ZeroAddress) throw new Error(`${symbol} is not listed in this Aave V3 market`);

  const aToken = new Contract(r.aTokenAddress, erc20Abi, provider);
  const totalSupplied = await aToken.totalSupply({ blockTag: block.number });

  const supplyApr = rayToApr(r.currentLiquidityRate);
  const borrowApr = rayToApr(r.currentVariableBorrowRate);

  const out = {
    protocol: "Aave V3 (Ethereum core market)",
    network: "Ethereum mainnet (chainId 1)",
    block: block.number,
    blockTimeUTC: new Date(block.timestamp * 1000).toISOString(),
    pool: poolAddr,
    asset: `${symbol} ${asset.address}`,
    aToken: r.aTokenAddress,
    reserveLastUpdatedUTC: new Date(Number(r.lastUpdateTimestamp) * 1000).toISOString(),
    raw: {
      currentLiquidityRate_ray: r.currentLiquidityRate.toString(),
      currentVariableBorrowRate_ray: r.currentVariableBorrowRate.toString(),
    },
    supplyAPR: pct(supplyApr),
    supplyAPY: pct(aprToApy(supplyApr)),
    variableBorrowAPR: pct(borrowApr),
    variableBorrowAPY: pct(aprToApy(borrowApr)),
    totalSupplied: (Number(totalSupplied) / 10 ** asset.decimals).toLocaleString("en-US") + ` ${symbol}`,
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error("ERROR:", e.shortMessage || e.message);
  process.exit(1);
});
