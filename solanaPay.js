// install @solana/pay for this

const { Cluster, clusterApiUrl, Connection, PublicKey, Keypair } = require('@solana/web3.js');
const { encodeURL, createQR } = require('@solana/pay');
const BigNumber = require('bignumber.js');

async function main() {
    // Variable to keep state of the payment status
    let paymentStatus;

    // Connecting to devnet for this example
    console.log('1. ✅ Establish connection to the network');
    const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
    console.log('2. 🛍 Simulate a customer checkout \n');
    const recipient = new PublicKey('66G1chop825qbPJFwL3n84wrgCW65nQCYyaZ8U7CoAFH');
    const amount = new BigNumber(20);
    const reference = new Keypair().publicKey;
    const label = 'Jungle Cats store';
    const message = 'Jungle Cats store - your order - #001234';
    const memo = 'JC#4098';

    /**
     * Create a payment request link
     *
     * Solana Pay uses a standard URL scheme across wallets for native SOL and SPL Token payments.
     * Several parameters are encoded within the link representing an intent to collect payment from a customer.
     */
    console.log('3. 💰 Create a payment request link \n');
    const url = encodeURL({ recipient, amount, reference, label, message, memo });
    console.log(url)
}
main()