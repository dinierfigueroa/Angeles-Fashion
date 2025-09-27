<script setup>
import { computed } from 'vue';

const props = defineProps({
  modelValue: Boolean,
  giftCard: Object,
});

const emit = defineEmits(['update:modelValue']);

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
});

const formatCurrency = (value) => {
    return new Intl.NumberFormat('es-HN', { style: 'currency', currency: 'HNL' }).format(value || 0);
};

const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'Fecha no disponible';
    return timestamp.toDate().toLocaleString('es-HN', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
};
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="isOpen" @click.self="isOpen = false" class="fixed inset-0 bg-gray-900 bg-opacity-50 z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-lg shadow-xl w-full max-w-2xl p-6">
          <div v-if="giftCard">
            <h3 class="text-xl font-bold text-gray-900 mb-1">Historial de Gift Card</h3>
            <p class="text-sm text-gray-500 mb-4">Folio: <span class="font-semibold text-gray-700">{{ giftCard.folio }}</span></p>
          </div>
          
          <div class="max-h-[60vh] overflow-y-auto">
            <div v-if="giftCard && giftCard.redemptionHistory && giftCard.redemptionHistory.length > 0">
              <table class="min-w-full">
                <thead class="bg-gray-50">
                    <tr>
                        <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Fecha</th>
                        <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Reclamado Por</th>
                        <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Procesado Por</th>
                        <th class="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Monto</th>
                    </tr>
                </thead>
                <tbody class="divide-y">
                    <tr v-for="(entry, index) in giftCard.redemptionHistory" :key="index">
                        <td class="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{{ formatTimestamp(entry.date) }}</td>
                        <td class="px-4 py-3 text-sm text-gray-800 font-medium">{{ entry.claimedBy_name }}</td>
                        <td class="px-4 py-3 text-sm text-gray-600">{{ entry.processedBy_name }}</td>
                        <td class="px-4 py-3 text-sm text-red-600 font-semibold text-right">-{{ formatCurrency(entry.amount) }}</td>
                    </tr>
                </tbody>
              </table>
            </div>
            <div v-else class="text-center text-gray-500 py-8">
              <p>Esta Gift Card no tiene historial de redenciones.</p>
            </div>
          </div>

          <div class="mt-6 flex justify-end">
            <button type="button" @click="isOpen = false" class="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300">Cerrar</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-enter-active, .modal-leave-active { transition: opacity 0.3s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
</style>