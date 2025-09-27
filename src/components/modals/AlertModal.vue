<script setup>
import { computed } from 'vue';

const props = defineProps({
  modelValue: Boolean,
  message: String,
  title: {
    type: String,
    default: 'Atención'
  }
});

const emit = defineEmits(['update:modelValue']);

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
});
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="isOpen" class="fixed inset-0 bg-gray-900 bg-opacity-50 z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-lg shadow-xl w-full max-w-md p-6 transform scale-100">
          <h3 class="text-lg font-bold text-yellow-800">{{ title }}</h3>
          <p class="mt-2 text-sm text-gray-600 whitespace-pre-wrap">{{ message }}</p>
          <div class="mt-6 flex justify-end">
            <button @click="isOpen = false" class="px-4 py-2 bg-yellow-500 text-white rounded-md hover:bg-yellow-600">Entendido</button>
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