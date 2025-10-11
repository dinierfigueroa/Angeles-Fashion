<script setup>
import { ref, computed } from 'vue';
import { revertDeposit } from '@/services/reconcileService';
import { useAuthStore } from '@/stores/authStore';
import { db } from '@/firebase';
import { doc } from 'firebase/firestore';

const props = defineProps({
  modelValue: Boolean,
  deposit: { type: Object, required: true }
});
const emit = defineEmits(['update:modelValue', 'done']);

const open = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
});

const motivo = ref('');
const auth = useAuthStore();

async function confirm() {
  if (!motivo.value.trim()) return alert('Escribe el motivo.');
  try {
    await revertDeposit(props.deposit, {
      reason: motivo.value,
      userRef: auth.user?.uid ? doc(db, 'users', auth.user.uid) : null
    });
    emit('done'); open.value = false;
  } catch (e) {
    console.error(e);
    alert('No se pudo revertir el depósito.');
  }
}
</script>

<template>
  <div v-if="open" class="fixed inset-0 bg-black/30 z-50 flex items-center justify-center">
    <div class="bg-white w-full max-w-md rounded-lg shadow-xl p-6">
      <h3 class="text-lg font-semibold mb-3">Revertir depósito · L {{ Number(deposit?.amount||0).toFixed(2) }}</h3>
      <p class="text-sm text-gray-600">
        Devolverá el depósito a <b>Disponible</b> y limpiará las referencias a ventas.
      </p>
      <label class="block text-sm mt-3 mb-1 text-gray-700">Motivo</label>
      <textarea v-model="motivo" rows="3" class="w-full border rounded p-2" placeholder="Motivo de la reversión"></textarea>

      <div class="mt-4 flex justify-end gap-2">
        <button class="px-4 py-2 bg-gray-200 rounded" @click="open=false">Cancelar</button>
        <button class="px-4 py-2 bg-green-600 text-white rounded" @click="confirm">Confirmar reversión</button>
      </div>
    </div>
  </div>
</template>
