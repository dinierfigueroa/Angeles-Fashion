// src/services/dailyReportsService.js
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, serverTimestamp,
  collection, addDoc, query, where, orderBy, getDocs, Timestamp, arrayUnion
} from 'firebase/firestore';
import {
  getStorage, ref as storageRef, uploadBytes, getDownloadURL
} from 'firebase/storage';

const db = getFirestore();
const storage = getStorage();

/** Helpers */
export const toYMD = (d) => {
  const x = d instanceof Date ? d : (d?.toDate ? d.toDate() : new Date(d));
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2,'0');
  const dd = String(x.getDate()).padStart(2,'0');
  return `${y}${m}${dd}`;
};
export const ymdKey = (storeId, date) => `${storeId}_${toYMD(date)}`;
export const ts = (d) => Timestamp.fromDate(d instanceof Date ? d : new Date(d));
export const round2 = (n) => Number((Number(n||0)).toFixed(2));

/** Crea/actualiza (modo draft) */
export async function saveDraftReport(payload) {
  const {
    id, // opcional, si viene lo respeta
    storeId, storeRef, storeName,
    reportDate,
    cashierRef, cashierName,
    createdByRef, createdByRole,
    hasValues = false,
    values = {},
    comment = ''
  } = payload;

  const docId = id || ymdKey(storeId, reportDate);
  const ref = doc(db, 'dailyReports', docId);

  const snap = await getDoc(ref);
  const base = snap.exists() ? snap.data() : {};

  const cashCaptured = round2(values.cashCaptured || 0);
  const bankDepositsCaptured = round2(values.bankDepositsCaptured || 0);
  const posCaptured = round2(values.posCaptured || 0);
  const cashVariance = round2(cashCaptured - bankDepositsCaptured);

  const data = {
    reportDate: ts(reportDate),
    storeRef, storeId, storeName,
    cashierRef: cashierRef || base.cashierRef || null,
    cashierName: cashierName ?? base.cashierName ?? '',
    createdByRef: createdByRef || base.createdByRef || null,
    createdByRole: createdByRole || base.createdByRole || '',
    hasValues: !!hasValues,
    values: {
      netSalesCash: round2(values.netSalesCash || base?.values?.netSalesCash || 0),
      cashCaptured,
      bankDepositsCaptured,
      posCaptured
    },
    variance: {
      cashVariance,
      notesRequired: !!hasValues && cashVariance !== 0
    },
    comment: comment ?? base.comment ?? '',
    images: base.images || { depositProofs: [], posAudit: [] },
    status: base.status || 'draft',
    flags: base.flags || { canEditNumbers: true, lockAfterApprove: true },
    updatedAt: serverTimestamp(),
    ...(snap.exists() ? {} : { createdAt: serverTimestamp(), history: [] })
  };

  if (snap.exists()) {
    await updateDoc(ref, data);
  } else {
    await setDoc(ref, data);
  }

  await updateDoc(ref, {
    history: arrayUnion({
      action: 'save_draft',
      byRef: createdByRef || null,
      byName: '',
      at: serverTimestamp(),
      details: 'Guardado como borrador/pendiente'
    })
  });

  return { id: ref.id };
}

/** Enviar a revisión (bloquea números) */
export async function submitReport(reportId, byRef) {
  const ref = doc(db, 'dailyReports', reportId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Reporte no existe');
  const r = snap.data();
  // si requiere comentario por varianza y está vacío, forzar en UI antes de llamar
  await updateDoc(ref, {
    status: 'pending',
    flags: { ...(r.flags || {}), canEditNumbers: false },
    updatedAt: serverTimestamp(),
    history: arrayUnion({
      action: 'submit',
      byRef: byRef || null,
      byName: '',
      at: serverTimestamp(),
      details: 'Enviado para revisión'
    })
  });
}

/** Aprobar (exige imagen si hasValues) */
export async function approveReport(reportId, reviewerRef, reviewComment = '') {
  const ref = doc(db, 'dailyReports', reportId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Reporte no existe');
  const r = snap.data();
  if (r.hasValues && !(r.images?.depositProofs?.length > 0)) {
    throw new Error('Se requiere al menos una imagen de depósito para aprobar.');
  }
  await updateDoc(ref, {
    status: 'approved',
    review: {
      reviewedByRef: reviewerRef || null,
      reviewedByName: '',
      reviewDecision: 'approved',
      reviewComment: reviewComment || '',
      reviewDate: serverTimestamp()
    },
    updatedAt: serverTimestamp(),
    history: arrayUnion({
      action: 'approve',
      byRef: reviewerRef || null,
      byName: '',
      at: serverTimestamp(),
      details: `Aprobado. ${reviewComment || ''}`.trim()
    })
  });
}

/** Rechazar */
export async function rejectReport(reportId, reviewerRef, reviewComment = '') {
  const ref = doc(db, 'dailyReports', reportId);
  await updateDoc(ref, {
    status: 'rejected',
    flags: { canEditNumbers: true, lockAfterApprove: true },
    review: {
      reviewedByRef: reviewerRef || null,
      reviewedByName: '',
      reviewDecision: 'rejected',
      reviewComment: reviewComment || '',
      reviewDate: serverTimestamp()
    },
    updatedAt: serverTimestamp(),
    history: arrayUnion({
      action: 'reject',
      byRef: reviewerRef || null,
      byName: '',
      at: serverTimestamp(),
      details: `Rechazado. ${reviewComment || ''}`.trim()
    })
  });
}

/** Subir archivo y registrar ruta */
export async function uploadReportImage({ reportId, storeId, reportDate, type = 'deposit', file }) {
  const yyyy = new Date(reportDate).getFullYear();
  const mm = String(new Date(reportDate).getMonth() + 1).padStart(2,'0');
  const path = `reports/${storeId}/${yyyy}/${mm}/${reportId}/${type}_${Date.now()}_${file.name}`;
  const r = storageRef(storage, path);
  await uploadBytes(r, file);
  const url = await getDownloadURL(r);

  const ref = doc(db, 'dailyReports', reportId);
  const snap = await getDoc(ref);
  const base = snap.data() || {};
  const images = base.images || { depositProofs: [], posAudit: [] };
  if (type === 'deposit') images.depositProofs = [...images.depositProofs, path];
  if (type === 'pos') images.posAudit = [...images.posAudit, path];
  await updateDoc(ref, { images, updatedAt: serverTimestamp() });
  return { path, url };
}

/** Listar reportes por filtros */
export async function listReports({ storeId, status, from, to, limit = 200 }) {
  const cons = [orderBy('reportDate','desc')];
  if (storeId) cons.push(where('storeId','==',storeId));
  if (status && status !== 'all') cons.push(where('status','==',status));
  if (from) cons.push(where('reportDate','>=',ts(from)));
  if (to) cons.push(where('reportDate','<=',ts(new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23,59,59,999))));

  const q = query(collection(db,'dailyReports'), ...cons);
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
