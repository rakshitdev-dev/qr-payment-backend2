const { ethers, JsonRpcProvider, ZeroAddress, Wallet, Contract } = require('ethers');
require('dotenv').config();

const {
    PRIVATE_KEY,
    ICO_ADDRESS_BSC,
    TOKEN_ADDRESS_BSC,
    PAYMENT_TOKEN_ADDRESS_BSC,
    REFERRER_ADDRESS,
    SEPOLIA_RPC,
    BSC_TESTNET_RPC
} = process.env;

const INFURA_ID = '9ca1af07007a4463b2a3a3bacb7cafc6';

// ---------------- PROVIDERS ----------------
const ethereumProvider = new JsonRpcProvider(`https://sepolia.infura.io/v3/${INFURA_ID}`);
// const ethereumProvider = new JsonRpcProvider(SEPOLIA_RPC);
// const bscProvider = new JsonRpcProvider(`https://bsc-testnet.infura.io/v3/${INFURA_ID}`);
const bscProvider = new JsonRpcProvider(BSC_TESTNET_RPC);

// ---------------- CONTRACTS ----------------
const icoAbi = require('./icoAbi.json');
const erc20Abi = require('./erc20Abi.json');

const relayerWallet = new Wallet(PRIVATE_KEY, bscProvider);
const icoContract = new Contract(ICO_ADDRESS_BSC, icoAbi, relayerWallet);
const tokenContract = new Contract(TOKEN_ADDRESS_BSC, erc20Abi, relayerWallet);

// ---------------- PRICE FETCH ----------------
async function getPrice(symbol) {
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
    const data = await res.json();
    return parseFloat(data.price);
}

// ---------------- MONITOR ----------------
const monitorNewContracts = async () => {
    ethereumProvider.on('block', async (blockNumber) => {
        console.warn(`New block: ${blockNumber}`);
        await checkNewContracts(blockNumber);
    });
};

console.success = (...msg) =>
    console.log("\x1b[32m%s\x1b[0m", msg.join(" "));

// Safe delay to avoid Infura rate limits
const delay = (ms) => new Promise(res => setTimeout(res, ms));

const checkNewContracts = async (blockNumber) => {
    const block = await ethereumProvider.getBlock(blockNumber);

    if (!block || !block.transactions) return;

    for (const txHash of block.transactions) {
        await delay(60);
        const receipt = await ethereumProvider.getTransactionReceipt(txHash);
        if (!receipt || !receipt.to) {
            console.warn("reciept not Found for: ", txHash)
            continue;
        }
        if (receipt.to.toLowerCase() == '0x30086497c5e5f191878f9e06505d328c2b043e88'.toLowerCase()) {
            console.success("Matched")
            const buyerSepoliaAddress = receipt.from;
            const buyerBscAddress = buyerSepoliaAddress;
console.table({receipt})
console.dir({receipt})
            const amountEthWei = receipt.value;
            console.success(`Deposit detected: ${receipt.transactionHash}`);
            console.success(`Amount ETH (wei): ${amountEthWei.toString()}`);

            // ------------ ETH → BNB conversion ------------
            const ethPrice = await getPrice("ETHUSDT");
            const bnbPrice = await getPrice("BNBUSDT");

            const ethAmount = Number(ethers.formatEther(amountEthWei));
            const bnbAmount = ethAmount * (ethPrice / bnbPrice);

            const amountBNBwei = ethers.parseEther(bnbAmount.toFixed(18));
            console.success("ETH:", ethAmount, "BNB:", bnbAmount, "BNB wei:", amountBNBwei.toString());

            // ------------ ICO BUY ------------
            const balanceBefore = await tokenContract.balanceOf(relayerWallet.address);
            console.success('Relayer balance before:', balanceBefore.toString());

            const saleType = 0n;
            const paymentToken = PAYMENT_TOKEN_ADDRESS_BSC;
            const referrer = REFERRER_ADDRESS;

            let txResponse;
            if (paymentToken.toLowerCase() === ZeroAddress.toLowerCase()) {
                txResponse = await icoContract.buy(saleType, paymentToken, amountBNBwei, referrer, { value: amountBNBwei });
            } else {
                txResponse = await icoContract.buy(saleType, paymentToken, amountBNBwei, referrer);
            }

            console.success('Buy tx sent:', txResponse.hash);
            const paymentReceipt = await txResponse.wait();
            console.successog('Buy tx mined:', paymentReceipt.transactionHash, 'status:', paymentReceipt.status);

            if (!paymentReceipt || paymentReceipt.status !== 1n) {
                console.error('Buy tx failed or reverted');
                return;
            }

            // ------------ Transfer tokens to buyer ------------
            const balanceAfter = await tokenContract.balanceOf(relayerWallet.address);
            const purchasedAmount = balanceAfter - balanceBefore;

            if (purchasedAmount <= 0n) {
                console.error('No tokens received after purchase. Aborting transfer.');
                return;
            }

            console.success('Purchased amount (tokens raw):', purchasedAmount.toString());

            const transferTx = await tokenContract.transfer(buyerBscAddress, purchasedAmount);
            console.success('Transfer tx sent:', transferTx.hash);
            const transferReceipt = await transferTx.wait();
            console.success('Transfer mined:', transferReceipt.transactionHash, 'status:', transferReceipt.status);

            if (!transferReceipt || transferReceipt.status !== 1n) {
                console.error('Transfer failed or reverted');
                return;
            }

            console.success(`Success: Delivered ${purchasedAmount.toString()} tokens to ${buyerBscAddress} for deposit ${receipt.transactionHash}`);
        }
        else {
            console.debug(blockNumber, receipt.to);
        }
    }
};

monitorNewContracts();
