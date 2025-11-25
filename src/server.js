require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const Session = require("./models/Session");
const { ethers, ZeroAddress } = require("ethers");
const { deriveDepositAddress } = require("./walletUtils");
const ICO_ABI = require("./icoAbi.json");
const { getAmountsData, getBnbPrice } = require("./priceUtils");
const { generateDepositQrUniversal, payTokenMap } = require("./qrUtils");
const { PublicKey } = require("@solana/web3.js");
// Load providers from providers.js
const {
    evmProviders,
    solanaConnections,
    tronClients,
    bitcoinApi
} = require("./providers");
const { Contract } = require("ethers");
const { getAssociatedTokenAddress, getAccount } = require("@solana/spl-token");
const { Wallet } = require("ethers");
const { JsonRpcProvider } = require("ethers");

// Your Session model

BigInt.prototype.toJSON = function () { return this.toString(); };

const {
    MASTER_MNEMONIC,
    RELAYER_PRIVATE_KEY_TESTNET,
    BSC_RPC_TESTNET,
    ICO_ADDRESS_BSC_TESTNET,
    RELAYER_PRIVATE_KEY_MAINNET,
    BSC_RPC_MAINNET,
    ICO_ADDRESS_BSC_MAINNET,
    MONGO_URI,
    MONGO_DB,
} = process.env;

const app = express();
app.use(cors());
app.use(express.json());
console.log("SERVER STARTING");

mongoose.connect(MONGO_URI, { dbName: MONGO_DB || "ico_payments" })
    .then(() => console.log("✅ MongoDB connected"))
    .catch(err => console.error("Mongo error:", err));

// RPC providers
const bscProviderTestnet = new JsonRpcProvider(BSC_RPC_TESTNET);
const relayerWalletTestnet = RELAYER_PRIVATE_KEY_TESTNET
    ? new Wallet(RELAYER_PRIVATE_KEY_TESTNET, bscProviderTestnet)
    : null;

const bscProviderMainnet = new JsonRpcProvider(BSC_RPC_MAINNET);
const relayerWalletMainnet = RELAYER_PRIVATE_KEY_MAINNET
    ? new Wallet(RELAYER_PRIVATE_KEY_MAINNET, bscProviderMainnet)
    : null;

/* ============================================================
    CREATE SESSION + QR
============================================================ */
app.post("/create-qr-tx", async (req, res) => {
    try {
        const {
            saleType,
            payToken,
            amountInUsd,
            userAddress,
            referrer,
            testnet,
        } = req.body;
        // console.log({
        //     saleType,
        //     payToken,
        //     amountInUsd,
        //     userAddress,
        //     referrer,
        //     testnet,
        // })

        // --- 1️⃣ Validate Required Fields ---
        const requiredFields = { saleType, payToken, amountInUsd, userAddress, referrer };
        const missing = Object.entries(requiredFields)
            .filter(([_, v]) => v === null || v === undefined)
            .map(([k]) => k);

        if (missing.length > 0)
            return res.status(400).json({ success: false, error: `Missing: ${missing.join(", ")}` });

        if (!MASTER_MNEMONIC)
            return res.status(500).json({ success: false, error: "MASTER_MNEMONIC missing" });


        // --- 2️⃣ Generate deposit address (HD Wallet) ---
        const index = await Session.countDocuments();

        // --- 3️⃣ Calculate amounts ---
        const {
            paychainAmount,
            payChain,
            payType,
            decimals
        } = await getAmountsData(payToken, amountInUsd);

        const {
            address: depositAddress,
            privateKey: derivedPriv,
        } = deriveDepositAddress(MASTER_MNEMONIC, index, payChain, testnet);

        // --- 4️⃣ Generate QR Code ---
        const { uri, png } = await generateDepositQrUniversal(
            payChain,
            depositAddress,
            paychainAmount,
            payType,
            decimals
        );

        // --- 5️⃣ Save Session in DB ---
        const session = await Session.create({
            depositAddress,
            derivedPriv,
            userAddress,
            saleType,
            payToken,
            amountUsd: amountInUsd,
            amountPayChain: paychainAmount,
            referrer,
            payChain,
            payType,
            paymentStatus: "pending",
            executionStatus: "pending",
            testnet
        });


        // --- 6️⃣ Return Response ---
        return res.json({
            success: true,
            sessionId: session._id,     // ⭐ IMPORTANT
            depositAddress,
            uri,
            png,
            paychainAmount,
            payChain,
            payType,
            decimals
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/* ============================================================
    CHECK PAYMENT STATUS
============================================================ */
app.get("/session-status/:id", async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({ success: false, error: "invalid id" });
        }

        const session = await Session.findById(id);
        if (!session) {
            return res.status(404).json({ success: false, error: "session not found" });
        }

        const {
            depositAddress,
            amountPayChain,
            payChain,
            paymentStatus,
            executionStatus
        } = session;

        // Already confirmed
        if (executionStatus === "executed") {
            throw new Error("Session already executed");
        }

        if (paymentStatus === "confirmed") {
            return res.json({
                success: true,
                paid: true
            });
        }

        const minValue = BigInt(amountPayChain);

        // -----------------------------------------
        // 🟦 EVM CHAINS (ETH, Polygon, Sepolia, Amoy, BSC, BSC-testnet4)
        // -----------------------------------------
        const evmChains = [
            "sepolia",
            "amoy",
            "ethereum",
            "polygon",
            "bsc",
            "bsc-testnet"
        ];

        if (evmChains.includes(payChain)) {
            const provider = evmProviders[payChain];

            if (session.payType === "native") {
                // -------------------------
                // 🔹 Native coin check
                // -------------------------
                const balance = await provider.getBalance(depositAddress);

                if (balance < minValue) {
                    return res.json({
                        success: true,
                        paid: false,
                        currentBalance: ethers.formatEther(balance)
                    });
                }

                session.paymentStatus = "confirmed";
                await session.save();

                return res.json({ success: true, paid: true });
            }

            if (session.payType === "usdt") {
                // -------------------------
                // 🔹 USDT (or any ERC20 token) check
                // -------------------------
                const usdtAddress = payTokenMap[payChain];          // map chain → token
                const usdtAbi = [
                    "function balanceOf(address) view returns (uint256)",
                    "function decimals() view returns (uint8)"
                ];

                const token = new Contract(usdtAddress, usdtAbi, provider);

                const balance = await token.balanceOf(depositAddress);
                const decimals = await token.decimals();              // usually 6 for USDT

                // Convert minValue (USD 18 decimals) → token decimals
                const minTokenValue =
                    decimals === 18
                        ? minValue
                        : minValue / 10n ** (18n - BigInt(decimals));

                if (balance < minTokenValue) {
                    return res.json({
                        success: true,
                        paid: false,
                        currentBalance:
                            Number(balance) / 10 ** decimals
                    });
                }

                session.paymentStatus = "confirmed";
                await session.save();

                return res.json({ success: true, paid: true });
            }
        }

        // -----------------------------------------
        // 🟣 SOLANA MAINNET + DEVNET
        // -----------------------------------------
        if (["solana", "solana-devnet"].includes(payChain)) {
            const conn = solanaConnections[payChain]; // assuming solanaConnections is predefined
            if (session.payType === "native") {
                const lamports = await conn.getBalance(new PublicKey(depositAddress));
                const requiredLamports = parseInt(minValue);

                if (BigInt(lamports) < requiredLamports) {
                    return res.json({
                        success: true,
                        paid: false,
                        currentBalance: lamports.toString(),
                    });
                }

                session.paymentStatus = "confirmed";
                await session.save();
                return res.json({ success: true, paid: true });
            }

            if (session.payType === "usdt") {
                // -------------------------
                // 🔹 USDT (or any ERC20 token) check for Solana
                // -------------------------

                const usdtAddress = payTokenMap[payChain]; // USDT token address in `payTokenMap`
                const usdtMint = new PublicKey(usdtAddress); // USDT token mint (e.g., for Solana devnet, it might be a known address)

                // Get the associated token address for the deposit address and the USDT token mint
                const associatedTokenAddress = await getAssociatedTokenAddress(usdtMint, new PublicKey(depositAddress));

                try {
                    // Fetch the token account for USDT
                    const tokenAccount = await getAccount(conn, associatedTokenAddress);
                    // Get the balance of the USDT token in the account
                    const usdtBalance = tokenAccount.amount; // tokenAccount.amount is a BigNumber

                    const requiredAmount = parseInt(minValue); // The minimum amount required

                    // Check if the USDT balance meets the required amount
                    if (usdtBalance < requiredAmount) {
                        return res.json({
                            success: true,
                            paid: false,
                            currentBalance: usdtBalance.toString(),
                        });
                    }

                    // If balance is sufficient, update the session
                    session.paymentStatus = "confirmed";
                    await session.save();

                    return res.json({
                        success: true,
                        paid: true,
                        currentBalance: usdtBalance.toString(),
                    });

                } catch (error) {
                    console.error("Error fetching USDT balance:", error);
                    return res.json({
                        success: false,
                        error: "Failed to check USDT balance",
                    });
                }
            }
        }

        // -----------------------------------------
        // 🟧 BITCOIN MAINNET + TESTNET4
        // -----------------------------------------
        if (["bitcoin", "bitcoin-testnet4"].includes(payChain)) {
            const isTestnet = payChain === "bitcoin-testnet4";

            // sats = amount18 / 1e10 (reverse QR logic)
            const satsRequired = minValue / 10000000000n;

            const utxos = await bitcoinApi.getUtxos(depositAddress, isTestnet);

            const totalSats = utxos.reduce(
                (sum, utxo) => sum + BigInt(utxo.value),
                0n
            );

            if (totalSats < satsRequired) {
                return res.json({
                    success: true,
                    paid: false,
                    currentBalance: totalSats.toString(),
                });
            }

            session.paymentStatus = "confirmed";
            await session.save();
            return res.json({ success: true, paid: true });
        }

        // -----------------------------------------
        // 🔴 TRON MAINNET + SHASTA
        // -----------------------------------------
        if (["tron", "tron-shasta"].includes(payChain)) {
            const tronWeb = tronClients[payChain];
            if (session.payType === "native") {
                const sun = await tronWeb.trx.getBalance(depositAddress);
                // sun = amount18 / 1e12
                const sunRequired = Number(minValue) / 1e6;

                if (BigInt(sun) < sunRequired) {
                    return res.json({
                        success: true,
                        paid: false,
                        currentBalance: sun.toString(),
                    });
                }

                session.paymentStatus = "confirmed";
                await session.save();
                return res.json({ success: true, paid: true });
            }
            if (session.payType === "usdt") {
                const usdtAddress = payTokenMap[payChain]; // USDT contract address in `payTokenMap`
                const usdtContract = await tronWeb.contract().at(usdtAddress); // Interact with the USDT contract

                try {
                    // Fetch the balance of USDT for the deposit address
                    const usdtBalance = await usdtContract.balanceOf(depositAddress).call();
                    const requiredAmount = parseInt(minValue); // The minimum amount required

                    // Check if the USDT balance meets the required amount
                    if (BigInt(usdtBalance) < BigInt(requiredAmount)) {
                        return res.json({
                            success: true,
                            paid: false,
                            currentBalance: usdtBalance.toString(),
                        });
                    }

                    // If balance is sufficient, update the session
                    session.paymentStatus = "confirmed";
                    await session.save();

                    return res.json({
                        success: true,
                        paid: true,
                        currentBalance: usdtBalance.toString(),
                    });

                } catch (error) {
                    console.error("Error fetching USDT balance:", error);
                    return res.json({
                        success: false,
                        error: "Failed to check USDT balance",
                    });
                }
            }

        }

        // Unsupported chain
        return res.status(400).json({
            success: false,
            error: "Unsupported chain"
        });

    } catch (err) {
        console.error("session-status error:", err);
        return res.status(500).json({ success: false, error: err.message });
    }
});


/* ============================================================
    TRIGGER BUY ON BSC
============================================================ */
app.post("/trigger-buy", async (req, res) => {
    try {
        const { sessionId } = req.body;

        if (!mongoose.isValidObjectId(sessionId))
            return res.status(400).json({ success: false, error: "invalid id" });

        const session = await Session.findById(sessionId);
        if (!session)
            return res.status(404).json({ success: false, error: "session not found" });

        if (session.paymentStatus !== "confirmed")
            return res.status(400).json({ success: false, error: "Payment pending" });

        if (session.executionStatus === "executed") {
            return res.status(400).json({
                success: false,
                error: "Buy already executed"
            });
        }

        const ico = new ethers.Contract(
            session.testnet ? ICO_ADDRESS_BSC_TESTNET : ICO_ADDRESS_BSC_MAINNET,
            ICO_ABI,
            session.testnet ? relayerWalletTestnet : relayerWalletMainnet
        );

        // Values from session
        const saleType = BigInt(session.saleType);
        const payToken = ZeroAddress;
        const referrer = session.referrer;
        const user = session.userAddress;

        const bnbPrice = await getBnbPrice(session.testnet ? ICO_ADDRESS_BSC_TESTNET : ICO_ADDRESS_BSC_MAINNET, session.testnet ? bscProviderTestnet : bscProviderMainnet);

        const usdFloat = parseFloat(session.amountUsd);
        const usdAmount18 = BigInt(Math.round(usdFloat * 1e18));
        const amount = (usdAmount18 * 10n ** 18n) / bnbPrice;
        const tx = await ico.buy(
            saleType,
            payToken,
            amount,
            referrer,
            user,
            { value: amount }
        );

        const receipt = await tx.wait();
        session.executionStatus = "executed";
        session.executionTxHash = receipt.hash;
        await session.save();

        return res.json({
            success: true,
            txHash: receipt.hash
        });

    } catch (err) {
        console.error("❌ trigger-buy error:", {
            message: err.message,
            stack: err.stack,
            reason: err.reason,
            data: err.data
        });

        return res.status(500).json({ success: false, error: err.message });
    }
});

/* ============================================================
    START SERVER
============================================================ */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Backend running on port ${PORT}`);
});
