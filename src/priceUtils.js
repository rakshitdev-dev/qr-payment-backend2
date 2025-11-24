require("dotenv").config();
const { Contract, ZeroAddress } = require("ethers");
const { BigNumber } = require("bignumber.js");
const ICO_ABI = require("./icoAbi.json");
const { evmProviders } = require("./providers");
const { payTokenMap } = require("./qrUtils");
const { ICO_ADDRESS_BSC } = process.env;
const { Connection, PublicKey } = require("@solana/web3.js");
const { getMint } = require("@solana/spl-token");
const TronWeb = require("tronweb");


const ERC20_ABI = [
    "function decimals() view returns (uint8)"
];

async function getErc20Decimals(chain, tokenAddress) {
    const provider = evmProviders[chain];
    const contract = new Contract(tokenAddress, ERC20_ABI, provider);
    return Number(await contract.decimals());
}

async function getSplDecimals(chain, mintAddress) {
    const endpoint = chain === "solana"
        ? "https://api.mainnet-beta.solana.com"
        : "https://api.devnet.solana.com";

    const connection = new Connection(endpoint);
    const mintInfo = await getMint(connection, new PublicKey(mintAddress));
    return mintInfo.decimals;
}


async function getTrc20Decimals(chain, tokenAddress) {
    const tron = new TronWeb({
        fullHost: chain === "tron"
            ? "https://api.trongrid.io"
            : "https://api.shasta.trongrid.io",
    });

    const contract = await tron.contract().at(tokenAddress);
    const decimals = await contract.decimals().call();
    return Number(decimals);
}


// ------- FETCH PRICE FROM BINANCE ---------
const getPrice = async (symbol) => {
    try {
        const resp = await fetch(
            `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`
        );

        if (!resp.ok) throw new Error("Invalid Binance response");

        const data = await resp.json();
        return Number(data.price);
    } catch (err) {
        console.error("Binance price fetch error:", err.message);
        return null;
    }
};

// ------- CHAIN -> BINANCE PAIR MAPPING ---------
const mapChainToBinanceSymbol = (chain) => {
    const c = chain.toLowerCase();

    const mapping = {
        sepolia: "ETHUSDT",
        ethereum: "ETHUSDT",

        amoy: "MATICUSDT",
        polygon: "MATICUSDT",

        solana: "SOLUSDT",
        "solana-devnet": "SOLUSDT",

        bitcoin: "BTCUSDT",
        "bitcoin-testnet4": "BTCUSDT",

        tron: "TRXUSDT",
        "tron-shasta": "TRXUSDT",
    };

    return mapping[c] || null;
};

async function getTokenDecimals(chain) {
    switch (true) {
        // --------------------------  
        // 1️⃣ EVM ERC20  
        // --------------------------
        case ["sepolia", "amoy", "ethereum", "polygon", "bnb", "chapel"].includes(chain):
            return await getErc20Decimals(chain, payTokenMap[chain]);

        // --------------------------  
        // 2️⃣ Solana SPL Token  
        // --------------------------
        case ["solana", "solana-devnet"].includes(chain):
            return await getSplDecimals(chain, payTokenMap[chain]);

        // --------------------------  
        // 3️⃣ Tron TRC20 Token  
        // --------------------------
        case ["tron", "tron-shasta"].includes(chain):
            return await getTrc20Decimals(chain, payTokenMap[chain]);

        // --------------------------  
        // 4️⃣ Bitcoin Tokens  
        // --------------------------
        case ["bitcoin", "bitcoin-testnet4"].includes(chain):
            // Omni USDT = 8 decimals (if used)
            return 8;

        default:
            throw new Error(`Unsupported chain for decimals: ${chain}`);
    }
}
const nativeDecimalsMap = {
    'sepolia': 18,
    'ethereum': 18,

    'amoy': 18,
    'polygon': 18,

    'bnb': 18,
    'chapel': 18,

    'solana': 9,
    "solana-devnet": 9,

    'bitcoin': 8,
    "bitcoin-testnet4": 8,

    'tron': 6,
    "tron-shasta": 6,
}

// ------- MAIN CALCULATION FUNCTION ---------
const getAmountsData = async (payToken, amountInUsd) => {
    const usdAmount = Number(amountInUsd);
    if (isNaN(usdAmount) || usdAmount <= 0) {
        throw new Error("Invalid USD amount");
    }

    // Detect if payment token is USDT (erc20)
    const isUSDT = payToken.endsWith("-usdt");
    const baseChain = isUSDT ? payToken.replace("-usdt", "") : payToken;
    const payType = isUSDT ? "usdt" : "native"
    // Normalize chain name for your return value
    const payChain = baseChain;

    // ---------------------
    // 1️⃣ GET PRICE
    // ---------------------
    let priceSymbol = null;

    if (isUSDT) {
        // USDT pairs → chain irrelevant for price
        priceSymbol = "USDTUSDT";
        // price always = 1
    } else {
        // Native coins
        priceSymbol = mapChainToBinanceSymbol(baseChain);
    }

    let priceUsd = 1; // For USDT
    if (!isUSDT) {
        priceUsd = await getPrice(priceSymbol);
        if (!priceUsd) throw new Error(`Price fetch failed for ${priceSymbol}`);
    }

    // ---------------------
    // 2️⃣ CALCULATE TOKEN AMOUNT
    // ---------------------
    // tokenAmount = USD / price
    const rawAmount = new BigNumber(usdAmount).div(priceUsd);

    const decimals = isUSDT ? await getTokenDecimals(baseChain) : nativeDecimalsMap[baseChain];

    const paychainAmount = rawAmount
        .multipliedBy(new BigNumber(10).pow(decimals))
        .toFixed(0); // no decimals

    // For compatibility (you asked

    return {
        paychainAmount,
        payChain,
        payType
    };
}

// -------- BNB PRICE USING CONTRACT ORACLE --------

const getBnbPrice = async () => {
    try {
        const icoContract = new Contract(ICO_ADDRESS_BSC, ICO_ABI, evmProviders.bscTestnet);
        const price = await icoContract.calculateUSDAmount(
            ZeroAddress,
            1n * 10n ** 18n
        );

        return price;
    } catch (err) {
        console.error("bnbPrice error:", err);
        throw err;
    }
};

module.exports = {
    getPrice,
    getAmountsData,
    getBnbPrice,
    nativeDecimalsMap,
};
