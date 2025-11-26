require("dotenv").config();
const { JsonRpcProvider } = require("ethers");
const { Connection } = require("@solana/web3.js");
const { TronWeb } = require("tronweb");
const axios = require("axios");

// ------------------------------------
// 🌐 EVM PROVIDERS
// Supports: Ethereum, Polygon, Sepolia, Amoy,
//           BSC mainnet, BSC testnet
// ------------------------------------
infuraKey = process.env.INFURA_API_KEY

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
const tronClients = {
    'tron': new TronWeb({
        fullHost: "https://api.trongrid.io",
        privateKey: 'b03a5d4560f61fd2cf94a9a25f7a2f5667dba9dfd08756eedf907f9ec5df984a'//0 balance private key
    }),
    "tron-shasta": new TronWeb({
        fullHost: "https://api.shasta.trongrid.io",
        privateKey: 'b03a5d4560f61fd2cf94a9a25f7a2f5667dba9dfd08756eedf907f9ec5df984a'//0 balance private key
    })
};


// ------------------------------------
// 🟧 BITCOIN UTXO API (Blockstream)
// Supports: mainnet + testnet4
// ------------------------------------
const bitcoinApi = {
    async getUtxos(address, isTestnet = false) {
        const baseUrl = isTestnet
            ? "https://api.blockcypher.com/v1/btc/test3/addrs/"
            : "https://api.blockcypher.com/v1/btc/main/addrs/";

        const url = `${baseUrl}${address}/?unspent=true`;  // Added `unspent=true` for UTXOs

        try {
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`Failed to fetch data from Blockcypher: ${response.statusText}`);
            }

            const data = await response.json(); // Parse the response as JSON
            return data;
        } catch (error) {
            throw("Error fetching UTXOs:", error);
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
