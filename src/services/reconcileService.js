// src/services/reconcileService.js
import { db } from '@/firebase';
import {
  collection, query, where, orderBy, getDocs, doc, runTransaction,
  arrayUnion, arrayRemove, Timestamp
} from 'firebase/firestore';

/* =========================
 * Estados / utilidades
 * ========================= */
export const ES = {
  DISPONIBLE: 'disponible',
  RESERVADO: 'reservado',
  PARCIAL: 'parcial',
  LIQUIDADO: 'liquidado',
  AUTO_LIQ: 'auto_liquidado',
  DEVUELTO: 'devuelto',
  PENDIENTE: 'pendiente',
  PENDING_REVIEW: 'pending_review',
  UNMATCHED: 'unmatched',
};

const FINAL_STATES = [ES.LIQUIDADO, ES.AUTO_LIQ, ES.DEVUELTO];
const isFinal = (s) => FINAL_STATES.includes(String(s || '').toLowerCase());

export const normalizeBankKey = (raw = '') => {
  const s = String(raw || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

  if (s.includes('CREDOMATIC') || s === 'BAC') return 'BAC';
  if (s.includes('FICO')) return 'FICOHSA';
  if (s.includes('ATLANT')) return 'ATLANTIDA';
  if (s.includes('PAIS')) return 'BANPAIS';
  if (s.includes('OCCIDENT')) return 'OCCIDENTE';
  if (s.includes('RURAL')) return 'BANRURAL';
  return s || 'DESCONOCIDO';
};

const toDate   = (v) => (v?.toDate ? v.toDate() : new Date(v));
const dayStart = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const dayEnd   = (d) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };
const round2   = (n) => Number((Number(n || 0)).toFixed(2));
const remaining = (total, matched) => round2(Number(total||0) - Number(matched||0));

/* =========================
 * Candidatos
 * ========================= */
export async function fetchSaleCandidatesForDeposit(dep, { dayWindow = 1, tolerance = 0 } = {}) {
  const depDate = toDate(dep.transactionDate);
  const bankKey = dep.bankKey || normalizeBankKey(dep.bank);
  if (!depDate || isNaN(depDate)) return [];

  const from = dayStart(new Date(depDate.getTime() - dayWindow * 86400000));
  const to   = dayEnd(  new Date(depDate.getTime() + dayWindow * 86400000));

  const qRef = query(
    collection(db, 'shopifySales'),
    where('saleDate', '>=', Timestamp.fromDate(from)),
    where('saleDate', '<=', Timestamp.fromDate(to)),
    orderBy('saleDate', 'desc')
  );

  const snap = await getDocs(qRef);
  const depRem = remaining(dep.amount, dep.matchedTotal);

  const allowed = new Set([ES.UNMATCHED, ES.PENDING_REVIEW, ES.PENDIENTE, 'partial', '', null, undefined]);
  const list = [];

  snap.forEach(s => {
    const x = s.data();
    const sBank = x.bankKey || normalizeBankKey(x.paymentGateway || x.bank);
    if (sBank !== bankKey) return;

    const sDate = toDate(x.saleDate);
    const sRem  = remaining(x.grossPayments, x.matchedTotal);
    if (sRem <= 0.009) return;

    const status = String(x.reconciliationStatus || '').toLowerCase();
    if (!allowed.has(status)) return;

    let score = 0;
    if (dep.status === ES.RESERVADO) {
      if (dep.vendorId?.id && x.vendorRef?.id === dep.vendorId.id) score += 5;
      if (dep.storeId?.id  && x.storeId?.id  === dep.storeId.id)   score += 3;
    }
    const daysDiff = Math.abs(sDate - depDate) / 86400000;
    score += Math.max(0, dayWindow - daysDiff);

    list.push({
      id: s.id,
      orderId: x.orderId,
      saleDate: sDate,
      staffMemberName: x.staffMemberName || '',
      storeName: x.storeName || x.posLocationName || '',
      grossPayments: round2(x.grossPayments),
      matchedTotal: round2(x.matchedTotal),
      remainingAmount: sRem,
      reconciliationStatus: status,
      score
    });
  });

  list.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return Math.abs(depRem - a.remainingAmount) - Math.abs(depRem - b.remainingAmount);
  });
  return list;
}

export async function fetchDepositCandidatesForSale(sale, { dayWindow = 1, tolerance = 0 } = {}) {
  const saleDate = toDate(sale.saleDate);
  const bankKey = sale.bankKey || normalizeBankKey(sale.paymentGateway || sale.bank);
  if (!saleDate || isNaN(saleDate)) return [];

  const from = dayStart(new Date(saleDate.getTime() - dayWindow * 86400000));
  const to   = dayEnd(  new Date(saleDate.getTime() + dayWindow * 86400000));

  const qRef = query(
    collection(db, 'deposits'),
    where('transactionDate', '>=', Timestamp.fromDate(from)),
    where('transactionDate', '<=', Timestamp.fromDate(to)),
    orderBy('transactionDate', 'desc')
  );

  const snap = await getDocs(qRef);
  const target = remaining(sale.grossPayments, sale.matchedTotal);

  const allowed = new Set([ES.DISPONIBLE, ES.PARCIAL, ES.RESERVADO, ES.UNMATCHED, 'partial', 'unmatched', '', null, undefined]);
  const list = [];
  snap.forEach(d => {
    const x = d.data();
    const dBank = x.bankKey || normalizeBankKey(x.bank);
    if (dBank !== bankKey) return;

    const status = String(x.status || '').toLowerCase();
    if (!allowed.has(status)) return;

    const amtRemaining = remaining(x.amount, x.matchedTotal);
    if (amtRemaining <= 0.009) return;

    let score = 0;
    if (status === ES.RESERVADO) {
      if (sale.vendorRef?.id && x.vendorId?.id && sale.vendorRef.id === x.vendorId.id) score += 5;
      if (sale.storeId?.id  && x.storeId?.id  && sale.storeId.id === x.storeId.id)     score += 3;
    }

    const dDate = toDate(x.transactionDate);
    const daysDiff = Math.abs(dDate - saleDate) / 86400000;
    score += Math.max(0, dayWindow - daysDiff);

    list.push({
      id: d.id,
      transactionDate: dDate,
      vendorName: x.vendorName || '',
      storeName: x.storeName || '',
      amount: round2(x.amount),
      matchedTotal: round2(x.matchedTotal),
      remainingAmount: amtRemaining,
      status,
      score
    });
  });

  list.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return Math.abs(target - a.remainingAmount) - Math.abs(target - b.remainingAmount);
  });
  return list;
}

/* =========================
 * Conciliar / Devolver / Revertir
 * ========================= */

/**
 * Conciliación manual (depósito -> ventas).
 * - NO elimina ventas.
 * - Setea vendorName/storeName del depósito (si hay un único vendedor/tienda coherente).
 * - Guarda matches simétricos para poder revertir:
 *   - En depósito: matches: [{ saleId, amount }]
 *   - En venta:    matches: [{ depositId, amount }]
 */
export async function manualSettleDeposit(deposit, selectedSales, {
  finalStatus = ES.LIQUIDADO,
  comment = 'Conciliado manualmente',
  vendorRef = null
} = {}) {
  const depRef = doc(db, 'deposits', deposit.id);

  await runTransaction(db, async (tx) => {
    const depSnap = await tx.get(depRef);
    if (!depSnap.exists()) throw new Error('Depósito no existe');
    const dep = depSnap.data();

    const depAmount  = Number(dep.amount || 0);
    let depMatched   = Number(dep.matchedTotal || 0);

    // para setear vendor/tienda en el depósito
    let vendorSeen = null;
    let storeSeen  = null;
    let consistentVendor = true;
    let consistentStore  = true;

    const usedRefs = [];
    const matchesForDeposit = []; // [{ saleId, amount }]

    for (const s of selectedSales) {
      const saleRef = doc(db, 'shopifySales', s.id);
      const saleSnap = await tx.get(saleRef);
      if (!saleSnap.exists()) continue;

      const sale = saleSnap.data();
      const total   = Number(sale.grossPayments || 0);
      const matched = Number(sale.matchedTotal || 0);
      const saleRem = Math.max(0, round2(total - matched));
      const depRem  = Math.max(0, round2(depAmount - depMatched));
      if (depRem <= 0.009) break;

      const toUse = Math.min(saleRem, depRem);
      if (toUse <= 0.009) continue;

      // capturar vendedor/tienda
      const vName = sale.staffMemberName || '';
      const sName = sale.storeName || sale.posLocationName || '';
      if (vName) {
        if (vendorSeen == null) vendorSeen = vName;
        else if (vendorSeen !== vName) consistentVendor = false;
      }
      if (sName) {
        if (storeSeen == null) storeSeen = sName;
        else if (storeSeen !== sName) consistentStore = false;
      }

      const newSaleMatched = round2(matched + toUse);
      const newSaleRem     = Math.max(0, round2(total - newSaleMatched));

      // actualizar venta (agregamos match simétrico)
      tx.update(saleRef, {
        matchedTotal: newSaleMatched,
        remainingAmount: newSaleRem,
        reconciliationStatus: newSaleRem <= 0.009 ? 'matched' : 'partial',
        matchedDepositRef: arrayUnion(depRef),
        matches: arrayUnion({ depositId: deposit.id, amount: toUse }),
        history: arrayUnion({
          action: 'manual_match',
          details: `Matched L ${toUse.toFixed(2)} con depósito ${deposit.id}`,
          timestamp: Timestamp.now(),
          user: vendorRef || null,
          userName: ''
        })
      });

      depMatched = round2(depMatched + toUse);
      usedRefs.push(saleRef);
      matchesForDeposit.push({ saleId: saleRef.id, amount: toUse });
    }

    const depRemAfter = Math.max(0, round2(depAmount - depMatched));
    const newStatus = depRemAfter <= 0.009 ? finalStatus : ES.PARCIAL;

    // setear vendor/store si son consistentes
    const vendorNameToSet = consistentVendor ? (vendorSeen || dep.vendorName || '') : (dep.vendorName || '');
    const storeNameToSet  = consistentStore  ? (storeSeen  || dep.storeName  || '') : (dep.storeName  || '');

    tx.update(depRef, {
      matchedTotal: depMatched,
      remainingAmount: depRemAfter,
      status: newStatus,
      vendorId: vendorRef || dep.vendorId || null,
      vendorName: vendorNameToSet,
      storeName: storeNameToSet,
      saleRef: usedRefs.length ? arrayUnion(...usedRefs) : (dep.saleRef || []),
      matches: matchesForDeposit.length ? arrayUnion(...matchesForDeposit) : (dep.matches || []),
      reconciliationScore: 100,
      history: arrayUnion({
        action: 'manual_settle',
        details: comment || 'Conciliado manualmente',
        links: matchesForDeposit,
        timestamp: Timestamp.now(),
        user: vendorRef || null,
        userName: ''
      }),
      liquidationDate: (newStatus === ES.LIQUIDADO || newStatus === ES.AUTO_LIQ)
        ? Timestamp.now()
        : (dep.liquidationDate || null)
    });
  });
}

/** Marcar depósito como devuelto (no toca ventas) */
export async function markDepositAsRefunded(deposit, {
  comment = 'Devuelto al cliente',
  vendorRef = null
} = {}) {
  const depRef = doc(db, 'deposits', deposit.id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(depRef);
    if (!snap.exists()) throw new Error('Depósito no existe');
    const dep = snap.data();
    if (isFinal(dep.status)) throw new Error('Depósito ya finalizado');

    tx.update(depRef, {
      status: ES.DEVUELTO,
      matchedTotal: 0,
      remainingAmount: 0,
      settledBy: 'refund',
      liquidationDate: Timestamp.now(),
      history: arrayUnion({
        action: 'refund',
        details: comment || 'Devuelto al cliente',
        timestamp: Timestamp.now(),
        user: vendorRef || null,
        userName: ''
      })
    });
  });
}

/**
 * Revertir depósito:
 * - Vuelve el depósito a Disponible (matchedTotal=0, remaining=amount).
 * - Recorre dep.matches y resta esos montos en cada venta.
 * - Limpia refs (matchedDepositRef / matches) en las ventas afectadas.
 * - **Nuevo**: también limpia vendedor/tienda del depósito.
 */
export async function revertDeposit(deposit, {
  reason = 'Reversión manual',
  userRef = null
} = {}) {
  const depRef = doc(db, 'deposits', deposit.id);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(depRef);
    if (!snap.exists()) throw new Error('Depósito no existe');
    const dep = snap.data();
    const statusLc = String(dep.status || '').toLowerCase();
    if (!(FINAL_STATES.includes(statusLc) || statusLc === ES.PARCIAL)) {
      throw new Error('El depósito no está finalizado ni parcial');
    }

    const matches = Array.isArray(dep.matches) ? dep.matches : []; // [{ saleId, amount }]

    // Revertir en ventas
    for (const m of matches) {
      if (!m?.saleId || !m?.amount) continue;
      const saleRef = doc(db, 'shopifySales', m.saleId);
      const sSnap = await tx.get(saleRef);
      if (!sSnap.exists()) continue;

      const sale = sSnap.data();
      const total   = Number(sale.grossPayments || 0);
      const matched = Number(sale.matchedTotal || 0);
      const toRemove = Number(m.amount || 0);

      const newMatched = round2(Math.max(0, matched - toRemove));
      const newRem     = Math.max(0, round2(total - newMatched));
      const newStatus  = newRem <= 0.009 ? 'matched' : ES.PENDING_REVIEW;

      tx.update(saleRef, {
        matchedTotal: newMatched,
        remainingAmount: newRem,
        reconciliationStatus: newStatus,
        matchedDepositRef: arrayRemove(depRef),
        matches: arrayRemove({ depositId: deposit.id, amount: toRemove }),
        history: arrayUnion({
          action: 'revert_match',
          details: `Reversión: se liberó L ${toRemove.toFixed(2)} del depósito ${deposit.id}`,
          timestamp: Timestamp.now(),
          user: userRef || null,
          userName: ''
        })
      });
    }

    // Resetear depósito (incluye limpiar vendedor/tienda)
    tx.update(depRef, {
      status: ES.DISPONIBLE,
      matchedTotal: 0,
      remainingAmount: Number(dep.amount || 0),
      saleRef: [],
      matches: [],
      liquidationDate: null,
      // 👇 NUEVO: limpiar vendedor/tienda
      vendorId: null,
      vendorName: '',
      storeName: '',
      history: arrayUnion({
        action: 'revert',
        details: reason,
        timestamp: Timestamp.now(),
        user: userRef || null,
        userName: ''
      })
    });
  });
}

/* =========================
 * Auto (opcional)
 * ========================= */
export async function linkDepositToSales(deposit, options = { tolerance: 0, dayWindow: 1 }) {
  const depRem = remaining(deposit.amount, deposit.matchedTotal);
  if (depRem <= 0.009) return;
  const cands = await fetchSaleCandidatesForDeposit(deposit, options);
  if (!cands.length) return;

  cands.sort((a,b) =>
    Math.abs(depRem - a.remainingAmount) - Math.abs(depRem - b.remainingAmount)
  );
  const best = cands[0];
  const tol = Number(options.tolerance || 0);

  if (Math.abs(best.remainingAmount - depRem) <= tol) {
    await manualSettleDeposit(deposit, [{ id: best.id }], {
      finalStatus: ES.AUTO_LIQ,
      comment: 'Auto-conciliado por el sistema'
    });
  }
}

export async function linkSaleToDeposits(sale, options = { tolerance: 0, dayWindow: 1 }) {
  const saleRem = remaining(sale.grossPayments, sale.matchedTotal);
  if (saleRem <= 0.009) return;

  const cands = await fetchDepositCandidatesForSale(sale, options);
  if (!cands.length) return;

  cands.sort((a,b) =>
    Math.abs(saleRem - a.remainingAmount) - Math.abs(saleRem - b.remainingAmount)
  );
  const best = cands[0];
  const tol = Number(options.tolerance || 0);

  if (Math.abs(best.remainingAmount - saleRem) <= tol) {
    const depLite = { id: best.id, amount: best.amount, matchedTotal: (best.amount - best.remainingAmount) };
    await manualSettleDeposit(depLite, [{ id: sale.id }], {
      finalStatus: ES.AUTO_LIQ,
      comment: 'Auto-conciliado por el sistema (desde venta)'
    });
  }
}
