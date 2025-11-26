async function getTestnet4Balance(address) {
  try {
    // Fetch confirmed UTXOs
    const confirmedResponse = await fetch(`https://mempool.space/testnet/api/address/${address}/utxo`);
    
    if (!confirmedResponse.ok) {
      throw new Error(`Error: ${confirmedResponse.status} ${confirmedResponse.statusText}`);
    }

    const confirmedData = await confirmedResponse.json();

    // Check if we have confirmed UTXOs
    const confirmedBalanceInSatoshis = confirmedData.reduce((sum, utxo) => sum + utxo.value, 0);

    // Fetch pending UTXOs if available
    const pendingResponse = await fetch(`https://mempool.space/testnet/api/address/${address}/pending`);
    
    if (!pendingResponse.ok) {
      throw new Error(`Error: ${pendingResponse.status} ${pendingResponse.statusText}`);
    }

    const pendingData = await pendingResponse.json();
    
    // Check if we have pending UTXOs
    const pendingBalanceInSatoshis = pendingData.reduce((sum, utxo) => sum + utxo.value, 0);

    // Combine confirmed and pending balances
    const totalBalanceInSatoshis = confirmedBalanceInSatoshis + pendingBalanceInSatoshis;
    
    // Convert total balance from Satoshis to BTC
    return totalBalanceInSatoshis / 1e8; // 1 BTC = 100,000,000 Satoshis

  } catch (error) {
    console.error("Error fetching balance:", error);
    return 0;
  }
}

getTestnet4Balance('tb1q5qq2pj3ajpw57eea5dgej3n8ffadkmea2gra7d')
  .then(balance => console.log(`Balance: ${balance} BTC`))
  .catch(console.error);
