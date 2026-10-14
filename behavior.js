/**
 * Behavioral Laundering & Transit Mule Detection Engine
 * Detects high-velocity pass-through wallets and laundering relays
 * BEFORE Tether or law enforcement blacklist catches up (zero-latency detection).
 */

const { getKnownEntity } = require('./entities');

const BEHAVIOR_CONFIG = {
  MIN_AMOUNT_USDT: 50,          // Ignore micro-dust/gas tests
  ULTRA_RAPID_MINS: 15,         // <= 15 mins: Automated bot / rapid layering
  RAPID_MINS: 60,               // <= 60 mins: High-velocity transit mule
  SUSPICIOUS_MINS: 180,         // <= 3 hours: Suspicious churn window
  MIN_PASS_THROUGH_RATIO: 0.80, // Forwarded at least 80% of received funds
  MAX_PASS_THROUGH_RATIO: 1.25  // Up to 125% (accounting for gas/small consolidation)
};

/**
 * Detect pass-through transit cycles in a wallet's transaction history.
 * A pass-through cycle occurs when an Inflow of >= 50 USDT is followed
 * by an Outflow of comparable size (80%-125%) within a short time window.
 *
 * @param {Array<{type: 'INFLOW'|'OUTFLOW', amount: number, timestamp: number, from: string, to: string, txHash?: string}>} transfers
 * @param {string} walletAddress
 * @returns {object}
 */
function detectTransitMuleCycles(transfers, walletAddress) {
  if (!transfers || !Array.isArray(transfers) || transfers.length < 2) {
    return { isMule: false, cycles: [], summary: null };
  }

  // Exempt verified institutional exchanges and treasuries
  const entity = getKnownEntity(walletAddress);
  if (entity) {
    return {
      isMule: false,
      exempt: true,
      entity: entity.name,
      cycles: [],
      summary: `Exempt institutional entity: ${entity.name}`
    };
  }

  // Sort chronological (oldest to newest)
  const sorted = [...transfers]
    .filter(t => t.timestamp && t.amount >= BEHAVIOR_CONFIG.MIN_AMOUNT_USDT)
    .sort((a, b) => a.timestamp - b.timestamp);

  const cycles = [];
  const usedOutflows = new Set();

  for (let i = 0; i < sorted.length; i++) {
    const inTx = sorted[i];
    if (inTx.type !== 'INFLOW') continue;

    for (let j = i + 1; j < sorted.length; j++) {
      const outTx = sorted[j];
      if (outTx.type !== 'OUTFLOW' || usedOutflows.has(j)) continue;

      const churnMs = outTx.timestamp - inTx.timestamp;
      if (churnMs < 0) continue;

      const churnMinutes = churnMs / (60 * 1000);
      if (churnMinutes > BEHAVIOR_CONFIG.RAPID_MINS) {
        // Exceeded 60-minute window for this inflow
        break;
      }

      const ratio = outTx.amount / inTx.amount;
      if (ratio >= BEHAVIOR_CONFIG.MIN_PASS_THROUGH_RATIO && ratio <= BEHAVIOR_CONFIG.MAX_PASS_THROUGH_RATIO) {
        usedOutflows.add(j);
        cycles.push({
          inflowAmount: inTx.amount,
          outflowAmount: outTx.amount,
          churnMinutes: Math.round(churnMinutes * 10) / 10,
          passThroughRatio: Math.round(ratio * 100),
          inflowFrom: inTx.from,
          outflowTo: outTx.to,
          inflowTime: inTx.timestamp,
          outflowTime: outTx.timestamp,
          isUltraRapid: churnMinutes <= BEHAVIOR_CONFIG.ULTRA_RAPID_MINS
        });
        break; // Match found for this inflow, advance to next inflow
      }
    }
  }

  if (cycles.length === 0) {
    return { isMule: false, cycles: [], summary: null };
  }

  const avgChurn = Math.round((cycles.reduce((acc, c) => acc + c.churnMinutes, 0) / cycles.length) * 10) / 10;
  const totalVolume = cycles.reduce((acc, c) => acc + c.outflowAmount, 0);
  const hasUltraRapid = cycles.some(c => c.isUltraRapid);

  let severity = 'HIGH';
  let riskScore = 75;
  let status = '🟡 REVIEW (Rapid Transit Mule Detected)';

  if (cycles.length >= 2 || (hasUltraRapid && avgChurn <= 10)) {
    severity = 'CRITICAL';
    riskScore = 85;
    status = '🔴 BLOCKED (High-Velocity Laundering Mule - Proactive Behavioral Block)';
  }

  const summary = `${cycles.length} rapid pass-through cycle(s) detected. Total: ${totalVolume.toLocaleString()} USDT | Avg churn: ${avgChurn} mins`;

  return {
    isMule: true,
    severity,
    riskScore,
    status,
    cyclesCount: cycles.length,
    avgChurnMinutes: avgChurn,
    totalVolume,
    hasUltraRapid,
    cycles,
    summary
  };
}

/**
 * Analyze backward trace path for intermediate rapid pass-through mules.
 * Checks each intermediate hop H_i:
 *  - Received funds from H_(i+1) at timestamp T_in, amount A_in
 *  - Sent funds to H_(i-1) at timestamp T_out, amount A_out
 *  - If (T_out - T_in) <= 60 mins and ratio >= 80%: H_i is a transit mule!
 *
 * @param {Array<{address: string, amount?: number, hop?: number, timestamp?: number, entity?: string}>} path
 * @returns {Array<object>} List of detected mule incidents along the trail
 */
function analyzePathVelocity(path) {
  if (!path || !Array.isArray(path) || path.length < 3) {
    // Need at least Target (Hop 0), Hop 1, and Hop 2 to calculate transit time for Hop 1
    return [];
  }

  const incidents = [];

  // Intermediate hops are from index 1 to path.length - 2
  for (let i = 1; i < path.length - 1; i++) {
    const middleHop = path[i];
    const prevNode = path[i - 1]; // Received funds FROM middleHop (T_out)
    const nextNode = path[i + 1]; // Sent funds TO middleHop (T_in)

    // Exempt institutional entities
    if (middleHop.entity || getKnownEntity(middleHop.address)) {
      continue;
    }

    const tOut = prevNode.timestamp || middleHop.timestamp;
    const tIn = nextNode.timestamp;
    const aOut = prevNode.amount || middleHop.amount;
    const aIn = nextNode.amount;

    if (!tOut || !tIn || !aOut || !aIn) continue;
    if (aIn < BEHAVIOR_CONFIG.MIN_AMOUNT_USDT) continue;

    const churnMs = tOut - tIn;
    // tOut must be after or same block as tIn
    if (churnMs < 0) continue;

    const churnMinutes = churnMs / (60 * 1000);
    const ratio = aOut / aIn;

    if (churnMinutes <= BEHAVIOR_CONFIG.RAPID_MINS && ratio >= BEHAVIOR_CONFIG.MIN_PASS_THROUGH_RATIO && ratio <= BEHAVIOR_CONFIG.MAX_PASS_THROUGH_RATIO) {
      const isUltra = churnMinutes <= BEHAVIOR_CONFIG.ULTRA_RAPID_MINS;
      incidents.push({
        hop: middleHop.hop || i,
        address: middleHop.address,
        churnMinutes: Math.round(churnMinutes * 10) / 10,
        passThroughRatio: Math.round(ratio * 100),
        inAmount: aIn,
        outAmount: aOut,
        isUltraRapid: isUltra,
        riskScore: isUltra ? 85 : 75,
        tag: `⚡ [MULE: ${Math.round(churnMinutes * 10) / 10}m churn / ${Math.round(ratio * 100)}% forwarded]`,
        description: `Hop ${middleHop.hop || i} forwarded ${aOut} USDT (${Math.round(ratio * 100)}%) in ${Math.round(churnMinutes * 10) / 10} mins after receiving`
      });
    }
  }

  return incidents;
}

module.exports = {
  BEHAVIOR_CONFIG,
  detectTransitMuleCycles,
  analyzePathVelocity
};
