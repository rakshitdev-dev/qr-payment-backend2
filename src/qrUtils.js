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

function buildSolanaQrUri(address, amount18) {
    const lamports = BigInt(amount18) / BigInt(1e9); // downscale 18 → 9

    return `solana:${address}?amount=${lamports}`;
}

function buildBitcoinQrUri(address, amount18) {
    const sats = BigInt(amount18) / BigInt(1e10); // 18 → 8

    return `bitcoin:${address}?amount=${Number(sats)}`;
}

function buildTronQrUri(address, amount18) {
    const sun = BigInt(amount18) / BigInt(1e12); // 18 → 6

    return `tron:${address}?amount=${sun}`;
}

async function generateDepositQrUniversal(payChain, depositAddress, paychainAmount) {

    let uri;

    switch (payChain) {
        // --------------------
        //   🌐 EVM CHAINS
        // --------------------
        case "sepolia":
        case "amoy":
        case "ethereum":
        case "polygon":
            uri = buildEvmQrUri(payChain, depositAddress, paychainAmount);
            break;

        // --------------------
        //   🟣 SOLANA
        // --------------------
        case "solana":
        case "solana-devnet":
            uri = buildSolanaQrUri(depositAddress, paychainAmount);
            break;

        // --------------------
        //   🟧 BITCOIN TESTNET4
        // --------------------
        case "bitcoin":
        case "bitcoin-testnet4":
            uri = buildBitcoinQrUri(depositAddress, paychainAmount);
            break;

        // --------------------
        //   🔴 TRON
        // --------------------
        case "tron":
        case "tron-shasta":
            uri = buildTronQrUri(depositAddress, paychainAmount);
            break;

        default:
            throw new Error(`QR generation not supported for chain: ${payChain}`);
    }

    const png = await QRCode.toDataURL(uri);
    return { uri, png };
}



module.exports = {
    generateDepositQrUniversal
};