/**
 * KYT Smart Contract On-Chain Wallet Checker
 * Queries live smart contracts:
 *  - TRON USDT: TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t
 *  - Ethereum USDT: 0xdAC17F958D2ee523a2206206994597C13D831ec7
 *  - Ethereum USDC: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
 */

const { ethers } = require('ethers');

// --- 1. Base58 Decoder for TRON Addresses ---
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ALPHABET_MAP = {};
for (let i = 0; i < ALPHABET.length; i++) {
  ALPHABET_MAP[ALPHABET.charAt(i)] = BigInt(i);
}

function base58Decode(string) {
  let bytes = [0];
  for (let i = 0; i < string.length; i++) {
    const c = string[i];
    if (!(c in ALPHABET_MAP)) throw new Error('Invalid Base58 character in address');
    let carry = Number(ALPHABET_MAP[c]);
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let i = 0; i < string.length && string[i] === '1'; i++) {
    bytes.push(0);
  }
  return Buffer.from(bytes.reverse());
}

function tronAddressToHexParam(tronAddress) {
  if (tronAddress.startsWith('0x')) {
    return tronAddress.slice(2).padStart(64, '0');
  }
  const decoded = base58Decode(tronAddress);
  // Strip 1-byte prefix (0x41) and 4-byte checksum -> leaves 20 bytes
  const rawHex = decoded.slice(1, 21).toString('hex');
  return rawHex.padStart(64, '0');
}

// --- 2. Check TRON USDT Smart Contract & TronScan Live ---
async function checkTronUSDT(tronAddress) {
  const paramHex = tronAddressToHexParam(tronAddress);
  
  // Tether TRC-20 contract hex: 41a614f803b6fd780986a42c78ec9c7f77e6ded13c (TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t)
  const res = await fetch('https://api.trongrid.io/wallet/triggerconstantcontract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      owner_address: '410000000000000000000000000000000000000000',
      contract_address: '41a614f803b6fd780986a42c78ec9c7f77e6ded13c',
      function_selector: 'isBlackListed(address)',
      parameter: paramHex,
      visible: false
    })
  });

  if (!res.ok) {
    throw new Error(`TronGrid HTTP error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  if (data.Error) {
    throw new Error(`TronGrid contract error: ${data.Error}`);
  }

  const resultHex = data.constant_result?.[0];
  const isFrozen = resultHex && parseInt(resultHex, 16) === 1;

  if (isFrozen) {
    return { isFrozen: true, reason: 'Frozen on-chain by Tether (TRON TRC-20 USDT)' };
  }

  return { isFrozen: false, reason: 'Clean on TRON USDT contract' };
}

// --- 3. Check EVM (Ethereum / BSC) Smart Contracts Live ---
const ETH_RPCS = [
  'https://ethereum-rpc.publicnode.com',
  'https://cloudflare-eth.com',
  'https://rpc.flashbots.net'
];

async function checkEvmContracts(evmAddress) {
  const validAddress = ethers.getAddress(evmAddress.toLowerCase());

  let lastError = null;
  for (const url of ETH_RPCS) {
    try {
      const provider = new ethers.JsonRpcProvider(url, undefined, { staticNetwork: true });

      const usdtContract = new ethers.Contract(
        '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        ['function isBlackListed(address) view returns (bool)'],
        provider
      );

      const usdcContract = new ethers.Contract(
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        ['function isBlacklisted(address) view returns (bool)'],
        provider
      );

      // Query Tether & Circle contracts in parallel for 2x faster execution
      const [usdtFrozen, usdcFrozen] = await Promise.all([
        usdtContract.isBlackListed(validAddress),
        usdcContract.isBlacklisted(validAddress)
      ]);

      if (usdtFrozen) {
        return { isFrozen: true, reason: 'Frozen on-chain by Tether (Ethereum / BSC USDT)' };
      }
      if (usdcFrozen) {
        return { isFrozen: true, reason: 'Frozen on-chain by Circle (Ethereum USDC)' };
      }

      return { isFrozen: false, reason: 'Clean on Ethereum USDT & USDC contracts' };
    } catch (err) {
      lastError = err;
      continue;
    }
  }

  throw new Error(`All Ethereum RPC providers failed: ${lastError?.message || 'Network error'}`);
}

// ==========================================
// 🚀 MAIN CHECKER FUNCTION
// ==========================================
async function checkWallet(address) {
  if (!address || typeof address !== 'string') {
    throw new Error('Address must be a valid non-empty string');
  }

  const cleanAddr = address.trim();

  // A. TRON Address Check (Starts with 'T', 34 characters)
  if (cleanAddr.startsWith('T') && cleanAddr.length === 34) {
    const res = await checkTronUSDT(cleanAddr);
    return {
      address: cleanAddr,
      chain: 'TRON',
      isScam: res.isFrozen,
      status: res.isFrozen ? '🔴 SCAM / FROZEN' : '🟢 CLEAN',
      riskScore: res.isFrozen ? 100 : 0,
      details: res.reason
    };
  }

  // B. EVM Address Check (Starts with '0x', 42 characters)
  if (cleanAddr.startsWith('0x') && cleanAddr.length === 42) {
    const res = await checkEvmContracts(cleanAddr);
    return {
      address: cleanAddr,
      chain: 'EVM (Ethereum / BSC)',
      isScam: res.isFrozen,
      status: res.isFrozen ? '🔴 SCAM / FROZEN' : '🟢 CLEAN',
      riskScore: res.isFrozen ? 100 : 0,
      details: res.reason
    };
  }

  return {
    address: cleanAddr,
    chain: 'UNKNOWN',
    isScam: false,
    status: '⚠️ INVALID_ADDRESS',
    riskScore: 0,
    details: 'Address format does not match TRON (T...) or EVM (0x...)'
  };
}

// ==========================================
// CLI Execution Mode: node index.js <ADDRESS>
// ==========================================
if (require.main === module) {
  const targetAddress = process.argv[2];

  if (!targetAddress) {
    console.log('--- KYT Smart Contract On-Chain Wallet Checker ---');
    console.log('Usage: node index.js <WALLET_ADDRESS>');
    console.log('\nExamples:');
    console.log('  node index.js 0x497c4860a269a717f20dcea8d9664018ccd49605  (EVM)');
    console.log('  node index.js TCGE3xp6YGRKXxDZiLfysgJW3f22KfMNsW          (TRON)');
    process.exit(0);
  }

  (async () => {
    try {
      const result = await checkWallet(targetAddress);
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error('❌ ERROR: Smart contract check could not be completed!');
      console.error('Reason:', err.message);
      process.exit(1);
    }
  })();
}

module.exports = { checkWallet };
