require("dotenv").config();
const { Contract, ZeroAddress } = require("ethers");
const { BigNumber } = require("bignumber.js");
const ICO_ABI = require("./icoAbi.json");
const { evmProviders } = require("./providers");
const { ICO_ADDRESS_BSC } = process.env;

const getPrice = async (symbol) => {
    try {
        const resp = await fetch(
            `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`
        );

        if (!resp.ok) throw new Error("Invalid Binance response");

        const data = await resp.json();
        return Number(data.price); // return price in USD
    } catch (err) {
        console.error("Binance price fetch error:", err.message);
        return null;
    }
}

const mapChainToBinanceSymbol = (chain) => {
    const normalized = chain.toLowerCase();

    const mapping = {
        // MAINNETS
        bnb: "BNBUSDT",
        eth: "ETHUSDT",
        matic: "MATICUSDT",
        solana: "SOLUSDT",
        btc: "BTCUSDT",

        // TESTNETS → map to mainnet price
        sepolia: "ETHUSDT",
        holesky: "ETHUSDT",
        goerli: "ETHUSDT",

        mumbai: "MATICUSDT",
        amoy: "MATICUSDT",

        chapel: "BNBUSDT",
        testnet: "BNBUSDT",

        "solana-devnet": "SOLUSDT",
        "solana-testnet": "SOLUSDT",

        "btc-testnet": "BTCUSDT",
        "bitcoin-testnet": "BTCUSDT",

        "arbitrum-sepolia": "ETHUSDT",
        "base-sepolia": "ETHUSDT"
    };

    return mapping[normalized] || null;
};

// MAIN FUNCTION
const getAmountsData = async (payToken, amountInUsd) => {
    console.log(payToken, amountInUsd)
    const usdAmount = Number(amountInUsd);
    if (isNaN(usdAmount) || usdAmount <= 0) {
        throw new Error("Invalid USD amount");
    }

    // Detect if payment token is USDT (erc20)
    const isUSDT = payToken.endsWith("-usdt");
    const baseChain = isUSDT ? payToken.replace("-usdt", "") : payToken;

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

    // Convert to 18-decimal string
    const paychainAmount = rawAmount
        .multipliedBy(new BigNumber(10).pow(18))
        .toFixed(0); // no decimals

    // For compatibility (you asked

    return {
        usdAmount,
        paychainAmount,
        payChain,
    };
}


const contract = new Contract(ICO_ADDRESS_BSC, ICO_ABI, evmProviders.bscTestnet);

const getBnbPrice = async () => {
    try {
        // calculate USD amount for 1 BNB (1e18)
        const price = await contract.calculateUSDAmount(
            ZeroAddress,
            1n * 10n ** 18n
        );

        return price; // returns BigInt
    } catch (err) {
        console.error("bnbPrice error:", err);
        throw err;
    }
};

module.exports = {
    getPrice,
    getAmountsData,
    getBnbPrice
};