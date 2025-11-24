const QRCode = require("qrcode");

function buildEvmQrUri(chain, address, amountWei) {
    const chainIdMap = {
        sepolia: 11155111,
        amoy: 80002,
        ethereum: 1,
        polygon: 137,
    };

    const chainId = chainIdMap[chain];
    return `ethereum:${address}@${chainId}?value=${amountWei}`;
}

const chainIdMap = {
    sepolia: 11155111,
    amoy: 80002,
    ethereum: 1,
    polygon: 137,
};

const payTokenMap = {
    sepolia: "0x2dBb8400F6EBCEEA0D09453B8E0cD0aAdB613DbF",
    amoy: "0xEF5e41CbA24d1Bd6E86E58FD37bcab9ee28fc4e2",
    ethereum: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    polygon:  "0xc2132D05D31c914a87C6611C10748AaCBfF7c8F9",
};

function buildEvmTokenQrUri(chain, depositAddress, amount) {
  const chainId = chainIdMap[chain];
  if (!chainId) throw new Error(`Unsupported chain: ${chain}`);

  const tokenAddress = payTokenMap[chain];
  if (!tokenAddress) throw new Error(`USDT contract not defined for chain: ${chain}`);

  // EIP-681 format for ERC20 token transfer
  return `ethereum:${tokenAddress}@${chainId}/transfer?address=${depositAddress}&uint256=${amount}`;
}

function buildSolanaQrUri(address, amount18, tokenSymbol = "SOL") {
    // Convert 18 decimals → 9 decimals for SOL or SPL tokens
    const lamports = BigInt(amount18) / BigInt(1e9);
    return `solana:${address}?amount=${lamports}&token=${tokenSymbol}`;
}

function buildBitcoinQrUri(address, amount18) {
    // Convert 18 decimals → 8 decimals for BTC
    const sats = BigInt(amount18) / BigInt(1e10);
    return `bitcoin:${address}?amount=${Number(sats)}`;
}

function buildTronQrUri(address, amount18, tokenSymbol = "TRX") {
    // Convert 18 decimals → 6 decimals for TRX or TRC20 tokens
    const sun = BigInt(amount18) / BigInt(1e12);
    return `tron:${address}?amount=${sun}&token=${tokenSymbol}`;
}

async function generateDepositQrUniversal(payChain, depositAddress, paychainAmount, payType = "native") {
    let uri;

    switch (payChain) {
        case "sepolia":
        case "amoy":
        case "ethereum":
        case "polygon":
            if (payType === "native") {
                uri = buildEvmQrUri(payChain, depositAddress, paychainAmount);
            } else if (payType.toLowerCase() === "usdt") {
                uri = buildEvmTokenQrUri(payChain, depositAddress, paychainAmount);
            } else {
                throw new Error(`Unsupported payType "${payType}" for ${payChain}`);
            }
            break;

        case "solana":
        case "solana-devnet":
            if (payType === "native") {
                uri = buildSolanaQrUri(depositAddress, paychainAmount, "SOL");
            } else if (payType.toLowerCase() === "usdt") {
                uri = buildSolanaQrUri(depositAddress, paychainAmount, "USDT");
            } else {
                throw new Error(`Unsupported payType "${payType}" for ${payChain}`);
            }
            break;

        case "bitcoin":
        case "bitcoin-testnet4":
            if (payType !== "native") {
                throw new Error(`Token transfers not supported on Bitcoin`);
            }
            uri = buildBitcoinQrUri(depositAddress, paychainAmount);
            break;

        case "tron":
        case "tron-shasta":
            if (payType === "native") {
                uri = buildTronQrUri(depositAddress, paychainAmount, "TRX");
            } else if (payType.toLowerCase() === "usdt") {
                uri = buildTronQrUri(depositAddress, paychainAmount, "USDT");
            } else {
                throw new Error(`Unsupported payType "${payType}" for ${payChain}`);
            }
            break;

        default:
            throw new Error(`QR generation not supported for chain: ${payChain}`);
    }

    const png = await QRCode.toDataURL(uri);
    return { uri, png };
}

module.exports = {
    generateDepositQrUniversal,
    payTokenMap,
    chainIdMap
};
