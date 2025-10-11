<script setup>
import { ref, onMounted, watch } from 'vue';
import {
  getFirestore,
  collection, query, where, orderBy, limit, getDocs, doc, getDoc
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { fetchDepositCandidatesForSale } from '@/services/reconcileService';

const db = getFirestore();
const fx = getFunctions();

/* -------------------------
   Filtros (con persistencia)
------------------------- */
const LS_KEY = 'recon_sales_filters_v1';

// Etiquetas (visual) en español para estados internos
const ES_LABEL = {
  unmatched: 'pendiente',
  pending_review: 'pendiente',
  partial: 'parcial',
  matched: 'conciliado',
  auto_settled: 'conciliado',
};

const statusOptions = [
  { value: 'all',            label: 'Todos' },
  { value: 'pending_review', label: 'pendiente' },
  { value: 'unmatched',      label: 'pendiente (sin candidatos)' },
  { value: 'partial',        label: 'parcial' },
  { value: 'matched',        label: 'conciliado' }, // útil si quieres ver conciliadas
];

function firstDayOfThisMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}
function lastDayOfThisMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}
function toInputDate(d) {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const dd = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function fromInputDate(s, end = false) {
  const [y, m, d] = s.split('-').map(n => parseInt(n, 10));
  return end ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d, 0, 0, 0, 0);
}

const statusFilter = ref('pending_review'); // por defecto, pendientes
const dateFrom = ref(toInputDate(firstDayOfThisMonth()));
const dateTo   = ref(toInputDate(lastDayOfThisMonth()));
const orderQuery = ref(''); // 🆕 número de orden/pedido

/* Persistencia */
function saveFilters() {
  const payload = {
    status: statusFilter.value,
    from: dateFrom.value,
    to: dateTo.value,
    order: orderQuery.value,
  };
  localStorage.setItem(LS_KEY, JSON.stringify(payload));
}
function loadFilters() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const { status, from, to, order } = JSON.parse(raw);
    if (status) statusFilter.value = status;
    if (from)   dateFrom.value    = from;
    if (to)     dateTo.value      = to;
    if (order)  orderQuery.value  = order;
  } catch {}
}

/* -------------------------
   Datos / carga
------------------------- */
const rows = ref([]);
const loading = ref(false);
const selected = ref(null);
const candidates = ref([]);
const picks = ref({}); // { [depositId]: useAmount }

function normOrder(q) {
  // limpia #, espacios y convierte a string
  return String((q || '').toString().replace(/[#\s]/g, '').trim());
}

async function load() {
  loading.value = true;

  const wanted = statusFilter.value;
  const orderStr = normOrder(orderQuery.value);

  let list = [];

  if (orderStr) {
    // 🔎 Consulta directa por número de orden/pedido
    const qRef = query(
      collection(db, 'shopifySales'),
      where('orderId', '==', orderStr),
      orderBy('saleDate', 'desc'),
      limit(50)
    );
    const snap = await getDocs(qRef);
    list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } else {
    // Rango de fechas desde filtros (filtramos por fecha en Firestore)
    const from = fromInputDate(dateFrom.value, false);
    const to   = fromInputDate(dateTo.value,   true);

    const qRef = query(
      collection(db, 'shopifySales'),
      where('saleDate', '>=', from),
      where('saleDate', '<=', to),
      orderBy('saleDate', 'desc'),
      limit(500)
    );

    const snap = await getDocs(qRef);
    list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  rows.value = list.filter(r => {
    const st = String(r.reconciliationStatus || r.status || '').toLowerCase();
    if (wanted === 'all') return true;
    return st === wanted;
  });

  loading.value = false;
}

/* guardar filtros al cambiar */
watch([statusFilter, dateFrom, dateTo, orderQuery], saveFilters);

/* -------------------------
   Utilidades UI
------------------------- */
function fmtDate(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString();
  } catch { return ''; }
}

async function openCandidates(row) {
  selected.value = row;
  candidates.value = [];
  picks.value = {};

  // 1) Si hay candidatos sugeridos (ids), se muestran
  const ids = row.candidateDepositIds || [];
  if (ids.length) {
    for (const id of ids) {
      const dd = await getDoc(doc(db, 'deposits', id));
      if (dd.exists()) {
        const data = dd.data();
        const remaining = (data.remainingAmount ?? (Number(data.amount || 0) - Number(data.matchedTotal || 0)));
        if (remaining > 0.009) {
          candidates.value.push({ id: dd.id, ...data, remaining });
        }
      }
    }
  }

  // 2) Fallback: si la lista quedó vacía, calcula candidatos por ventana ±1 día
  if (!candidates.value.length) {
    const calc = await fetchDepositCandidatesForSale(row, { dayWindow: 1, tolerance: 10 });
    candidates.value = calc.map(c => ({
      id: c.id,
      amount: c.amount,
      remaining: c.remainingAmount,
      bankKey: row.bankKey,                 // usamos el banco de la venta (candidato ya cumple)
      vendorName: c.vendorName,
      storeName: c.storeName,
      transactionDate: c.transactionDate
    }));
  }
}

async function conciliar() {
  const arr = Object.entries(picks.value)
    .map(([depositId, useAmount]) => ({ depositId, useAmount: Number(useAmount) }))
    .filter(x => x.useAmount > 0);

  if (!selected.value || !arr.length) return;

  await httpsCallable(fx, 'manualSettleSale')({
    saleId: selected.value.id,
    picks: arr
  });

  // recargar lista y cerrar
  await load();
  selected.value = null;
}

async function descartar(depositId) {
  if (!selected.value) return;
  await httpsCallable(fx, 'discardCandidate')({
    saleId: selected.value.id,
    depositId
  });
  await openCandidates(selected.value);
}

onMounted(() => {
  loadFilters(); // intenta recuperar lo guardado
  load();        // carga inicial
});
</script>

<template>
  <div class="p-4">
    <h1 class="text-xl font-semibold mb-4">Ventas · Revisión y conciliación</h1>

    <!-- Filtros -->
    <div class="grid grid-cols-1 md:grid-cols-5 gap-3 items-end mb-4">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">Estado</label>
        <select v-model="statusFilter" class="w-full border rounded p-2">
          <option v-for="o in statusOptions" :key="o.value" :value="o.value">
            {{ o.label }}
          </option>
        </select>
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">Desde</label>
        <input type="date" v-model="dateFrom" class="w-full border rounded p-2" />
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">Hasta</label>
        <input type="date" v-model="dateTo" class="w-full border rounded p-2" />
      </div>

      <!-- 🆕 Búsqueda por número de orden/pedido -->
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">Orden/Pedido</label>
        <input
          type="text"
          v-model="orderQuery"
          placeholder="#457661 o 457661"
          class="w-full border rounded p-2"
        />
      </div>

      <div class="flex gap-2">
        <button class="px-4 py-2 rounded bg-blue-600 text-white" @click="load">Aplicar</button>
        <button
          class="px-4 py-2 rounded bg-gray-200"
          @click="() => {
            statusFilter = 'pending_review';
            dateFrom = toInputDate(firstDayOfThisMonth());
            dateTo   = toInputDate(lastDayOfThisMonth());
            orderQuery = '';
            load();
          }"
        >
          Mes actual
        </button>
      </div>
    </div>

    <!-- Tabla -->
    <div v-if="loading">Cargando…</div>
    <div v-else>
      <table class="min-w-full border">
        <thead>
          <tr class="bg-gray-100 text-left">
            <th class="p-2">Orden</th>
            <th class="p-2">Fecha</th>
            <th class="p-2">Banco</th>
            <th class="p-2">Vendedor</th>
            <th class="p-2">Tienda</th>
            <th class="p-2">Monto</th>
            <th class="p-2">Estado</th>
            <th class="p-2">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" class="border-t">
            <td class="p-2">#{{ r.orderId }}</td>
            <td class="p-2">{{ fmtDate(r.saleDate) }}</td>
            <td class="p-2">{{ r.bankKey }}</td>
            <td class="p-2">{{ r.staffMemberName }}</td>
            <td class="p-2">{{ r.posLocationName || r.storeName }}</td>
            <td class="p-2">L {{ Number(r.grossPayments || 0).toFixed(2) }}</td>
            <td class="p-2">
              {{ ES_LABEL[(r.reconciliationStatus || r.status || '').toLowerCase()] || (r.reconciliationStatus || r.status) }}
            </td>
            <td class="p-2">
              <button class="px-3 py-1 rounded bg-blue-600 text-white" @click="openCandidates(r)">Revisar</button>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td colspan="8" class="p-4 text-center text-gray-500">Sin resultados.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Drawer simple -->
    <div v-if="selected" class="fixed inset-0 bg-black/40 flex">
      <div class="bg-white w-full max-w-2xl ml-auto p-4 overflow-y-auto">
        <div class="flex justify-between items-center mb-3">
          <h2 class="text-lg font-semibold">
            Venta #{{ selected.orderId }} · L {{ Number(selected.grossPayments || 0).toFixed(2) }}
          </h2>
          <button class="text-gray-600" @click="selected=null">✕</button>
        </div>

        <div v-if="!candidates.length" class="text-sm text-gray-500">Sin candidatos.</div>

        <div v-for="c in candidates" :key="c.id" class="border rounded p-3 mb-2">
          <div class="flex justify-between gap-3">
            <div>
              <div class="font-medium">{{ c.bankKey || selected.bankKey }} · L {{ Number(c.amount || 0).toFixed(2) }}</div>
              <div class="text-xs text-gray-500">Restante: L {{ Number(c.remaining || 0).toFixed(2) }}</div>
              <div class="text-xs text-gray-500">{{ c.vendorName }} · {{ c.storeName }}</div>
              <div class="text-xs text-gray-500">Fecha: {{ fmtDate(c.transactionDate) }}</div>
            </div>
            <div class="text-right">
              <input
                type="number" min="0" step="0.01"
                class="border p-1 w-32"
                v-model="picks[c.id]"
                :max="c.remaining"
                placeholder="L a usar"
              />
              <div>
                <button class="text-xs text-red-600 mt-2" @click="descartar(c.id)">Descartar</button>
              </div>
            </div>
          </div>
        </div>

        <div class="mt-3 flex gap-2">
          <button class="px-4 py-2 rounded bg-green-600 text-white" @click="conciliar">Conciliar</button>
          <button class="px-4 py-2 rounded bg-gray-200" @click="selected=null">Cancelar</button>
        </div>
      </div>
    </div>
  </div>
</template>
