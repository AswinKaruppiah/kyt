/**
 * KYT Backward Hop Tracer & Risk Engine
 * Traces transaction history up to 3 hops backward to detect links to frozen scam wallets.
 */

const { checkWallet, askNetworkChoice } = require('./index');
const { getIncomingTransfers } = require('./fetcher');
const { getKnownEntity } = require('./entities');
const { analyzePathVelocity } = require('./behavior');

/**
 * Format a human-readable visual trail from the trace path.
 * @param {Array<{address: string, amount?: number, token?: string, hop?: number, muleTag?: string, entity?: string}>} path
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
    const entityTag = node.entity ? ` 🏦 [${node.entity}]` : '';
    const muleTag = node.muleTag ? ` ${node.muleTag}` : '';
    const statusTag = (i === path.length - 1 && isFlagged) ? ' 🔴 [FROZEN / SCAM]' : '';

    trail.push(`${prefix} ${node.address}${transferInfo}${entityTag}${muleTag}${statusTag}`);
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

  // 1. Direct On-Chain & Behavioral Check (Hop 0)
  console.log(`\n[Hop 0] Inspecting target wallet on-chain: ${cleanTarget}...`);
  const targetCheck = await checkWallet(cleanTarget, chain, { checkBehavior: true });
  console.log(`  └─ Result: ${targetCheck.status} | Details: ${targetCheck.details}`);

  if (targetCheck.status === '⚠️ INVALID_ADDRESS') {
    console.log(`⚠️ Invalid address format. Halting trace.`);
    return {
      target: cleanTarget,
      chain: targetCheck.chain,
      decision: '⚠️ REJECT (Invalid Address Format)',
      overallRiskScore: 0,
      scamDetected: false,
      scamHop: null,
      flaggedWallet: null,
      reason: targetCheck.details,
      visualTrail: [`🎯 Target: ${cleanTarget} ⚠️ [INVALID ADDRESS]`],
      stats: { hopsScanned: 0, walletsInspected: 0 }
    };
  }

  if (targetCheck.isScam) {
    const isFrozen = targetCheck.riskScore === 100;
    const decisionLabel = isFrozen
      ? '🔴 REJECT (Target Wallet Directly Frozen)'
      : '🔴 BLOCKED (Target Wallet High-Velocity Laundering Mule)';
    console.log(`🚨 TARGET FLAGGED! Halting trace.`);
    return {
      target: cleanTarget,
      chain: targetCheck.chain,
      decision: decisionLabel,
      overallRiskScore: targetCheck.riskScore,
      scamDetected: true,
      scamHop: 0,
      flaggedWallet: cleanTarget,
      reason: targetCheck.details,
      behavior: targetCheck.behavior || null,
      visualTrail: formatVisualTrail([{ address: cleanTarget }], true),
      stats: { hopsScanned: 0, walletsInspected: 1 }
    };
  }

  // 1b. Check if Target is a Known Institutional Entity (CEX / Treasury)
  const targetEntity = getKnownEntity(cleanTarget);
  if (targetEntity) {
    console.log(`🏦 Target is verified ${targetEntity.type}: ${targetEntity.name}. Halting trace.`);
    return {
      target: cleanTarget,
      chain: targetCheck.chain,
      decision: `🟢 ACCEPT (${targetEntity.name})`,
      overallRiskScore: 0,
      scamDetected: false,
      scamHop: null,
      flaggedWallet: null,
      reason: `Target address is verified ${targetEntity.type}: ${targetEntity.name} (Regulated Institutional Entity)`,
      visualTrail: formatVisualTrail([{ address: cleanTarget, entity: targetEntity.name }]),
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
  const behavioralMules = [];
  const cleanTrails = [];
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
        txHash: inflow.txHash,
        timestamp: inflow.timestamp
      };
      const currentPath = [...current.path, stepNode];

      // Check if Sender is a Verified CEX Hot Wallet / Treasury
      const knownEntity = getKnownEntity(sender);
      if (knownEntity) {
        stepNode.entity = knownEntity.name;
        cleanTrails.push(currentPath);
        console.log(`  └─ [Hop ${nextHop}] 🏦 Sender is verified ${knownEntity.type}: ${knownEntity.name} (Safe branch termination)`);
        // Regulated exchange KYC absorbs liability; do not traverse deeper
        continue;
      }

      // Check for rapid transit mule along current path
      const pathMules = analyzePathVelocity(currentPath);
      for (const pm of pathMules) {
        const nodeToTag = currentPath.find(n => n.address.toLowerCase() === pm.address.toLowerCase());
        if (nodeToTag && !nodeToTag.muleTag) {
          nodeToTag.muleTag = pm.tag;
        }
        if (!behavioralMules.some(bm => bm.address.toLowerCase() === pm.address.toLowerCase())) {
          behavioralMules.push({
            hop: pm.hop,
            address: pm.address,
            churnMinutes: pm.churnMinutes,
            passThroughRatio: pm.passThroughRatio,
            riskScore: pm.riskScore,
            isUltraRapid: pm.isUltraRapid,
            reason: pm.description,
            path: currentPath
          });
        }
      }

      // Check sender on-chain status
      process.stdout.write(`  └─ [Hop ${nextHop}] Checking ${sender} (${inflow.amount} ${inflow.token})... `);
      let senderStatus;
      try {
        senderStatus = await checkWallet(sender, chain, { checkBehavior: nextHop <= 2 });
      } catch (err) {
        console.log(`❌ FAILED!`);
        throw new Error(`On-chain verification failed for wallet ${sender} at Hop ${nextHop}: ${err.message}`);
      }

      console.log(`${senderStatus.status}`);

      if (senderStatus.isScam) {
        const isFrozen = senderStatus.riskScore === 100;
        console.log(`     🚨 ${isFrozen ? 'SCAM LINK' : 'MULE'} DETECTED at Hop ${nextHop}! Reason: ${senderStatus.details}`);
        if (isFrozen) {
          flaggedIncidents.push({
            hop: nextHop,
            flaggedAddress: sender,
            reason: senderStatus.details,
            path: currentPath
          });
          // Stop expanding this branch
          break;
        } else {
          // Behavioral mule on sender
          behavioralMules.push({
            hop: nextHop,
            address: sender,
            riskScore: senderStatus.riskScore,
            isUltraRapid: true,
            churnMinutes: senderStatus.behavior?.avgChurnMinutes || 5,
            passThroughRatio: 100,
            reason: senderStatus.details,
            path: currentPath
          });
          stepNode.muleTag = '⚡ [MULE: Rapid Churn]';
        }
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
  // 4a. On-chain frozen takes top priority (Score: 100 on Hop 1, 65 on Hop 2, 35 on Hop 3)
  if (flaggedIncidents.length > 0) {
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

  // 4b. Behavioral Rapid Pass-Through Mule Layering (Caught before Tether freeze)
  if (behavioralMules.length > 0) {
    behavioralMules.sort((a, b) => a.hop - b.hop);
    const closestMule = behavioralMules[0];

    let decision;
    let score;

    if (closestMule.hop === 1) {
      if (closestMule.isUltraRapid || closestMule.riskScore >= 85) {
        score = 85;
        decision = `🔴 BLOCKED (High-Velocity Laundering Mule - Hop 1 / Churned in ${closestMule.churnMinutes}m)`;
      } else {
        score = 75;
        decision = `🟡 REVIEW (Rapid Transit Mule - Hop 1 / Churned in ${closestMule.churnMinutes}m)`;
      }
    } else if (closestMule.hop === 2) {
      score = 60;
      decision = `🟡 REVIEW (Layer 2 Rapid Transit Mule - Hop 2)`;
    } else {
      score = 40;
      decision = `🟡 LOW RISK (Layer 3 Rapid Transit Mule - Hop 3)`;
    }

    return {
      target: cleanTarget,
      chain: targetCheck.chain,
      decision,
      overallRiskScore: score,
      scamDetected: true,
      scamHop: closestMule.hop,
      flaggedWallet: closestMule.address,
      reason: `Rapid pass-through mule layering detected before Tether blacklist: ${closestMule.reason}`,
      visualTrail: formatVisualTrail(closestMule.path, false),
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
    visualTrail: formatVisualTrail(cleanTrails.length > 0 ? cleanTrails[0] : [{ address: cleanTarget }]),
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
