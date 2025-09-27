// src/services/reconcileService.js
import { db } from '@/firebase';
import {
  collection, query, where, orderBy, getDocs, doc, writeBatch,
  serverTimestamp, Timestamp, getDoc, limit
} from 'firebase/firestore';

/** --- Normalizaciones y utilidades --- **/
const strip = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9 ]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

const GATEWAY_TO_BANK = (g) => {
  const s = strip(g);
  if (s.includes('BAC')) return 'BAC Credomatic';
  if (s.includes('ATLANT')) return 'ATLANTIDA';
  if (s.includes('FICO')) return 'FICOHSA';
  if (s.includes('OCCID')) return 'OCCIDENTE';
  if (s.includes('BANPAIS')) return 'BANPAIS';
  if (s.includes('BANRURAL')) return 'BANRURAL';
  return s || g || '';
};

const withinDays = (date, base, days = 1) => {
  const d = date instanceof Date ? date : date?.toDate?.() ?? new Date(date);
  const b = base instanceof Date ? base : base?.toDate?.() ?? new Date(base);
  if (!(d instanceof Date) || isNaN(d)) return false;
  if (!(b instanceof Date) || isNaN(b)) return false;
  const diff = Math.abs(
    d.setHours(0, 0, 0, 0) - b.setHours(0, 0, 0, 0)
  );
  return diff <= days * 86400000;
};

const rem = (total, matchedTotal) =>
  Number((Number(total || 0) - Number(matchedTotal || 0)).toFixed(2));

/** combinaciones 1 ó 2 elementos (rápido) que sumen target */
function combosUpTo2(items, target, tolerance = 0) {
  const t = Number(target);
  const tol = Number(tolerance);
  const out = [];

  // 1:1
  for (const it of items) {
    const v = Number(it.remainingAmount);
    if (Math.abs(v - t) <= tol) out.push([it]);
  }
  if (out.length) return out;

  // 2:1
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const v = Number(items[i].remainingAmount) + Number(items[j].remainingAmount);
      if (Math.abs(v - t) <= tol) out.push([items[i], items[j]]);
    }
  }
  return out;
}

function scoreDepositForSale(dep, sale, dayWindow) {
  // higher is better
  const sVendor =
    sale.vendorRef?.id && dep.vendorId?.id && sale.vendorRef.id === dep.vendorId.id ? 5 : 0;
  const sStore =
    sale.storeId?.id && dep.storeId?.id && sale.storeId.id === dep.storeId.id ? 3 : 0;
  const sReserved = dep.status === 'reservado' ? 2 : 0;

  // Fechas: más cerca, mejor (convertimos a negativo para ordenar asc)
  const dDep = dep.transactionDate?.toDate?.() ?? new Date(dep.transactionDate);
  const dSale = sale.saleDate?.toDate?.() ?? new Date(sale.saleDate);
  const daysDiff = Math.abs(dDep - dSale) / 86400000;
  const sDate = Math.max(0, dayWindow - daysDiff); // entre 0 y 1 aprox si dayWindow=1

  return sVendor + sStore + sReserved + sDate;
}

/** --- Helpers comunes para fetch de candidatos --- **/
async function fetchDepositCandidatesForSale(sale, opts) {
  const { dayWindow } = opts;
  const bank = GATEWAY_TO_BANK(sale.paymentGateway);
  const saleDate = sale.saleDate?.toDate?.() ?? new Date(sale.saleDate);

  const from = new Date(saleDate.getTime() - dayWindow * 86400000);
  const to = new Date(saleDate.getTime() + dayWindow * 86400000);

  // status in ['disponible','reservado'] requiere índice
  const q = query(
    collection(db, 'deposits'),
    where('bank', '==', bank),
    where('transactionDate', '>=', Timestamp.fromDate(from)),
    where('transactionDate', '<=', Timestamp.fromDate(to)),
    where('status', 'in', ['disponible', 'reservado'])
  );

  const snap = await getDocs(q);
  let list = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  // calcular remainingAmount si no existe
  list = list.map(d => {
    const mt = Number(d.matchedTotal || 0);
    const total = Number(d.amount || 0);
    return {
      ...d,
      matchedTotal: mt,
      remainingAmount: Number((total - mt).toFixed(2))
    };
  });

  // Si es reservado, estrechamos por vendedor/tienda
  list = list.filter(d => {
    if (d.status === 'reservado') {
      if (sale.vendorRef?.id && d.vendorId?.id && sale.vendorRef.id !== d.vendorId.id)
        return false;
      if (sale.storeId?.id && d.storeId?.id && sale.storeId.id !== d.storeId.id)
        return false;
    }
    return withinDays(d.transactionDate, saleDate, dayWindow) && d.remainingAmount > 0;
  });

  // ordenar por score (más alto primero)
  list.sort((a, b) => scoreDepositForSale(b, sale, dayWindow) - scoreDepositForSale(a, sale, dayWindow));
  return list;
}

async function fetchSaleCandidatesForDeposit(dep, opts) {
  const { dayWindow } = opts;
  const gatewayBank = strip(dep.bank);
  const saleDate = dep.transactionDate?.toDate?.() ?? new Date(dep.transactionDate);

  const from = new Date(saleDate.getTime() - dayWindow * 86400000);
  const to = new Date(saleDate.getTime() + dayWindow * 86400000);

  const q = query(
    collection(db, 'shopifySales'),
    where('saleDate', '>=', Timestamp.fromDate(from)),
    where('saleDate', '<=', Timestamp.fromDate(to)),
    where('status', '==', 'pendiente') // tu estado original; si no existe, quítalo
  );

  const snap = await getDocs(q);
  let list = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  list = list
    .map(s => {
      const mt = Number(s.matchedTotal || 0);
      const total = Number(s.grossPayments || 0);
      return {
        ...s,
        matchedTotal: mt,
        remainingAmount: Number((total - mt).toFixed(2)),
        mappedBank: GATEWAY_TO_BANK(s.paymentGateway)
      };
    })
    .filter(s => s.remainingAmount > 0 && strip(s.mappedBank) === gatewayBank)
    .filter(s => withinDays(s.saleDate, saleDate, dayWindow));

  // preferimos las que coincidan en vendor/store si el depósito está reservado
  list.sort((a, b) => {
    const aScore =
      (dep.vendorId?.id && a.vendorRef?.id === dep.vendorId.id ? 5 : 0) +
      (dep.storeId?.id && a.storeId?.id === dep.storeId.id ? 3 : 0);
    const bScore =
      (dep.vendorId?.id && b.vendorRef?.id === dep.vendorId.id ? 5 : 0) +
      (dep.storeId?.id && b.storeId?.id === dep.storeId.id ? 3 : 0);
    return bScore - aScore;
  });

  return list;
}

/** --- APLICADORES (actualizan ambos lados en batch) --- **/
function applySaleWithDeposits(batch, saleSnapOrPlain, saleId, pickedDeposits) {
  const sale = saleSnapOrPlain.data ? saleSnapOrPlain.data() : saleSnapOrPlain;
  const needed = rem(sale.grossPayments, sale.matchedTotal);
  let accumulated = 0;

  for (const dep of pickedDeposits) {
    const toUse = Math.min(dep.remainingAmount, needed - accumulated);
    accumulated += toUse;

    const depRef = doc(db, 'deposits', dep.id);
    const depMatchedTotal = Number(dep.matchedTotal || 0) + toUse;
    const depRemaining = Number((dep.amount - depMatchedTotal).toFixed(2));
    const newSaleRefArr = (dep.saleRef || []).concat(doc(db, 'shopifySales', saleId));

    batch.update(depRef, {
      saleRef: newSaleRefArr,
      matchedTotal: depMatchedTotal,
      remainingAmount: depRemaining,
      status: depRemaining <= 0 ? 'liquidado' : dep.status,
      orderId: sale.orderId,
      liquidationDate: serverTimestamp(),
      settledBy: 'auto'
    });
  }

  const saleRef = doc(db, 'shopifySales', saleId);
  const newSaleMatched = Number(sale.matchedTotal || 0) + accumulated;
  const saleRemaining = Number((sale.grossPayments - newSaleMatched).toFixed(2));
  batch.update(saleRef, {
    matchedDepositRef: (sale.matchedDepositRef || []).concat(
      pickedDeposits.map(d => doc(db, 'deposits', d.id))
    ),
    matchedTotal: newSaleMatched,
    remainingAmount: saleRemaining,
    reconciliationStatus: saleRemaining <= 0 ? 'matched' : 'partial',
    reconciliationDate: serverTimestamp()
  });
}

function applyDepositWithSales(batch, depSnapOrPlain, depId, pickedSales) {
  const dep = depSnapOrPlain.data ? depSnapOrPlain.data() : depSnapOrPlain;
  const needed = rem(dep.amount, dep.matchedTotal);
  let accumulated = 0;

  for (const sale of pickedSales) {
    const toUse = Math.min(sale.remainingAmount, needed - accumulated);
    accumulated += toUse;

    const saleRef = doc(db, 'shopifySales', sale.id);
    const saleMatchedNew = Number(sale.matchedTotal || 0) + toUse;
    const saleRemaining = Number((sale.grossPayments - saleMatchedNew).toFixed(2));
    const newMatDep = (sale.matchedDepositRef || []).concat(doc(db, 'deposits', depId));

    batch.update(saleRef, {
      matchedDepositRef: newMatDep,
      matchedTotal: saleMatchedNew,
      remainingAmount: saleRemaining,
      reconciliationStatus: saleRemaining <= 0 ? 'matched' : 'partial',
      reconciliationDate: serverTimestamp()
    });
  }

  const depRef = doc(db, 'deposits', depId);
  const depMatchedNew = Number(dep.matchedTotal || 0) + accumulated;
  const depRemaining = Number((dep.amount - depMatchedNew).toFixed(2));
  batch.update(depRef, {
    matchedTotal: depMatchedNew,
    remainingAmount: depRemaining,
    status: depRemaining <= 0 ? 'liquidado' : dep.status,
    liquidationDate: serverTimestamp(),
    settledBy: 'auto'
  });
}

/** --- API PÚBLICA --- **/

// Desde una VENTA → buscar DEPÓSITOS
export async function linkSaleToDeposits(saleSnapOrPlain, opts = {}) {
  const { tolerance = 0, dayWindow = 1 } = opts;
  const sale = saleSnapOrPlain.data ? saleSnapOrPlain.data() : saleSnapOrPlain;
  const saleId = saleSnapOrPlain.id || sale.id;

  const remaining = rem(sale.grossPayments, sale.matchedTotal);
  if (remaining <= 0) return { status: 'already-matched' };

  const candidates = await fetchDepositCandidatesForSale(sale, { dayWindow });
  if (!candidates.length) {
    // no hay nada cercano → review sin candidatos
    const b = writeBatch(db);
    b.update(doc(db, 'shopifySales', saleId), {
      reconciliationStatus: 'review',
      candidateDepositIds: [],
      reconciliationDate: serverTimestamp()
    });
    await b.commit();
    return { status: 'review', candidates: [] };
  }

  // probamos combinaciones (1 ó 2) exactas
  const exact = combosUpTo2(candidates, remaining, tolerance);
  if (!exact.length) {
    // dejar algunas sugerencias
    const top = candidates.slice(0, 5).map(c => c.id);
    const b = writeBatch(db);
    b.update(doc(db, 'shopifySales', saleId), {
      reconciliationStatus: 'review',
      candidateDepositIds: top,
      reconciliationDate: serverTimestamp()
    });
    await b.commit();
    return { status: 'review', candidates: top };
  }

  const pick = exact[0];
  const batch = writeBatch(db);
  applySaleWithDeposits(batch, sale, saleId, pick);
  await batch.commit();
  return { status: 'matched', used: pick.map(p => p.id) };
}

// Desde un DEPÓSITO → buscar VENTAS
export async function linkDepositToSales(depSnapOrPlain, opts = {}) {
  const { tolerance = 0, dayWindow = 1 } = opts;
  const dep = depSnapOrPlain.data ? depSnapOrPlain.data() : depSnapOrPlain;
  const depId = depSnapOrPlain.id || dep.id;

  const remaining = rem(dep.amount, dep.matchedTotal);
  if (remaining <= 0) return { status: 'already-matched' };

  const candidates = await fetchSaleCandidatesForDeposit(dep, { dayWindow });
  if (!candidates.length) {
    const b = writeBatch(db);
    b.update(doc(db, 'deposits', depId), {
      pendingReason: 'Sin ventas cercanas',
      candidateSaleIds: []
    });
    await b.commit();
    return { status: 'review', candidates: [] };
  }

  const exact = combosUpTo2(
    candidates.map(s => ({ ...s, amount: s.grossPayments, remainingAmount: s.remainingAmount })),
    remaining,
    tolerance
  );

  if (!exact.length) {
    const top = candidates.slice(0, 5).map(s => s.id);
    const b = writeBatch(db);
    b.update(doc(db, 'deposits', depId), {
      pendingReason: 'Ambiguedad de ventas',
      candidateSaleIds: top
    });
    await b.commit();
    return { status: 'review', candidates: top };
  }

  const pick = exact[0];
  const batch = writeBatch(db);
  applyDepositWithSales(batch, dep, depId, pick);
  await batch.commit();
  return { status: 'matched', used: pick.map(p => p.id) };
}