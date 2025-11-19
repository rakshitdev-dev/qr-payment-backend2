// server.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const { JsonRpcProvider, Wallet, Contract, formatUnits, parseUnits, getAddress, hexlify, getBytes, ZeroAddress } = require('ethers');

const icoAbi = require('./icoAbi.json');
const erc20Abi = require('./erc20Abi.json');

const {
  SEPOLIA_RPC,
  BSC_TESTNET_RPC,
  RELAYER_PRIVATE_KEY,
  ICO_ADDRESS_BSC,
  TOKEN_ADDRESS_BSC,
  WATCH_WALLET_SEPOLIA,
  POLL_INTERVAL_MS = '12000',
  SALE_TYPE = '1',
  PAYMENT_TOKEN_ADDRESS_BSC = '0x0000000000000000000000000000000000000000',
  REFERRER_ADDRESS = '0x0000000000000000000000000000000000000000',
  PORT = 3000
} = process.env;

if (!SEPOLIA_RPC || !BSC_TESTNET_RPC || !RELAYER_PRIVATE_KEY || !ICO_ADDRESS_BSC || !TOKEN_ADDRESS_BSC || !WATCH_WALLET_SEPOLIA) {
  console.error("Missing required env vars. See .env.example");
  process.exit(1);
}

// Simple persistent set of processed txs (file-based for demo)
const DB_FILE = path.join(__dirname, 'processed_txs.json');
let processedTxs = new Set();
try {
  if (fs.existsSync(DB_FILE)) {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const arr = JSON.parse(raw || '[]');
    processedTxs = new Set(arr);
  }
} catch (e) {
  console.warn('Could not load processed tx DB, starting fresh.', e);
}

// helper to persist processed txs
function persistProcessed() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify([...processedTxs]), 'utf8');
  } catch (e) {
    console.error('Failed to persist processed txs', e);
  }
}

// Providers / wallets / contracts
const sepoliaProvider = new JsonRpcProvider(SEPOLIA_RPC);
const bscProvider = new JsonRpcProvider(BSC_TESTNET_RPC);
const relayerWallet = new Wallet(RELAYER_PRIVATE_KEY, bscProvider);

const icoContract = new Contract(ICO_ADDRESS_BSC, icoAbi, relayerWallet);
const tokenContract = new Contract(TOKEN_ADDRESS_BSC, erc20Abi, relayerWallet);

console.log('Relayer address (BSC testnet):', relayerWallet.address);
console.log('Watching Sepolia wallet:', WATCH_WALLET_SEPOLIA);

const app = express();
app.use(express.json());

let lastCheckedBlock = 0;

async function init() {
  lastCheckedBlock = await sepoliaProvider.getBlockNumber();
  console.log('Starting Sepolia poll at block', lastCheckedBlock);
  pollLoop();
}

async function pollLoop() {
  try {
    const latest = await sepoliaProvider.getBlockNumber();

    for (let b = lastCheckedBlock + 1; b <= latest; b++) {

      // More reliable cross-RPC block fetch
      const block = await sepoliaProvider.send("eth_getBlockByNumber", [
        "0x" + b.toString(16),
        true
      ]);

      if (!block || !block.transactions) continue;

      for (const tx of block.transactions) {
        const to = tx.to ? tx.to.toLowerCase() : null;
        if (to === WATCH_WALLET_SEPOLIA.toLowerCase()) {

          if (processedTxs.has(tx.hash)) continue;

          console.log(
            `Detected deposit: ${tx.hash} value=${tx.value} from=${tx.from}`
          );

          processedTxs.add(tx.hash);
          persistProcessed();

          handleSepoliaDeposit(tx);
        }
      }
    }

    lastCheckedBlock = latest;

  } catch (err) {
    console.error("Poll loop error", err);
  } finally {
    setTimeout(pollLoop, parseInt(POLL_INTERVAL_MS));
  }
}


/**
 * handleSepoliaDeposit(tx)
 * - tx: ethers Transaction object from block
 *
 * Demo assumption: buyer BSC address = tx.from (same key reused).
 * Uses balance-diff method to compute purchasedAmount.
 */
async function handleSepoliaDeposit(tx) {
  try {
    const buyerSepoliaAddress = tx.from;
    const buyerBscAddress = buyerSepoliaAddress; // demo mapping assumption

    // amount to pay (wei on Sepolia). We treat 1:1 for demo mapping to BSC native amount.
    const amountWei = tx.value; // BigNumber

    console.log(`Processing deposit ${tx.hash} for buyer ${buyerBscAddress} amount (wei): ${amountWei.toString()}`);

    // 1) Get relayer token balance before buy
    const balanceBefore = await tokenContract.balanceOf(relayerWallet.address);
    console.log('Relayer token balance before:', balanceBefore.toString());

    // 2) Call ICO.buy() on BSC testnet as relayer.
    // If payment token is native (ZERO_ADDRESS): send value. Otherwise, this demo expects relayer already has payment tokens.
    const saleType = BigInt(SALE_TYPE);
    const paymentToken = PAYMENT_TOKEN_ADDRESS_BSC;
    const referrer = REFERRER_ADDRESS;

    console.log('Calling ICO.buy as relayer (BSC)...');
    let txResponse;
    if (paymentToken === ZeroAddress) {
      // native payment: send value
      txResponse = await icoContract.buy(saleType, paymentToken, amountWei, referrer, { value: amountWei });
    } else {
      // token payment: assumes relayer already approved paymentToken to ICO contract
      txResponse = await icoContract.buy(saleType, paymentToken, amountWei, referrer);
    }

    console.log('Buy tx sent:', txResponse.hash);
    const receipt = await txResponse.wait();
    console.log('Buy tx mined:', receipt.transactionHash, 'status:', receipt.status);

    if (!receipt || receipt.status !== 1n) {
      console.error('Buy tx failed or reverted', receipt);
      return;
    }

    // 3) Get relayer token balance after buy
    const balanceAfter = await tokenContract.balanceOf(relayerWallet.address);
    console.log('Relayer token balance after:', balanceAfter.toString());

    // purchasedAmount = after - before
    const purchasedAmount = balanceAfter - balanceBefore;
    if (purchasedAmount <= 0n) {
      console.error('No tokens appeared in relayer balance. Aborting transfer.');
      return;
    }

    console.log('Purchased amount (tokens raw):', purchasedAmount.toString());

    // 4) Transfer tokens to buyer
    console.log(`Transferring ${purchasedAmount.toString()} tokens to buyer ${buyerBscAddress}...`);
    const transferTx = await tokenContract.transfer(buyerBscAddress, purchasedAmount);
    console.log('Transfer tx hash:', transferTx.hash);
    const transferReceipt = await transferTx.wait();
    console.log('Transfer mined:', transferReceipt.transactionHash, 'status:', transferReceipt.status);

    if (!transferReceipt || transferReceipt.status !== 1n) {
      console.error('Transfer failed or reverted', transferReceipt);
      return;
    }

    console.log(`Success: ${purchasedAmount.toString()} tokens delivered to ${buyerBscAddress} for deposit ${tx.hash}`);
    // Optionally persist successful mapping in a DB or notify frontend here.

  } catch (err) {
    console.error('Error in handleSepoliaDeposit:', err);
  }
}

// health endpoint and simple debug endpoints
app.get('/health', (req, res) => res.json({ ok: true, relayer: relayerWallet.address, watch: WATCH_WALLET_SEPOLIA }));
app.get('/processed', (req, res) => res.json({ processedCount: processedTxs.size, txs: [...processedTxs] }));

const port = parseInt(process.env.PORT || PORT, 10);
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  init().catch(e => {
    console.error('Initialization failed', e);
    process.exit(1);
  });
});
