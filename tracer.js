/**
 * KYT Backward Hop Tracer & Risk Engine
 * Traces transaction history up to 3 hops backward to detect links to frozen scam wallets.
 */

const { checkWallet, askNetworkChoice } = require('./index');
const { getIncomingTransfers } = require('./fetcher');

/**
 * Format a human-readable visual trail from the trace path.
 * @param {Array<{address: string, amount?: number, token?: string, hop?: number}>} path
 * @param {boolean} isFlagged
 * @returns {string[]}
 */
function formatVisualTrail(path, isFlagged = false) {
  if (!path || path.length === 0) return [];

  const trail = [];
  for (let i = 0; i < path.length; i++) {
    const node = path[i];
    const prefix = i === 0 ? '🎯 Target:' : `  └── Hop ${node.hop || i}:`;
    const transferInfo = node.amount ? ` (Inflow: ${node.amount} ${node.token || 'USDT'})` : '';
    const statusTag = (i === path.length - 1 && isFlagged) ? ' 🔴 [FROZEN / SCAM]' : '';

    trail.push(`${prefix} ${node.address}${transferInfo}${statusTag}`);
  }

  return trail;
}

/**
 * Backtrack a wallet address up to 3 hops.
 * @param {string} targetAddress - TRON (T...) or EVM (0x...) address
 * @param {object} options
 * @param {string} options.chain - 'eth', 'bsc', or 'all' (default: 'all')
 * @param {number} options.maxHops - Maximum depth to search (default: 3)
 * @param {number} options.maxBranches - Top senders to inspect per hop (default: 3)
 * @param {number} options.minAmount - Minimum transfer amount in USDT to consider (default: 10)
 * @returns {Promise<object>}
 */
async function traceWallet(targetAddress, options = {}) {
  const maxHops = options.maxHops || 3;
  const maxBranches = options.maxBranches || 3;
  const minAmount = options.minAmount !== undefined ? options.minAmount : 10;
  const chain = options.chain || 'eth';

  if (!targetAddress || typeof targetAddress !== 'string') {
    throw new Error('Target address must be a valid non-empty string');
  }

  const cleanTarget = targetAddress.trim();

  // 1. Direct On-Chain Check (Hop 0)
  console.log(`\n[Hop 0] Inspecting target wallet on-chain: ${cleanTarget}...`);
  const targetCheck = await checkWallet(cleanTarget, chain);
  console.log(`  └─ Result: ${targetCheck.status} | Details: ${targetCheck.details}`);

  if (targetCheck.isScam) {
    console.log(`🚨 TARGET IS DIRECTLY FROZEN! Halting trace.`);
    return {
      target: cleanTarget,
      chain: targetCheck.chain,
      decision: '🔴 REJECT (Target Wallet Directly Frozen)',
      overallRiskScore: 100,
      scamDetected: true,
      scamHop: 0,
      flaggedWallet: cleanTarget,
      reason: targetCheck.details,
      visualTrail: formatVisualTrail([{ address: cleanTarget }], true),
      stats: { hopsScanned: 0, walletsInspected: 1 }
    };
  }

  // 2. BFS Backtracking Queue
  // Queue elements: { address: string, depth: number, path: Array }
  const queue = [{
    address: cleanTarget,
    depth: 0,
    path: [{ address: cleanTarget }]
  }];

  const visited = new Set([cleanTarget.toLowerCase()]);
  const flaggedIncidents = [];
  let walletsInspected = 1;
  let maxHopReached = 0;

  while (queue.length > 0) {
    const current = queue.shift();

    if (current.depth >= maxHops) {
      continue;
    }

    const nextHop = current.depth + 1;
    if (nextHop > maxHopReached) {
      maxHopReached = nextHop;
    }

    // Fetch incoming transfers
    console.log(`\n[Hop ${nextHop}] Backtracking inflows for: ${current.address}...`);
    let inflows;
    try {
      inflows = await getIncomingTransfers(current.address, minAmount, 10, chain);
    } catch (err) {
      throw new Error(`Inflows retrieval failed for wallet ${current.address} at Hop ${nextHop}: ${err.message}`);
    }
    // Sort by largest incoming amount
    const topInflows = inflows
      .sort((a, b) => b.amount - a.amount)
      .slice(0, maxBranches);

    if (topInflows.length === 0) {
      console.log(`  └─ No incoming transfers >= ${minAmount} USDT found. End of branch.`);
      continue;
    }

    console.log(`  └─ Found ${topInflows.length} top incoming sender(s) to inspect on-chain:`);

    for (const inflow of topInflows) {
      const sender = inflow.from;
      const lookupKey = sender.toLowerCase();

      if (visited.has(lookupKey)) {
        console.log(`  └─ [Hop ${nextHop}] Skipping already visited wallet: ${sender}`);
        continue;
      }
      visited.add(lookupKey);
      walletsInspected++;

      const stepNode = {
        address: sender,
        amount: inflow.amount,
        token: inflow.token,
        hop: nextHop,
        txHash: inflow.txHash
      };
      const currentPath = [...current.path, stepNode];

      // Check sender on-chain status
      process.stdout.write(`  └─ [Hop ${nextHop}] Checking ${sender} (${inflow.amount} ${inflow.token})... `);
      let senderStatus;
      try {
        senderStatus = await checkWallet(sender, chain);
      } catch (err) {
        console.log(`❌ FAILED!`);
        throw new Error(`On-chain verification failed for wallet ${sender} at Hop ${nextHop}: ${err.message}`);
      }

      console.log(`${senderStatus.status}`);

      if (senderStatus.isScam) {
        console.log(`     🚨 SCAM LINK DETECTED at Hop ${nextHop}! Reason: ${senderStatus.details}`);
        flaggedIncidents.push({
          hop: nextHop,
          flaggedAddress: sender,
          reason: senderStatus.details,
          path: currentPath
        });
        // Stop expanding this branch
        break;
      }

      // If clean and haven't hit max depth, enqueue for next hop
      if (nextHop < maxHops) {
        queue.push({
          address: sender,
          depth: nextHop,
          path: currentPath
        });
      }
    }

    // If an incident was caught at Hop 1, we can terminate early
    if (flaggedIncidents.some(inc => inc.hop === 1)) {
      break;
    }
  }

  // 4. Compute Final Decision & Risk Score
  if (flaggedIncidents.length > 0) {
    // Pick the closest incident (lowest hop number)
    flaggedIncidents.sort((a, b) => a.hop - b.hop);
    const closest = flaggedIncidents[0];

    let decision;
    let score;

    if (closest.hop === 1) {
      score = 100;
      decision = '🔴 REJECT (Direct Scam Contact - Hop 1)';
    } else if (closest.hop === 2) {
      score = 65;
      decision = '🟡 REVIEW (Indirect Scam Link - Hop 2 / 1 Middleman)';
    } else {
      score = 35;
      decision = '🟡 LOW RISK (Indirect Scam Link - Hop 3 / 2 Middlemen)';
    }

    return {
      target: cleanTarget,
      chain: targetCheck.chain,
      decision,
      overallRiskScore: score,
      scamDetected: true,
      scamHop: closest.hop,
      flaggedWallet: closest.flaggedAddress,
      reason: `Funds linked to on-chain frozen wallet at Hop ${closest.hop}: ${closest.reason}`,
      visualTrail: formatVisualTrail(closest.path, true),
      stats: {
        hopsScanned: maxHopReached,
        walletsInspected
      }
    };
  }

  // 5. Clean Result
  return {
    target: cleanTarget,
    chain: targetCheck.chain,
    decision: '🟢 ACCEPT (Clean History)',
    overallRiskScore: 0,
    scamDetected: false,
    scamHop: null,
    flaggedWallet: null,
    reason: `No links to frozen or blacklisted wallets found across ${maxHopReached || 1} hops`,
    visualTrail: formatVisualTrail([{ address: cleanTarget }]),
    stats: {
      hopsScanned: maxHopReached,
      walletsInspected
    }
  };
}

// ==========================================
// CLI Execution: node tracer.js <ADDRESS>
// ==========================================
if (require.main === module) {
  const target = process.argv[2];
  let chainArg = null;
  let hopsArg = 3;

  if (process.argv[3]) {
    const val = process.argv[3].toLowerCase();
    if (val === 'eth' || val === 'bsc' || val === 'all' || val === 'ethereum') {
      chainArg = val;
      if (process.argv[4]) hopsArg = parseInt(process.argv[4], 10) || 3;
    } else if (!isNaN(parseInt(val, 10))) {
      hopsArg = parseInt(val, 10);
    }
  }

  if (!target) {
    console.log('--- KYT 3-Hop Backward Tracer ---');
    console.log('Usage: node tracer.js <WALLET_ADDRESS> [eth|bsc|all] [MAX_HOPS]');
    console.log('\nExamples:');
    console.log('  node tracer.js 0x497c4860a269a717f20dcea8d9664018ccd49605        (Interactive prompt)');
    console.log('  node tracer.js 0x497c4860a269a717f20dcea8d9664018ccd49605 bsc 3  (Explicit BSC, 3 hops)');
    console.log('  node tracer.js TCGE3xp6YGRKXxDZiLfysgJW3f22KfMNsW 3              (TRON, 3 hops)');
    process.exit(0);
  }

  (async () => {
    try {
      if (target.startsWith('0x') && !chainArg && process.stdin.isTTY) {
        chainArg = await askNetworkChoice();
      }
      console.log(`\n🔍 Tracing ${target} (Network: ${chainArg ? chainArg.toUpperCase() : 'Auto'}, Depth: ${hopsArg} hops)...\n`);
      const report = await traceWallet(target, { chain: chainArg, maxHops: hopsArg });
      console.log(JSON.stringify(report, null, 2));

      console.log('\n📜 Flow Trail:');
      for (const line of report.visualTrail) {
        console.log(line);
      }
    } catch (err) {
      console.error('❌ Tracer error:', err.message);
      process.exit(1);
    }
  })();
}

module.exports = { traceWallet };
