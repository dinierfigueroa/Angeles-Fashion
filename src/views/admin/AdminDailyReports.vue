<!-- src/views/admin/AdminDailyReports.vue -->
<script setup>
import { ref, onMounted } from 'vue';
import { doc } from 'firebase/firestore';
import { db } from '@/firebase';
import { useAuthStore } from '@/stores/authStore';
import {
  listReports, approveReport, rejectReport
} from '@/services/dailyReportsService';

const auth = useAuthStore();

const filters = ref({
  status: 'pending', // default
  storeId: '',       // opcional
  from: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  to:   new Date(new Date().getFullYear(), new Date().getMonth()+1, 0)
});

const loading = ref(false);
const rows = ref([]);
const selected = ref(null);
const reviewComment = ref('');
const busy = ref(false);

function toInputDate(d) {
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), dd = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${dd}`;
}
function fromInputDate(s, end=false) {
  const [y,m,d] = s.split('-').map(Number);
  return new Date(y, m-1, d, end ? 23:0, end ? 59:0, end ? 59:0, end ? 999:0);
}
function fmt(n) { return Number(n||0).toFixed(2); }
function fmtDate(ts) { const d = ts?.toDate ? ts.toDate() : new Date(ts); return d.toLocaleDateString(); }

async function load() {
  loading.value = true;
  try {
    rows.value = await listReports({
      storeId: filters.value.storeId || undefined,
      status: filters.value.status === 'all' ? undefined : filters.value.status,
      from: filters.value.from,
      to: filters.value.to
    });
  } finally {
    loading.value = false;
  }
}
function open(r) { selected.value = r; reviewComment.value = ''; }
function close() { selected.value = null; reviewComment.value=''; }

async function doApprove() {
  if (!selected.value) return;
  busy.value = true;
  try {
    await approveReport(selected.value.id, auth.user?.uid ? doc(db,'users',auth.user.uid) : null, reviewComment.value);
    alert('Aprobado.');
    await load(); close();
  } catch (e) {
    alert(e.message || 'No se pudo aprobar');
  } finally { busy.value = false; }
}
async function doReject() {
  if (!selected.value) return;
  if (!reviewComment.value.trim()) return alert('Agrega un motivo de rechazo.');
  busy.value = true;
  try {
    await rejectReport(selected.value.id, auth.user?.uid ? doc(db,'users',auth.user.uid) : null, reviewComment.value);
    alert('Rechazado.');
    await load(); close();
  } catch (e) {
    alert('No se pudo rechazar');
  } finally { busy.value = false; }
}

onMounted(load);
</script>

<template>
  <div class="p-4">
    <h1 class="text-2xl font-bold mb-4">Reportes diarios (revisión)</h1>

    <!-- Filtros -->
    <div class="grid grid-cols-1 md:grid-cols-5 gap-3 items-end mb-4">
      <div>
        <label class="block text-sm text-gray-600 mb-1">Estado</label>
        <select v-model="filters.status" class="border rounded p-2 w-full">
          <option value="pending">Pendientes</option>
          <option value="approved">Aprobados</option>
          <option value="rejected">Rechazados</option>
          <option value="draft">Borradores</option>
          <option value="all">Todos</option>
        </select>
      </div>
      <div>
        <label class="block text-sm text-gray-600 mb-1">Desde</label>
        <input type="date" class="border rounded p-2 w-full"
               :value="toInputDate(filters.from)" @input="e => filters.from = fromInputDate(e.target.value,false)">
      </div>
      <div>
        <label class="block text-sm text-gray-600 mb-1">Hasta</label>
        <input type="date" class="border rounded p-2 w-full"
               :value="toInputDate(filters.to)" @input="e => filters.to = fromInputDate(e.target.value,true)">
      </div>
      <div>
        <label class="block text-sm text-gray-600 mb-1">Tienda (opcional)</label>
        <input type="text" v-model="filters.storeId" placeholder="storeId..." class="border rounded p-2 w-full">
      </div>
      <div class="flex gap-2">
        <button class="px-4 py-2 rounded bg-blue-600 text-white" @click="load">Aplicar</button>
        <button class="px-4 py-2 rounded bg-gray-200"
                @click="() => { const d=new Date(); filters.status='pending'; filters.from=new Date(d.getFullYear(),d.getMonth(),1); filters.to=new Date(d.getFullYear(), d.getMonth()+1,0); load(); }">
          Mes actual
        </button>
      </div>
    </div>

    <!-- Tabla -->
    <div v-if="loading">Cargando…</div>
    <div v-else>
      <table class="min-w-full border">
        <thead>
          <tr class="bg-gray-100 text-left text-sm">
            <th class="p-2">Fecha</th>
            <th class="p-2">Tienda</th>
            <th class="p-2">Cajero</th>
            <th class="p-2">Efectivo</th>
            <th class="p-2">Depósitos</th>
            <th class="p-2">POS</th>
            <th class="p-2">Dif</th>
            <th class="p-2">Estado</th>
            <th class="p-2">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" class="border-t">
            <td class="p-2">{{ fmtDate(r.reportDate) }}</td>
            <td class="p-2">{{ r.storeName }}</td>
            <td class="p-2">{{ r.cashierName }}</td>
            <td class="p-2">L {{ fmt(r.values?.cashCaptured) }}</td>
            <td class="p-2">L {{ fmt(r.values?.bankDepositsCaptured) }}</td>
            <td class="p-2">L {{ fmt(r.values?.posCaptured) }}</td>
            <td class="p-2" :class="(r.variance?.cashVariance||0)>=0 ? 'text-blue-700' : 'text-red-700'">
              L {{ fmt(r.variance?.cashVariance) }}
            </td>
            <td class="p-2 capitalize">{{ r.status }}</td>
            <td class="p-2">
              <button class="px-3 py-1 bg-indigo-600 text-white rounded" @click="open(r)">Revisar</button>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td colspan="9" class="p-3 text-center text-gray-500">Sin resultados.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Drawer -->
    <div v-if="selected" class="fixed inset-0 bg-black/40 flex">
      <div class="bg-white w-full max-w-3xl ml-auto h-full overflow-y-auto p-4">
        <div class="flex justify-between items-center mb-3">
          <h2 class="text-lg font-semibold">Detalle reporte · {{ selected.storeName }}</h2>
          <button class="text-gray-600" @click="close">✕</button>
        </div>

        <div class="grid grid-cols-2 gap-3 text-sm mb-4">
          <div><b>Fecha:</b> {{ fmtDate(selected.reportDate) }}</div>
          <div><b>Cajero:</b> {{ selected.cashierName }}</div>
          <div><b>Efectivo:</b> L {{ fmt(selected.values?.cashCaptured) }}</div>
          <div><b>Depósitos:</b> L {{ fmt(selected.values?.bankDepositsCaptured) }}</div>
          <div><b>POS:</b> L {{ fmt(selected.values?.posCaptured) }}</div>
          <div><b>Diferencia:</b> L {{ fmt(selected.variance?.cashVariance) }}</div>
          <div class="col-span-2"><b>Comentario:</b> {{ selected.comment || '—' }}</div>
        </div>

        <div class="mb-3">
          <h3 class="font-medium">Acción del revisor</h3>
          <textarea class="border rounded p-2 w-full" rows="3" v-model="reviewComment" placeholder="Comentario (requerido si vas a rechazar)"></textarea>
        </div>

        <div class="flex gap-2">
          <button class="px-4 py-2 rounded bg-green-600 text-white" :disabled="busy" @click="doApprove">Aprobar</button>
          <button class="px-4 py-2 rounded bg-red-600 text-white" :disabled="busy" @click="doReject">Rechazar</button>
          <button class="px-4 py-2 rounded bg-gray-200" @click="close">Cerrar</button>
        </div>
      </div>
    </div>
  </div>
</template>
