const QRCode = require("qrcode");

const chainIdMap = {
    sepolia: 11155111,
    amoy: 80002,
    ethereum: 1,
    polygon: 137,
    solana: 'mainnet-beta',
    "solana-devnet": 'devnet',
    bitcoin: 0,
    "bitcoin-testnet4": 1,
    tron: 'trongrid',
    "tron-shasta": 'shasta',
};

const payTokenMap = {
    sepolia: "0x2dBb8400F6EBCEEA0D09453B8E0cD0aAdB613DbF",
    amoy: "0xEF5e41CbA24d1Bd6E86E58FD37bcab9ee28fc4e2",
    ethereum: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    polygon: "0xc2132D05D31c914a87C6611C10748AaCBfF7c8F9",
    "solana-devnet": '7tiHCuMccAqHj6o7vQv7hsXBcDX8tJiViK5aPJhU9DY9',
    solana: null,
    tron: null,
    "tron-shasta": "TNo2TQh5w1b5zC8zv1ByLp3preeNZR1ZSE",
    bitcoin: null,
    "bitcoin-testnet4": null
};

function buildEvmQrUri(chain, address, amount) {
    const chainId = chainIdMap[chain];
    return `ethereum:${address}@${chainId}?value=${amount}`;
}

function buildEvmTokenQrUri(chain, depositAddress, amount) {
    const chainId = chainIdMap[chain];
    if (!chainId) throw new Error(`Unsupported chain: ${chain}`);

    const tokenAddress = payTokenMap[chain];
    if (!tokenAddress) throw new Error(`USDT contract not defined for chain: ${chain}`);

    // EIP-681 format for ERC20 token transfer
    return `ethereum:${tokenAddress}@${chainId}/transfer?address=${depositAddress}&uint256=${amount}`;
}

function buildSolanaQrUri(address, amount, network, decimals) {
    return `solana:${address}?amount=${parseInt(amount) / (10 ** decimals)}&token=SOL&network=${chainIdMap[network]}`;
}

function buildSolanaTokenQrUri(address, amount, network, decimals) {
    return `solana:${address}?amount=${parseInt(amount) / (10 ** decimals)}&spl-token=${payTokenMap[network]}`;
}

function buildBitcoinQrUri(address, amount18) {
    // Convert 18 decimals → 8 decimals for BTC
    const sats = BigInt(amount18) / BigInt(1e10);
    return `bitcoin:${address}?amount=${Number(sats)}`;
}

function buildTronQrUri(address, amount, network, decimals) {
    const sun = BigInt(amount) / BigInt(10 ** decimals);
    return `tron:${address}?amount=${sun}${network == 'tron-shasta' ? '&network=shasta' : ''}`;
}

function buildTronTokenQrUri(address, amount, network, decimals) {
    const humanAmount = Number(amount) / 10 ** Number(decimals);

    return `tron:${payTokenMap[network]}/transfer?address=${address}&amount=${humanAmount}${network == 'tron-shasta' ? '&network=shasta' : ''}`;
}

async function generateDepositQrUniversal(payChain, depositAddress, paychainAmount, payType = "native", decimals) {
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
                uri = buildSolanaQrUri(depositAddress, paychainAmount, payChain, decimals);
            } else if (payType.toLowerCase() === "usdt") {
                uri = buildSolanaTokenQrUri(depositAddress, paychainAmount, payChain, decimals);
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
                uri = buildTronQrUri(depositAddress, paychainAmount, payChain, decimals);
            } else if (payType.toLowerCase() === "usdt") {
                uri = buildTronTokenQrUri(depositAddress, paychainAmount, payChain, decimals);
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
