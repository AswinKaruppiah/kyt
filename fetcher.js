/**
 * Blockchain Inflow Feeder
 * Retrieves recent incoming token transfers (USDT / USDC) for TRON and EVM wallets.
 */

const TRON_USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const ETH_USDT_CONTRACT = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const ETH_USDC_CONTRACT = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

/**
 * Fetch incoming TRC-20 USDT transfers for a TRON wallet.
 * @param {string} tronAddress
 * @param {number} minAmount - Minimum transfer amount in USDT (filters dust)
 * @param {number} limit - Maximum number of recent transfers
 * @returns {Promise<Array<{from: string, to: string, amount: number, token: string, txHash: string, timestamp: number}>>}
 */
async function fetchTronInflows(tronAddress, minAmount = 5, limit = 50) {
  try {
    const url = `https://api.trongrid.io/v1/accounts/${tronAddress}/transactions/trc20?limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) return [];

    const json = await res.json();
    if (!json.data || !Array.isArray(json.data)) return [];

    const results = [];
    for (const tx of json.data) {
      // Must be incoming transfer to this address
      if (tx.to !== tronAddress) continue;
      if (!tx.from || tx.from === tronAddress) continue;

      const symbol = tx.token_info?.symbol || 'UNKNOWN';
      const decimals = tx.token_info?.decimals || 6;
      const rawValue = BigInt(tx.value || 0);
      const amount = Number(rawValue) / (10 ** decimals);

      // Only track USDT inflows above the minimum threshold
      if (symbol === 'USDT' && amount >= minAmount) {
        results.push({
          from: tx.from,
          to: tx.to,
          amount: Math.round(amount * 100) / 100,
          token: 'USDT (TRC-20)',
          txHash: tx.transaction_id,
          timestamp: tx.block_timestamp
        });
      }
    }

    return results;
  } catch (err) {
    return [];
  }
}

/**
 * Fetch incoming ERC-20 (USDT / USDC) transfers for an EVM wallet.
 * Uses open Blockscout REST API (100% free, zero API key).
 * @param {string} evmAddress
 * @param {number} minAmount
 * @param {number} limit
 * @returns {Promise<Array<{from: string, to: string, amount: number, token: string, txHash: string, timestamp: number}>>}
 */
async function fetchEvmInflows(evmAddress, minAmount = 5, limit = 15) {
  try {
    const cleanAddr = evmAddress.toLowerCase();
    const url = `https://eth.blockscout.com/api?module=account&action=tokentx&address=${cleanAddr}&offset=${limit}`;
    const res = await fetch(url);
    if (!res.ok) return [];

    const json = await res.json();
    if (!json.result || !Array.isArray(json.result)) return [];

    const results = [];
    for (const tx of json.result) {
      if (!tx.to || tx.to.toLowerCase() !== cleanAddr) continue;
      if (!tx.from || tx.from.toLowerCase() === cleanAddr) continue;

      const contract = (tx.contractAddress || '').toLowerCase();
      const symbol = tx.tokenSymbol || '';
      const decimals = Number(tx.tokenDecimal || 6);

      const isUsdt = contract === ETH_USDT_CONTRACT || symbol === 'USDT';
      const isUsdc = contract === ETH_USDC_CONTRACT || symbol === 'USDC';

      if (isUsdt || isUsdc) {
        const rawValue = BigInt(tx.value || 0);
        const amount = Number(rawValue) / (10 ** decimals);

        if (amount >= minAmount) {
          results.push({
            from: tx.from,
            to: tx.to,
            amount: Math.round(amount * 100) / 100,
            token: isUsdt ? 'USDT (ERC-20)' : 'USDC (ERC-20)',
            txHash: tx.hash,
            timestamp: Number(tx.timeStamp) * 1000
          });
        }
      }
    }

    return results;
  } catch (err) {
    return [];
  }
}

/**
 * Universal Inflows Feeder: auto-detects TRON or EVM address.
 * @param {string} address
 * @param {number} minAmount
 * @param {number} limit
 * @returns {Promise<Array<{from: string, to: string, amount: number, token: string, txHash: string, timestamp: number}>>}
 */
async function getIncomingTransfers(address, minAmount = 5, limit = 10) {
  if (!address || typeof address !== 'string') return [];
  const cleanAddr = address.trim();

  if (cleanAddr.startsWith('T') && cleanAddr.length === 34) {
    return fetchTronInflows(cleanAddr, minAmount, limit);
  }

  if (cleanAddr.startsWith('0x') && cleanAddr.length === 42) {
    return fetchEvmInflows(cleanAddr, minAmount, limit);
  }

  return [];
}

module.exports = { getIncomingTransfers };
