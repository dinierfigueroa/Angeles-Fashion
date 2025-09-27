<script setup>
import { computed } from 'vue';

const props = defineProps({
  modelValue: Boolean,
  message: String,
  title: { type: String, default: 'Confirmar Acción' }
});

const emit = defineEmits(['update:modelValue', 'confirm']);

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
});

function confirmAction() {
  emit('confirm');
  isOpen.value = false;
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="isOpen" class="fixed inset-0 bg-gray-900 bg-opacity-50 z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
          <h3 class="text-lg font-bold text-gray-900">{{ title }}</h3>
          <p class="mt-2 text-sm text-gray-600">{{ message }}</p>
          <div class="mt-6 flex justify-end space-x-3">
            <button @click="isOpen = false" class="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300">Cancelar</button>
            <button @click="confirmAction" class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">Confirmar</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: all 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
  transform: scale(0.9);
}
</style>