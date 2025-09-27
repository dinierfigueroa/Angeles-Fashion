<script setup>
import { computed } from 'vue';

const props = defineProps({
  modelValue: Boolean,
  deposit: Object,
});

const emit = defineEmits(['update:modelValue']);

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
});

const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'Fecha no disponible';
    return timestamp.toDate().toLocaleString('es-HN', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
};
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="isOpen" @click.self="isOpen = false" class="fixed inset-0 bg-gray-900 bg-opacity-50 z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-lg shadow-xl w-full max-w-2xl p-6">
          <h3 class="text-xl font-bold text-gray-900 mb-4">Historial del Depósito</h3>
          
          <div v-if="deposit && deposit.history && deposit.history.length > 0" class="max-h-[60vh] overflow-y-auto">
            <div v-for="(entry, index) in deposit.history" :key="index" class="py-3 border-b last:border-b-0">
                <p class="font-semibold text-gray-800">{{ entry.action }}</p>
                <p class="text-sm text-gray-600"><span class="font-medium">Usuario:</span> {{ entry.userName }}</p>
                <p class="text-sm text-gray-600"><span class="font-medium">Fecha:</span> {{ formatTimestamp(entry.timestamp) }}</p>
                <p class="text-sm text-gray-600 mt-1"><span class="font-medium">Detalles:</span> {{ entry.details }}</p>
            </div>
          </div>
          <div v-else class="text-center text-gray-500 py-8">
            <p>Este depósito no tiene historial de acciones.</p>
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