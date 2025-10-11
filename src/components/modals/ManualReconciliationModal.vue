<script setup>
import { ref, watch, computed } from 'vue';
import { db } from '@/firebase';
import { doc } from 'firebase/firestore';
import { fetchDepositCandidatesForSale, manualSettleDeposit, normalizeBankKey, ES } from '@/services/reconcileService';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  sale: { type: Object, default: null },     // venta que se revisa
});

const emit = defineEmits(['update:modelValue', 'settled']);

const open = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
});

/* Parámetros de búsqueda */
const dayWindow  = ref(1);   // ± 1 día
const tolerance  = ref(10);  // L 10
const candidates = ref([]);  // depósitos
const loading    = ref(false);
const selectedId = ref(null); // seleccionamos un depósito (1:1)

/* Totales */
const saleRemaining = computed(() => {
  const s = props.sale || {};
  return Math.max(0, Number(s.grossPayments || 0) - Number(s.matchedTotal || 0));
});

watch(open, async (v) => {
  if (v && props.sale) {
    selectedId.value = null;
    await loadCandidates();
  }
});

async function loadCandidates() {
  if (!props.sale) return;
  loading.value = true;
  try {
    candidates.value = await fetchDepositCandidatesForSale(props.sale, {
      dayWindow: dayWindow.value,
      tolerance: tolerance.value
    });
  } finally {
    loading.value = false;
  }
}

async function confirm() {
  if (!selectedId.value) {
    alert('Selecciona un depósito.');
    return;
  }
  const dep = candidates.value.find(x => x.id === selectedId.value);
  if (!dep) return;

  try {
    // “depósito” mínimo para reusar manualSettleDeposit
    const depLite = { id: dep.id, amount: dep.amount, matchedTotal: (dep.amount - dep.remainingAmount) };
    await manualSettleDeposit(depLite, [{ id: props.sale.id }], {
      finalStatus: ES.LIQUIDADO,
      comment: `Conciliado desde ventas (orden #${props.sale.orderId || props.sale.id})`
    });
    emit('settled', 'Conciliación aplicada desde venta.');
    open.value = false;
  } catch (e) {
    console.error(e);
    alert('No se pudo conciliar.');
  }
}
</script>

<template>
  <div v-if="open" class="fixed inset-0 bg-black/30 z-50 flex items-center justify-center">
    <div class="bg-white w-full max-w-3xl rounded-xl shadow-xl p-6">
      <div class="flex justify-between items-center mb-3">
        <h3 class="text-lg font-semibold">
          Venta #{{ sale?.orderId || sale?.id }} · L {{ Number(sale?.grossPayments || 0).toFixed(2) }}
        </h3>
        <button class="text-gray-500 hover:text-gray-800" @click="open=false">✕</button>
      </div>

      <div class="grid grid-cols-3 gap-3 mb-4">
        <div>
          <label class="text-sm text-gray-600">Ventana (± días)</label>
          <input type="number" min="0" v-model.number="dayWindow" class="mt-1 w-full border rounded px-2 py-1" @change="loadCandidates">
        </div>
        <div>
          <label class="text-sm text-gray-600">Tolerancia (L)</label>
          <input type="number" min="0" v-model.number="tolerance" class="mt-1 w-full border rounded px-2 py-1" @change="loadCandidates">
        </div>
        <div>
          <label class="text-sm text-gray-600">Restante venta</label>
          <div class="mt-2 font-semibold">L {{ saleRemaining.toFixed(2) }}</div>
        </div>
      </div>

      <div class="border rounded p-3 h-72 overflow-auto">
        <div v-if="loading" class="text-sm text-gray-600">Buscando depósitos cercanos…</div>
        <div v-else-if="candidates.length === 0" class="text-sm text-gray-600">Sin candidatos.</div>

        <table v-else class="w-full text-sm">
          <thead class="text-gray-500">
            <tr>
              <th class="text-left py-1">Sel</th>
              <th class="text-left py-1">Fecha</th>
              <th class="text-left py-1">Vendedor</th>
              <th class="text-left py-1">Tienda</th>
              <th class="text-right py-1">Restante Dep.</th>
              <th class="text-left py-1">Estado</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in candidates" :key="d.id" class="border-t">
              <td class="py-1">
                <input
                  type="radio"
                  name="dep_pick"
                  :value="d.id"
                  v-model="selectedId"
                />
              </td>
              <td class="py-1">{{ d.transactionDate?.toLocaleDateString('es-HN') }}</td>
              <td class="py-1">{{ d.vendorName || '—' }}</td>
              <td class="py-1">{{ d.storeName || '—' }}</td>
              <td class="py-1 text-right">L {{ Number(d.remainingAmount).toFixed(2) }}</td>
              <td class="py-1 capitalize">{{ d.status }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="mt-4 flex justify-end gap-2">
        <button class="px-4 py-2 bg-gray-200 rounded" @click="open=false">Cancelar</button>
        <button class="px-4 py-2 bg-green-600 text-white rounded" @click="confirm">Conciliar</button>
      </div>
    </div>
  </div>
</template>