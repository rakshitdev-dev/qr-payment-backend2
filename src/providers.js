require("dotenv").config();
const { JsonRpcProvider } = require("ethers");
const { Connection } = require("@solana/web3.js");
const TronWeb = require("tronweb");
const axios = require("axios");

// ------------------------------------
// 🌐 EVM PROVIDERS
// Supports: Ethereum, Polygon, Sepolia, Amoy,
//           BSC mainnet, BSC testnet
// ------------------------------------
infuraKey=process.env.INFURA_API_KEY

const evmProviders = {
    // Ethereum
    ethereum: new JsonRpcProvider(`https://mainnet.infura.io/v3/${infuraKey}`),

    // Polygon mainnet
    polygon: new JsonRpcProvider("https://polygon-rpc.com/"),

    // Sepolia
    sepolia: new JsonRpcProvider(`https://sepolia.infura.io/v3/${infuraKey}`),

    // Polygon Amoy Testnet
    amoy: new JsonRpcProvider(`https://polygon-amoy.infura.io/v3/${infuraKey}`),

    // BSC mainnet
    bsc: new JsonRpcProvider("https://bsc-dataseed.binance.org"),
    bscTestnet: new JsonRpcProvider(`https://bsc-testnet.infura.io/v3/${infuraKey}`),
};



// ------------------------------------
// 🟣 SOLANA CONNECTIONS
// ------------------------------------
const solanaConnections = {
    solana: new Connection("https://api.mainnet-beta.solana.com", "confirmed"),
    "solana-devnet": new Connection("https://api.devnet.solana.com", "confirmed")
};



// ------------------------------------
// 🔴 TRON CLIENTS
// ------------------------------------
// const tronClients = {
//     tron: new TronWeb({
//         fullHost: "https://api.trongrid.io",
//         privateKey: null
//     }),
//     "tron-shasta": new TronWeb({
//         fullHost: "https://api.shasta.trongrid.io",
//         privateKey: null
//     })
// };

const tronClients={} // for now will check it later

// ------------------------------------
// 🟧 BITCOIN UTXO API (Blockstream)
// Supports: mainnet + testnet4
// ------------------------------------
const bitcoinApi = {
    async getUtxos(address, isTestnet4 = false) {
        const baseUrl = isTestnet4
            ? "https://blockstream.info/testnet/api"
            : "https://blockstream.info/api";

        try {
            const { data } = await axios.get(`${baseUrl}/address/${address}/utxo`);
            return data || [];
        } catch (err) {
            console.error("Bitcoin API error:", err.message);
            return [];
        }
    }
};



// ------------------------------------
// 📤 EXPORT EVERYTHING
// ------------------------------------
module.exports = {
    evmProviders,
    solanaConnections,
    tronClients,
    bitcoinApi
};
