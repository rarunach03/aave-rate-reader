# aave-rate-reader

A tiny read-only script that asks the **Aave V3 Pool contract on Ethereum mainnet** for an asset's current lending rates and converts them into human-readable APR/APY.

No wallet, no private key, no transactions. Every call is an `eth_call` (view function), so it costs nothing and changes nothing on-chain.

## Run it

Requires Node.js 18+.

```bash
npm install
node index.js            # USDC (default)
node index.js WETH       # also: USDT
RPC_URL=https://<your-rpc> node index.js   # optional: use your own RPC endpoint
```

Default RPC: `https://ethereum-rpc.publicnode.com` (free, no API key).

## What it calls

| Step | Contract | Function | Why |
|---|---|---|---|
| 1 | RPC | `eth_chainId` | Abort unless chainId = 1 (mainnet) |
| 2 | PoolAddressesProvider `0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e` | `getPool()` | Confirm the hardcoded Pool address matches Aave's on-chain registry |
| 3 | Pool `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` | `getReserveData(asset)` | Returns `currentLiquidityRate` (supply) and `currentVariableBorrowRate`, both in ray (1e27) |
| 4 | aToken (from step 3) | `totalSupply()` | Total amount supplied to the reserve |

All reads after step 2 are pinned to the same block so the numbers describe one moment.

**Conversion:** `APR = rate / 1e27`; `APY = (1 + APR / 31,536,000)^31,536,000 − 1` (per-second compounding, the convention Aave's UI uses).

## Validation checks

- Wrong network → error (chainId ≠ 1)
- Wrong / stale / spoofed Pool address → error (registry mismatch)
- Asset not listed in the market → error (aToken = zero address)
- RPC unreachable → clean `ERROR:` message and exit code 1

## Sample output

See `sample-output.json` (Ethereum mainnet, block 26,375,467, 2026-11-09 06:14:11 UTC). USDC supply APR 3.7059% (APY 3.7755%), variable borrow APR 4.4399% (APY 4.5399%), ~2.84B USDC supplied.

## Limitations

The script trusts the RPC provider to return true chain state and cannot detect a dishonest node. It also assumes Aave keeps the current `getReserveData` struct layout; an upgrade that changes it would break decoding.

## Sources

- Aave V3 Pool docs (`getReserveData`, rates in ray): https://aave.com/docs/aave-v3/smart-contracts/pool
- Aave address book (official addresses): https://github.com/bgd-labs/aave-address-book/blob/main/src/AaveV3Ethereum.sol
- Pool on Etherscan: https://etherscan.io/address/0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2
