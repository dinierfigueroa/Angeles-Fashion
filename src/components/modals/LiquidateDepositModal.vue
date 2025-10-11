<script setup>
import { ref, computed, watch } from 'vue';
import {
  fetchSaleCandidatesForDeposit,
  manualSettleDeposit,
  markDepositAsRefunded,
  ES
} from '@/services/reconcileService';

const props = defineProps({
  modelValue: Boolean,
  deposit: { type: Object, required: true },
});
const emit = defineEmits(['update:modelValue', 'done']);

const open = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const refundMode = ref(false);
const refundReason = ref('');
const comment = ref('');
const tolerance = ref(10);
const dayWindow = ref(1);
const finalStatus = ref(ES.LIQUIDADO);

const candidates = ref([]);
const selected = ref(new Set());
const loading = ref(false);

const depRemaining = computed(() =>
  Number((Number(props.deposit?.amount||0) - Number(props.deposit?.matchedTotal||0)).toFixed(2))
);
const selectedTotal = computed(() => {
  let sum = 0; for (const c of candidates.value) if (selected.value.has(c.id)) sum += Number(c.remainingAmount||c.grossPayments||0);
  return Number(sum.toFixed(2));
});
const diff = computed(() => Number((depRemaining.value - selectedTotal.value).toFixed(2)));

watch(open, async (v) => {
  if (v) {
    selected.value.clear();
    refundMode.value = false;
    refundReason.value = '';
    await loadCandidates();
  }
});

async function loadCandidates() {
  loading.value = true;
  try {
    candidates.value = await fetchSaleCandidatesForDeposit(props.deposit, {
      dayWindow: Number(dayWindow.value||1),
      tolerance: Number(tolerance.value||0),
    });
  } catch (e) {
    console.error(e);
    candidates.value = [];
  } finally {
    loading.value = false;
  }
}

function toggle(id) {
  if (selected.value.has(id)) selected.value.delete(id);
  else selected.value.add(id);
}

async function confirm() {
  try {
    if (refundMode.value) {
      if (!refundReason.value.trim()) return alert('Escribe el motivo de devolución.');
      await markDepositAsRefunded(props.deposit, { comment: refundReason.value });
      emit('done'); open.value = false; return;
    }

    if (selected.value.size === 0) return alert('Selecciona al menos una venta.');
    const picks = candidates.value.filter(c => selected.value.has(c.id));
    await manualSettleDeposit(props.deposit, picks, {
      finalStatus: finalStatus.value,
      comment: comment.value || 'Conciliado manualmente'
    });
    emit('done'); open.value = false;
  } catch (e) {
    console.error(e);
    alert('No se pudo aplicar la conciliación.');
  }
}
</script>

<template>
  <div v-if="open" class="fixed inset-0 bg-black/30 z-50 flex items-center justify-center">
    <div class="bg-white w-full max-w-3xl rounded-lg shadow-xl p-6">
      <h3 class="text-lg font-semibold mb-4">Conciliar / Devolver · L {{ Number(deposit?.amount||0).toFixed(2) }}</h3>

      <label class="flex items-center gap-2 mb-2">
        <input type="checkbox" v-model="refundMode" />
        <span>Marcar este depósito como devuelto</span>
      </label>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4" v-if="!refundMode">
        <div>
          <label class="text-sm text-gray-600">Ventana (± días)</label>
          <input class="w-full border rounded px-2 py-1" type="number" v-model="dayWindow" @change="loadCandidates" />
        </div>
        <div>
          <label class="text-sm text-gray-600">Tolerancia (L)</label>
          <input class="w-full border rounded px-2 py-1" type="number" v-model="tolerance" @change="loadCandidates" />
        </div>
        <div>
          <label class="text-sm text-gray-600">Estado final</label>
          <select class="w-full border rounded px-2 py-1" v-model="finalStatus">
            <option :value="ES.LIQUIDADO">Liquidado</option>
            <option :value="ES.PARCIAL">Parcial</option>
          </select>
        </div>
      </div>

      <div v-if="!refundMode">
        <div class="text-sm text-gray-600 mb-2">
          Restante del depósito: <b>L {{ depRemaining.toFixed(2) }}</b> ·
          Seleccionado: <b>L {{ selectedTotal.toFixed(2) }}</b> ·
          Dif: <b :class="diff<0 ? 'text-red-600' : 'text-gray-700'">L {{ diff.toFixed(2) }}</b>
        </div>

        <div class="border rounded overflow-hidden">
          <div v-if="loading" class="p-4 text-center text-gray-500">Cargando…</div>
          <table v-else class="w-full text-sm">
            <thead class="bg-gray-50 text-gray-600">
              <tr>
                <th class="p-2 text-left">Sel</th>
                <th class="p-2 text-left">Orden</th>
                <th class="p-2 text-left">Fecha</th>
                <th class="p-2 text-left">Vendedor</th>
                <th class="p-2 text-left">Tienda</th>
                <th class="p-2 text-right">Monto pendiente</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in candidates" :key="c.id" class="border-t">
                <td class="p-2"><input type="checkbox" :checked="selected.has(c.id)" @change="toggle(c.id)" /></td>
                <td class="p-2">#{{ c.orderId }}</td>
                <td class="p-2">{{ c.saleDate?.toLocaleDateString?.('es-HN') }}</td>
                <td class="p-2">{{ c.staffMemberName || '---' }}</td>
                <td class="p-2">{{ c.storeName || '---' }}</td>
                <td class="p-2 text-right">L {{ Number(c.remainingAmount || c.grossPayments || 0).toFixed(2) }}</td>
              </tr>
              <tr v-if="!candidates.length">
                <td class="p-4 text-center text-gray-500" colspan="6">Sin candidatos.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <textarea v-model="comment" rows="3" class="mt-3 w-full border rounded p-2" placeholder="Comentario para auditoría (opcional)"></textarea>
      </div>

      <div v-else>
        <p class="text-sm text-gray-600">Si activas esta opción, no puedes seleccionar ventas. Debes escribir el motivo.</p>
        <textarea v-model="refundReason" rows="3" class="mt-3 w-full border rounded p-2" placeholder="Motivo de la devolución (obligatorio)"></textarea>
      </div>

      <div class="mt-4 flex justify-end gap-2">
        <button class="px-4 py-2 bg-gray-200 rounded" @click="open=false">Cancelar</button>
        <button class="px-4 py-2 bg-green-600 text-white rounded" @click="confirm">
          {{ refundMode ? 'Confirmar devolución' : 'Confirmar conciliación' }}
        </button>
      </div>
    </div>
  </div>
</template>
