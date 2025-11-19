const { JsonRpcProvider } = require('ethers');

// Block number you want to fetch
const BLOCK_NUMBER = 9647539;

// RPC URL (fixed extra brace)
const ethereumProvider = new JsonRpcProvider("https://0xrpc.io/sep");

async function getToAddresses() {
    const block = await ethereumProvider.getBlock(BLOCK_NUMBER);

    // console.log("Block Data:");
    // console.log(block.transactions);

    // Fetch receipts for all transactions
    const receipts = await Promise.all(
        block.transactions.map(tx => ethereumProvider.getTransactionReceipt(tx))
    );

    // console.log("Receipts:");
    // console.log(receipts);

    // Extract all `to` addresses (filter null)
    const toAddresses = receipts
        .map(r => r.to)
        .filter(addr => addr !== null);

    console.log("To Addresses:");
    console.dir(toAddresses, { maxArrayLength: null });

}


getToAddresses();
