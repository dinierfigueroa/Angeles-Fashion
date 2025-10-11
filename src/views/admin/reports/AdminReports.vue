<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import {
  getFirestore, collection, query, where, orderBy, getDocs
} from 'firebase/firestore';

const db = getFirestore();

/* ---------- Utilidades fechas ---------- */
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
function fromInputDate(s, end=false) {
  const [y,m,d] = s.split('-').map(n => parseInt(n,10));
  return end ? new Date(y, m-1, d, 23,59,59,999) : new Date(y, m-1, d, 0,0,0,0);
}
function fmt(n){ return Number(n || 0).toFixed(2); }
function fmtDate(ts){
  try{ const d = ts?.toDate ? ts.toDate() : new Date(ts); return d.toLocaleDateString(); }
  catch { return ''; }
}

/* ---------- Filtros (persistentes) ---------- */
const LS_KEY = 'reports_filters_v1';

const groupBy = ref('vendor'); // 'vendor' | 'store'
const status = ref('all');     // 'all','disponible','parcial','liquidado','auto_liquidado','devuelto'
const bank   = ref('all');     // 'all','BAC','FICOHSA', etc (si lo usas)
const dateFrom = ref(toInputDate(firstDayOfThisMonth()));
const dateTo   = ref(toInputDate(lastDayOfThisMonth()));

function saveFilters() {
  const payload = { groupBy: groupBy.value, status: status.value, bank: bank.value, from: dateFrom.value, to: dateTo.value };
  localStorage.setItem(LS_KEY, JSON.stringify(payload));
}
function loadFilters() {
  try{
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    if (p.groupBy) groupBy.value = p.groupBy;
    if (p.status)  status.value  = p.status;
    if (p.bank)    bank.value    = p.bank;
    if (p.from)    dateFrom.value = p.from;
    if (p.to)      dateTo.value   = p.to;
  }catch{}
}
watch([groupBy, status, bank, dateFrom, dateTo], saveFilters);

/* ---------- Datos ---------- */
const loading = ref(false);
const rows = ref([]); // depósitos crudos
const sales = ref([]); // ventas crudas (opcional para comparar)

async function load() {
  loading.value = true;
  rows.value = [];
  sales.value = [];

  const from = fromInputDate(dateFrom.value, false);
  const to   = fromInputDate(dateTo.value, true);

  // --- Depósitos dentro del rango por fecha ---
  let qDep = query(
    collection(db, 'deposits'),
    where('transactionDate', '>=', from),
    where('transactionDate', '<=', to),
    orderBy('transactionDate', 'desc')
  );
  const depSnap = await getDocs(qDep);
  const allDeps = depSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // filtros en memoria: banco / estado
  const wantStatus = status.value;
  const wantBank   = bank.value;

  rows.value = allDeps.filter(r => {
    const st = String(r.status || '').toLowerCase();
    const bk = String(r.bankKey || r.bank || '').toUpperCase();
    const statusOk = (wantStatus === 'all') ? true : (st === wantStatus);
    const bankOk   = (wantBank === 'all') ? true : (bk === wantBank);
    return statusOk && bankOk;
  });

  // --- Ventas dentro del rango (opcional, para comparar) ---
  let qSales = query(
    collection(db, 'shopifySales'),
    where('saleDate', '>=', from),
    where('saleDate', '<=', to),
    orderBy('saleDate', 'desc')
  );
  const saleSnap = await getDocs(qSales);
  sales.value = saleSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  loading.value = false;
}

/* ---------- Agregación ---------- */
const grouped = computed(() => {
  // clave: por vendedor o tienda
  const keyOf = (r) => {
    if (groupBy.value === 'store') return r.storeName || r.store || r.posLocationName || '—';
    return r.vendorName || r.vendor || '—';
  };

  const map = new Map();

  // Agrega depósitos
  for (const r of rows.value) {
    const k = keyOf(r);
    if (!map.has(k)) map.set(k, {
      key: k,
      depositsAmount: 0,
      depositsMatched: 0,
      depositsRemaining: 0,
      depositsCount: 0,
      salesAmount: 0,
      salesMatched: 0,
      sample: r, // para mostrar banco/fecha de ejemplo si se desea
    });
    const it = map.get(k);
    const amt = Number(r.amount || 0);
    const mt  = Number(r.matchedTotal || 0);
    const rem = Math.max(0, amt - mt);

    it.depositsAmount   += amt;
    it.depositsMatched  += mt;
    it.depositsRemaining+= rem;
    it.depositsCount    += 1;
  }

  // Agrega ventas (opcional) para tener una columna comparativa
  for (const s of sales.value) {
    const k = (groupBy.value === 'store')
      ? (s.storeName || s.posLocationName || '—')
      : (s.staffMemberName || '—');

    if (!map.has(k)) map.set(k, {
      key: k,
      depositsAmount: 0,
      depositsMatched: 0,
      depositsRemaining: 0,
      depositsCount: 0,
      salesAmount: 0,
      salesMatched: 0,
      sample: s,
    });

    const it = map.get(k);
    const g  = Number(s.grossPayments || 0);
    const m  = Number(s.matchedTotal || 0);

    it.salesAmount  += g;
    it.salesMatched += m;
  }

  // A plano
  return Array.from(map.values()).sort((a,b) => b.depositsAmount - a.depositsAmount);
});

/* ---------- Init ---------- */
onMounted(() => { loadFilters(); load(); });

</script>

<template>
  <div class="p-4">
    <h1 class="text-xl font-semibold mb-4">Reportes</h1>

    <!-- Filtros -->
    <div class="grid grid-cols-1 md:grid-cols-6 gap-3 items-end mb-4">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">Agrupar por</label>
        <select v-model="groupBy" class="w-full border rounded p-2">
          <option value="vendor">Vendedor</option>
          <option value="store">Tienda</option>
        </select>
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">Estado depósito</label>
        <select v-model="status" class="w-full border rounded p-2">
          <option value="all">Todos</option>
          <option value="disponible">disponible</option>
          <option value="parcial">parcial</option>
          <option value="liquidado">liquidado</option>
          <option value="auto_liquidado">auto_liquidado</option>
          <option value="devuelto">devuelto</option>
        </select>
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">Banco</label>
        <select v-model="bank" class="w-full border rounded p-2">
          <option value="all">Todos</option>
          <option value="BAC">BAC</option>
          <option value="FICOHSA">FICOHSA</option>
          <option value="ATLANTIDA">ATLANTIDA</option>
          <option value="BANPAIS">BANPAIS</option>
          <option value="OCCIDENTE">OCCIDENTE</option>
          <option value="BANRURAL">BANRURAL</option>
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

      <div class="flex gap-2">
        <button class="px-4 py-2 rounded bg-blue-600 text-white" @click="load">Aplicar</button>
        <button
          class="px-4 py-2 rounded bg-gray-200"
          @click="() => { 
            groupBy = 'vendor'; status = 'all'; bank = 'all';
            dateFrom = toInputDate(firstDayOfThisMonth()); 
            dateTo   = toInputDate(lastDayOfThisMonth());
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
            <th class="p-2">{{ groupBy === 'store' ? 'Tienda' : 'Vendedor' }}</th>
            <th class="p-2"># Depósitos</th>
            <th class="p-2">Depósitos (L)</th>
            <th class="p-2">Conciliado (L)</th>
            <th class="p-2">Restante (L)</th>
            <th class="p-2">Ventas (L)</th>
            <th class="p-2">Ventas conciliadas (L)</th>
            <th class="p-2">Dif Ventas-Conc (L)</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in grouped" :key="r.key" class="border-t">
            <td class="p-2">{{ r.key }}</td>
            <td class="p-2">{{ r.depositsCount }}</td>
            <td class="p-2">L {{ fmt(r.depositsAmount) }}</td>
            <td class="p-2">L {{ fmt(r.depositsMatched) }}</td>
            <td class="p-2">L {{ fmt(r.depositsRemaining) }}</td>
            <td class="p-2">L {{ fmt(r.salesAmount) }}</td>
            <td class="p-2">L {{ fmt(r.salesMatched) }}</td>
            <td class="p-2">L {{ fmt(Number(r.salesAmount - r.salesMatched)) }}</td>
          </tr>
          <tr v-if="!grouped.length">
            <td colspan="8" class="p-4 text-center text-gray-500">Sin resultados.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>