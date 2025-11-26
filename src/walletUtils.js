const hdkey = require('hdkey');
const bip39 = require('bip39');
const ed25519 = require("ed25519-hd-key");
const { Keypair } = require("@solana/web3.js");
const { TronWeb } = require("tronweb");
const bitcoin = require("bitcoinjs-lib");
const ECPairFactory = require('ecpair').ECPairFactory;
const tinysecp = require('tiny-secp256k1');

const ECPair = ECPairFactory(tinysecp);

/**
 * Derive deposit address across multiple chains:
 * 
 * - EVM: m/44'/60'/0'/0/{index}
 * - Solana: m/44'/501'/{index}'/0'
 * - Tron: m/44'/195'/0'/0/{index}
 * - Bitcoin: m/44'/0'/0'/0/{index}
 */

async function deriveDepositAddress(mnemonic, index = 0, chain, testnet) {
    try {
        if (!bip39.validateMnemonic(mnemonic)) {
            throw new Error("Invalid mnemonic");
        }

        const seed = bip39.mnemonicToSeedSync(mnemonic);

        switch (chain) {
            /* -------------------------------------------
             * 1️⃣ EVM (ETH, BNB, MATIC)
             * ------------------------------------------- */
            case "ethereum":
            case "polygon":
            case "bsc":
            case "sepolia":
            case "amoy": {
                const path = `m/44'/60'/0'/0/${index}`;  // BIP-44 path for Ethereum

                // Create master key from the seed using hdkey
                const master = hdkey.fromMasterSeed(seed);
                const child = master.derive(path);  // Derive child key using hdkey

                return {
                    chain,
                    address: `0x${child.publicKey.slice(-20).toString('hex')}`, // Convert public key to Ethereum address
                    privateKey: child.privateKey.toString('hex'),
                };
            }

            /* -------------------------------------------
             * 2️⃣ Tron (TRC20/TRX) — secp256k1 (same as EVM)
             * ------------------------------------------- */
            case "tron":
            case "tron-shasta": {
                const path = `m/44'/195'/0'/0/${index}`; // SLIP44: 195 for TRX

                // Create master key from the seed using hdkey
                const master = hdkey.fromMasterSeed(seed);
                const child = master.derive(path);  // Derive child key using hdkey

                const tron = new TronWeb({
                    fullHost: testnet ? "https://api.shasta.trongrid.io" : "https://api.trongrid.io"
                });

                const privateKey = child.privateKey.toString('hex');
                const tronAddress = tron.address.fromPrivateKey(privateKey);
                return {
                    chain,
                    address: tronAddress,
                    privateKey,
                };
            }

            /* -------------------------------------------
             * 3️⃣ Solana (SPL tokens, SOL) — Ed25519
             * ------------------------------------------- */
            case "solana":
            case "solana-devnet": {
                const path = `m/44'/501'/${index}'/0'`;

                // Generate the root key using hdkey and then use ed25519 for Solana key generation
                const master = hdkey.fromMasterSeed(seed);
                const derived = ed25519.derivePath(path, master.privateKey.toString('hex'));
                const keypair = Keypair.fromSeed(derived.key);

                return {
                    chain,
                    address: keypair.publicKey.toBase58(),
                    privateKey: Buffer.from(keypair.secretKey).toString("hex"),
                };
            }

            /* -------------------------------------------
             * 4️⃣ Bitcoin (BTC / Testnet)
             * ------------------------------------------- */
            case "bitcoin":
            case "bitcoin-testnet3": {
                const network = chain === "bitcoin-testnet3" ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;
                const path = `m/44'/${network.bip32.public}'/0'/0/${index}`;

                // Create master key from the seed using hdkey
                const root = hdkey.fromMasterSeed(seed);
                const child = root.derive(path);  // Derive child key using hdkey

                // Generate the P2PKH address from the derived public key
                const { address } = bitcoin.payments.p2wpkh({
                    pubkey: child.publicKey,
                    network,
                });

                const wif = ECPair.fromPrivateKey(child.privateKey, { network }).toWIF();

                return {
                    chain,
                    address,
                    privateKey: wif,
                };
            }

            default:
                throw new Error(`Unsupported chain: ${chain}`);
        }
    } catch (e) {
        console.error("❌ Derive wallet error:", e.message);
        throw e;
    }
}

module.exports = { deriveDepositAddress };
