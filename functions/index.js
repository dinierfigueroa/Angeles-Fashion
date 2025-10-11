/* functions/index.js */
const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();

/* =========================
 * CONFIGURACIÓN / CONSTANTES
 * ========================= */
const SCORE_AUTO_SINGLE = 70;   // umbral para 1↔1
const SCORE_AUTO_MULTI  = 85;   // umbral promedio para 1↔N
const DATE_TOL_DAYS     = 1;    // ±1 día
const MAX_CANDIDATES    = 10;

/* Estados (ES) y compatibilidad con antiguos */
const ES = {
  DISPONIBLE: "disponible",
  RESERVADO: "reservado",
  PARCIAL: "parcial",
  LIQUIDADO: "liquidado",
  AUTO_LIQ: "auto_liquidado",
  DEVUELTO: "devuelto",
  PENDIENTE: "pendiente",
  PENDING_REVIEW: "pending_review",
};
const OLD = {
  UNMATCHED: "unmatched",
  PARTIAL: "partial",
  RESERVED: "reserved",
  AUTO_SETTLED: "auto_settled",
};

/* =========================
 * UTILIDADES
 * ========================= */
const strip = (s) => (s || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // quitar tildes
  .replace(/\./g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .toUpperCase();

const BANK_MAP = new Map([
  // BAC
  ["BAC", "BAC"], ["BAC CREDOMATIC", "BAC"], ["DEP B BAC", "BAC"], ["DEPOSITO BAC", "BAC"],
  // FICOHSA
  ["FICOHSA", "FICOHSA"], ["DEP B FICOHSA", "FICOHSA"],
  // ATLANTIDA
  ["ATLANTIDA", "ATLANTIDA"], ["B ATLANTIDA", "ATLANTIDA"],
  // BANPAIS
  ["BANPAIS", "BANPAIS"], ["B BANPAIS", "BANPAIS"],
  // OCCIDENTE
  ["OCCIDENTE", "OCCIDENTE"], ["B OCCIDENTE", "OCCIDENTE"],
]);

function normalizeBankKey(raw) {
  const s = strip((raw || "")
    .replace(/^DEP(\.|OSITO)?\s*B\s*/i, "")
    .replace(/^DEP(\.|OSITO)?\s*/i, "")
    .replace(/^B\s*/i, ""));
  if (BANK_MAP.has(s)) return BANK_MAP.get(s);
  if (s.includes("CREDOMATIC")) return "BAC";
  if (s.includes("FICO")) return "FICOHSA";
  if (s.includes("ATLANT")) return "ATLANTIDA";
  if (s.includes("PAIS")) return "BANPAIS";
  if (s.includes("OCCIDENT")) return "OCCIDENTE";
  return s || "DESCONOCIDO";
}

function daysDiff(a, b) {
  if (!a || !b) return 9999;
  const da = (a instanceof admin.firestore.Timestamp) ? a.toDate() : new Date(a);
  const dbb = (b instanceof admin.firestore.Timestamp) ? b.toDate() : new Date(b);
  return Math.floor(Math.abs(da - dbb) / (1000 * 60 * 60 * 24));
}

function num(n) { return typeof n === "number" ? n : Number(n || 0); }

function similar(a, b) {
  const A = strip(a), B = strip(b);
  if (!A || !B) return false;
  return A === B;
}

function addHistoryEntry(list, details) {
  list.push({
    action: details.action || "auto_match",
    details: details.details || "",
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    user: null,            // SYSTEM
    userName: "SYSTEM"
  });
}

function isDepositAvailableStatus(s) {
  const v = String(s || "").toLowerCase();
  return (
    v === ES.DISPONIBLE || v === ES.RESERVADO || v === ES.PARCIAL ||
    v === OLD.UNMATCHED || v === OLD.RESERVED || v === OLD.PARTIAL || v === ""
  );
}

function isSalePendingStatus(s) {
  const v = String(s || "").toLowerCase();
  return (v === ES.PENDIENTE || v === ES.PENDING_REVIEW || v === "" || v === "unmatched");
}

/* =========================
 * SCORING
 * ========================= */
function scoreDepositVsSale(dep, sale) {
  let score = 0;

  // Banco
  const saleBank = sale.bankKey || normalizeBankKey(sale.paymentGateway);
  const depBank  = dep.bankKey  || normalizeBankKey(dep.bank);
  if (saleBank && depBank && saleBank === depBank) score += 40;
  else if (saleBank && depBank && strip(dep.bank).includes(strip(sale.paymentGateway))) score += 20;

  // Fecha
  const d = daysDiff(sale.saleDate, dep.transactionDate);
  if (d <= DATE_TOL_DAYS) score += 20;
  else if (d <= 3) score += 10;

  // Monto
  const saleAmt = num(sale.grossPayments) - num(sale.matchedTotal || 0);
  const depRemaining = Math.max(0, num(dep.amount) - num(dep.matchedTotal || 0));
  if (Math.abs(depRemaining - saleAmt) < 0.01) score += 25;
  else if (Math.abs(depRemaining - saleAmt) <= 5) score += 15;
  else if (depRemaining > 0 && depRemaining < saleAmt) score += 10; // parcial ayuda

  // Vendedor / Tienda
  if (similar(dep.vendorName, sale.staffMemberName)) score += 15;
  if (similar(dep.storeName, sale.posLocationName || sale.storeName)) score += 15;

  // Reserva
  const depStatus = String(dep.status || "").toLowerCase();
  if (depStatus === ES.RESERVADO || depStatus === OLD.RESERVED) {
    score += 10;
    if (dep.vendorName && sale.staffMemberName && !similar(dep.vendorName, sale.staffMemberName)) score -= 15;
    if (dep.storeName  && (sale.posLocationName || sale.storeName) &&
        !similar(dep.storeName, sale.posLocationName || sale.storeName)) score -= 15;
  }

  if (depRemaining <= 0.01) score -= 30;
  return Math.max(0, score);
}

/* =========================
 * QUERIES DE CANDIDATOS
 * ========================= */
async function candidateDepositsForSale(saleSnap) {
  const sale = saleSnap.data();
  const base = sale.saleDate?.toDate ? sale.saleDate.toDate() : new Date(sale.saleDate);
  const from = admin.firestore.Timestamp.fromDate(new Date(base.getTime() - DATE_TOL_DAYS * 86400000));
  const to   = admin.firestore.Timestamp.fromDate(new Date(base.getTime() + DATE_TOL_DAYS * 86400000));

  const q = await db.collection("deposits")
    .where("transactionDate", ">=", from)
    .where("transactionDate", "<=", to)
    .get();

  const list = [];
  q.forEach(docu => {
    const d = docu.data();
    if (!isDepositAvailableStatus(d.status)) return;
    list.push({ id: docu.id, ref: docu.ref, data: d });
  });
  return list;
}

async function candidateSalesForDeposit(depSnap) {
  const dep = depSnap.data();
  const base = dep.transactionDate?.toDate ? dep.transactionDate.toDate() : new Date(dep.transactionDate);
  const from = admin.firestore.Timestamp.fromDate(new Date(base.getTime() - DATE_TOL_DAYS * 86400000));
  const to   = admin.firestore.Timestamp.fromDate(new Date(base.getTime() + DATE_TOL_DAYS * 86400000));

  const q = await db.collection("shopifySales")
    .where("saleDate", ">=", from)
    .where("saleDate", "<=", to)
    .get();

  const list = [];
  q.forEach(docu => {
    const s = docu.data();
    const st = s.reconciliationStatus || s.status; // compat
    if (!isSalePendingStatus(st)) return;
    list.push({ id: docu.id, ref: docu.ref, data: s });
  });
  return list;
}

/* =========================
 * GREEDY 1 -> N (venta usa varios depósitos)
 * ========================= */
function pickDepositsGreedyForSale(sale, candidates) {
  const saleAmt = num(sale.grossPayments) - num(sale.matchedTotal || 0);
  let remaining = saleAmt;
  const picks = [];

  for (const c of candidates) {
    if (remaining <= 0.01) break;
    const dep = c.data;
    const depRemaining = Math.max(0, num(dep.amount) - num(dep.matchedTotal || 0));
    if (depRemaining <= 0.01) continue;

    // si reservado y no coincide vendedor/tienda, saltar
    const depStatus = String(dep.status || "").toLowerCase();
    if (depStatus === ES.RESERVADO || depStatus === OLD.RESERVED) {
      if (dep.vendorName && sale.staffMemberName && !similar(dep.vendorName, sale.staffMemberName)) continue;
      if (dep.storeName  && (sale.posLocationName || sale.storeName) &&
          !similar(dep.storeName, sale.posLocationName || sale.storeName)) continue;
    }

    const take = Math.min(depRemaining, remaining);
    picks.push({ cand: c, use: take });
    remaining -= take;
  }

  const usedTotal = saleAmt - remaining;
  const avgScore = picks.length
    ? picks.reduce((a, p) => a + p.cand.score, 0) / picks.length
    : 0;

  return { picks, usedTotal, remaining, avgScore };
}

/* =========================
 * APLICAR CONCILIACIÓN (TRANSACCIÓN)
 * ========================= */
async function applyMatchSaleWithDeposits(saleRef, sale, picks) {
  await db.runTransaction(async (tx) => {
    const freshSaleDoc = await tx.get(saleRef);
    const freshSale = freshSaleDoc.data() || {};

    const saleTotal = num(freshSale.grossPayments);
    let   currentMatched = num(freshSale.matchedTotal || 0);
    let   remaining = saleTotal - currentMatched;

    const matchedRefs = freshSale.matchedDepositRef || [];

    for (const p of picks) {
      if (remaining <= 0.01) break;

      const depRef = p.cand.ref;
      const depDoc = await tx.get(depRef);
      if (!depDoc.exists) continue;
      const dep = depDoc.data() || {};

      const depTotal   = num(dep.amount);
      const depMatched = num(dep.matchedTotal || 0);
      const depRem     = Math.max(0, depTotal - depMatched);
      const use        = Math.min(p.use, depRem, remaining);
      if (use <= 0.01) continue;

      // actualizar DEPÓSITO
      const newDepMatched = depMatched + use;
      const newDepRem     = Math.max(0, depTotal - newDepMatched);
      const depHistory    = dep.history || [];
      addHistoryEntry(depHistory, {
        action: "auto_match",
        details: `SYSTEM conciliado L${use.toFixed(2)} con venta #${freshSale.orderId || ""} (auto)`,
      });

      // Propagar vendedor/tienda desde la venta si el depósito no los tiene
      const vendorId   = dep.vendorId || freshSale.vendorRef || null;
      const vendorName = dep.vendorName || freshSale.staffMemberName || "";
      const storeId    = dep.storeId || freshSale.storeId || null;
      const storeName  = dep.storeName || freshSale.storeName || freshSale.posLocationName || "";

      tx.update(depRef, {
        matchedTotal: newDepMatched,
        remainingAmount: newDepRem,
        status: newDepRem <= 0.01 ? ES.AUTO_LIQ : ES.PARCIAL,
        reconciliationScore: p.cand.score,
        vendorId,
        vendorName,
        storeId,
        storeName,
        saleRef: admin.firestore.FieldValue.arrayUnion(saleRef),
        history: depHistory,
        liquidationDate: newDepRem <= 0.01
          ? admin.firestore.FieldValue.serverTimestamp()
          : (dep.liquidationDate || null),
      });

      matchedRefs.push(depRef);
      remaining -= use;
      currentMatched += use;
    }

    const saleStatusES = remaining <= 0.01 ? ES.AUTO_LIQ
                         : (currentMatched > 0.01 ? ES.PARCIAL : ES.PENDING_REVIEW);

    tx.update(saleRef, {
      matchedDepositRef: matchedRefs,
      matchedTotal: currentMatched,
      remainingAmount: Math.max(0, remaining),
      reconciliationStatus: saleStatusES, // mantener
      status: saleStatusES,               // compatibilidad con UI que lee 'status'
      reconciliationDate: admin.firestore.FieldValue.serverTimestamp(),
      candidateDepositIds: [],
    });
  });
}

/* =========================
 * TRIGGER: CUANDO SE CREA UNA VENTA
 * ========================= */
exports.onShopifySaleCreated = functions.firestore
  .document("shopifySales/{id}")
  .onCreate(async (snap, ctx) => {
    const sale = snap.data();

    // asegurar bankKey / remainingAmount inicial
    const bankKey = sale.bankKey || normalizeBankKey(sale.paymentGateway);
    const initSale = {};
    if (!sale.bankKey) initSale.bankKey = bankKey;
    if (sale.matchedTotal == null) initSale.matchedTotal = 0;
    if (sale.remainingAmount == null) initSale.remainingAmount = num(sale.grossPayments || 0);
    if (!sale.status) initSale.status = ES.PENDIENTE;
    if (Object.keys(initSale).length) await snap.ref.update(initSale);

    // buscar candidatos
    const rawCands = await candidateDepositsForSale(snap);
    let cands = rawCands.map(c => {
      const sc = scoreDepositVsSale(c.data, { ...sale, bankKey });
      return { ...c, score: sc };
    }).sort((a, b) => b.score - a.score);

    // intentar 1↔1
    const best = cands[0];
    const saleAmtRem = num(sale.grossPayments) - num(sale.matchedTotal || 0);
    if (best) {
      const depRemaining = Math.max(0, num(best.data.amount) - num(best.data.matchedTotal || 0));
      if (best.score >= SCORE_AUTO_SINGLE && Math.abs(depRemaining - saleAmtRem) < 0.01) {
        await applyMatchSaleWithDeposits(snap.ref, sale, [{ cand: best, use: saleAmtRem }]);
        return;
      }
    }

    // greedy 1→N
    const greedy = pickDepositsGreedyForSale(sale, cands);
    if (greedy.usedTotal > 0 && greedy.remaining <= 0.01 && greedy.avgScore >= SCORE_AUTO_MULTI) {
      await applyMatchSaleWithDeposits(snap.ref, sale, greedy.picks);
      return;
    }

    // pendiente con candidatos (top N)
    const candidateDepositIds = cands.slice(0, MAX_CANDIDATES).map(c => c.id);
    await snap.ref.update({
      reconciliationStatus: candidateDepositIds.length ? ES.PENDING_REVIEW : ES.PENDIENTE,
      status: candidateDepositIds.length ? ES.PENDING_REVIEW : ES.PENDIENTE,
      candidateDepositIds
    });
  });

/* =========================
 * TRIGGER: CUANDO SE CREA UN DEPÓSITO
 * ========================= */
exports.onDepositCreated = functions.firestore
  .document("deposits/{id}")
  .onCreate(async (snap, ctx) => {
    const dep = snap.data();

    // asegurar bankKey / remainingAmount inicial
    const bankKey = dep.bankKey || normalizeBankKey(dep.bank);
    const initDep = {};
    if (!dep.bankKey) initDep.bankKey = bankKey;
    if (dep.matchedTotal == null) initDep.matchedTotal = 0;
    if (dep.remainingAmount == null) initDep.remainingAmount = Math.max(0, num(dep.amount || 0));
    if (!dep.status) initDep.status = ES.DISPONIBLE; // depósitos "libres"
    if (Object.keys(initDep).length) await snap.ref.update(initDep);

    // buscar ventas candidatas
    const rawSales = await candidateSalesForDeposit(snap);
    let cands = rawSales.map(s => {
      const sc = scoreDepositVsSale(dep, { ...s.data, bankKey });
      return { id: s.id, ref: s.ref, data: s.data, score: sc };
    }).sort((a, b) => b.score - a.score);

    const best = cands[0];
    const depRemaining = Math.max(0, num(dep.amount) - num(dep.matchedTotal || 0));

    // 1 depósito → 1 venta
    if (best) {
      const saleRem = Math.max(0, num(best.data.grossPayments) - num(best.data.matchedTotal || 0));
      if (best.score >= SCORE_AUTO_SINGLE && Math.abs(depRemaining - saleRem) < 0.01) {
        await applyMatchSaleWithDeposits(best.ref, best.data, [
          { cand: { ref: snap.ref, data: dep, score: best.score }, use: saleRem }
        ]);
        return;
      }
    }

    // Parcialmente cubrir una venta si aporta mucho
    if (best && best.score >= SCORE_AUTO_SINGLE && depRemaining > 0) {
      const saleRem = Math.max(0, num(best.data.grossPayments) - num(best.data.matchedTotal || 0));
      const use = Math.min(depRemaining, saleRem);
      if (use > 0.01) {
        await applyMatchSaleWithDeposits(best.ref, best.data, [
          { cand: { ref: snap.ref, data: dep, score: best.score }, use }
        ]);
        return;
      }
    }

    // Si no se pudo auto-conciliar, dejar depósito DISPONIBLE y anotar candidatos
    const top = cands.slice(0, MAX_CANDIDATES);
    await snap.ref.update({
      // mantenemos 'disponible' (no 'pending_review')
      candidateSaleIds: top.map(t => t.id)
    });

    // A cada venta candidata, si estaba pendiente, anotar candidatos para tu UI
    const batch = db.batch();
    for (const t of top) {
      const st = (t.data.reconciliationStatus || t.data.status || "").toLowerCase();
      if (isSalePendingStatus(st)) {
        batch.update(t.ref, {
          reconciliationStatus: ES.PENDING_REVIEW,
          status: ES.PENDING_REVIEW,
          candidateDepositIds: admin.firestore.FieldValue.arrayUnion(snap.id)
        });
      }
    }
    await batch.commit();
  });

/* =========================
 * HTTPS callable (manual) — SI AÚN LO USAS DESDE EL CLIENTE
 * ========================= */

// Conciliar venta con 1..N depósitos (manual desde UI). Mantengo por compatibilidad.
exports.manualSettleSale = functions.https.onCall(async (data, ctx) => {
  const { saleId, picks } = data; // picks = [{depositId, useAmount}, ...]
  if (!saleId || !Array.isArray(picks) || !picks.length) {
    throw new functions.https.HttpsError('invalid-argument','Bad args');
  }
  const saleRef = db.collection('shopifySales').doc(saleId);

  await db.runTransaction(async (tx) => {
    const sDoc = await tx.get(saleRef);
    if (!sDoc.exists) throw new functions.https.HttpsError('not-found','sale not found');
    const sale = sDoc.data();

    const saleAmt = num(sale.grossPayments);
    let matched  = num(sale.matchedTotal || 0);
    let remaining = saleAmt - matched;
    const matchedRefs = sale.matchedDepositRef || [];

    for (const p of picks) {
      const depRef = db.collection('deposits').doc(p.depositId);
      const dDoc = await tx.get(depRef); if (!dDoc.exists) continue;
      const dep = dDoc.data();

      const depRem = Math.max(0, num(dep.amount) - num(dep.matchedTotal || 0));
      const use = Math.min(num(p.useAmount || 0), depRem, remaining);
      if (use <= 0.01) continue;

      // Propagar vendedor/tienda desde la venta si el depósito no los tiene
      const vendorId   = dep.vendorId || sale.vendorRef || null;
      const vendorName = dep.vendorName || sale.staffMemberName || "";
      const storeId    = dep.storeId || sale.storeId || null;
      const storeName  = dep.storeName || sale.storeName || sale.posLocationName || "";

      tx.update(depRef, {
        matchedTotal: num(dep.matchedTotal || 0) + use,
        remainingAmount: Math.max(0, depRem - use),
        status: (depRem - use) <= 0.01 ? ES.AUTO_LIQ : ES.PARCIAL,
        vendorId,
        vendorName,
        storeId,
        storeName,
        saleRef: admin.firestore.FieldValue.arrayUnion(saleRef),
        history: admin.firestore.FieldValue.arrayUnion({
          action:'manual_match',
          details:`MANUAL L${use.toFixed(2)} con venta #${sale.orderId || ''}`,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          user:null, userName:'SYSTEM'
        }),
        liquidationDate: (depRem - use) <= 0.01
          ? admin.firestore.FieldValue.serverTimestamp()
          : (dep.liquidationDate || null),
      });

      matchedRefs.push(depRef);
      remaining -= use;
      matched   += use;
    }

    const saleStatusES = remaining <= 0.01 ? ES.AUTO_LIQ
                         : (matched > 0.01 ? ES.PARCIAL : ES.PENDING_REVIEW);

    tx.update(saleRef, {
      matchedDepositRef: matchedRefs,
      matchedTotal: matched,
      remainingAmount: Math.max(0, remaining),
      reconciliationStatus: saleStatusES,
      status: saleStatusES,
      reconciliationDate: admin.firestore.FieldValue.serverTimestamp(),
      candidateDepositIds: []
    });
  });
  return { ok:true };
});

// Descartar candidato: solo quita id del arreglo
exports.discardCandidate = functions.https.onCall(async (data, ctx) => {
  const { saleId, depositId } = data;
  if (!saleId || !depositId) throw new functions.https.HttpsError('invalid-argument','Bad args');
  await db.collection('shopifySales').doc(saleId).update({
    candidateDepositIds: admin.firestore.FieldValue.arrayRemove(depositId)
  });
  return { ok:true };
});