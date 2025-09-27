<script setup>
import { ref, watch, computed } from 'vue';
import { db } from '@/firebase';
import { doc, addDoc, updateDoc, collection, serverTimestamp, getDoc } from 'firebase/firestore';

const props = defineProps({
  modelValue: Boolean,
  storeToEdit: Object,
});

const emit = defineEmits(['update:modelValue', 'store-saved']);

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
});

const form = ref({
  name: '',
  location: '',
  initialPettyCashBalance: 2500, // Valor por defecto
});
const isLoading = ref(false);

watch(() => props.storeToEdit, async (newStore) => {
  if (newStore) {
    // Si estamos editando, cargamos los datos existentes
    const storeRef = doc(db, "stores", newStore.id);
    const docSnap = await getDoc(storeRef);
    if(docSnap.exists()){
        const data = docSnap.data();
        form.value = { 
          name: data.name || '',
          location: data.location || '',
          initialPettyCashBalance: data.initialPettyCashBalance || 0
        };
    }
  } else {
    // Si estamos creando, reseteamos el formulario
    form.value = { name: '', location: '', initialPettyCashBalance: 2500 };
  }
}, { immediate: true, deep: true });

const handleSubmit = async () => {
  if (!form.value.name || !form.value.location) {
    alert("El nombre y la ubicación son obligatorios.");
    return;
  }
  isLoading.value = true;
  try {
    const storeData = {
        name: form.value.name,
        location: form.value.location,
        initialPettyCashBalance: Number(form.value.initialPettyCashBalance)
    };

    if (props.storeToEdit?.id) {
      const storeRef = doc(db, "stores", props.storeToEdit.id);
      // Al editar, NO sobreescribimos el saldo actual.
      await updateDoc(storeRef, storeData);
      emit('store-saved', 'Tienda actualizada con éxito.');
    } else {
      // Al crear, el saldo actual es igual al inicial.
      storeData.currentPettyCashBalance = Number(form.value.initialPettyCashBalance);
      storeData.createdAt = serverTimestamp();
      await addDoc(collection(db, "stores"), storeData);
      emit('store-saved', 'Tienda creada con éxito.');
    }
    isOpen.value = false;
  } catch (error) {
    console.error("Error guardando la tienda:", error);
    alert("No se pudo guardar la tienda.");
  } finally {
    isLoading.value = false;
  }
};
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="isOpen" @click.self="isOpen = false" class="fixed inset-0 bg-gray-900 bg-opacity-50 z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-lg shadow-xl w-full max-w-lg p-6">
          <form @submit.prevent="handleSubmit">
            <h3 class="text-lg font-bold text-gray-900 mb-4">{{ storeToEdit ? 'Editar' : 'Crear Nueva' }} Tienda</h3>
            
            <div class="space-y-4">
              <div>
                 <label for="store-name" class="block text-sm font-medium text-gray-700">Nombre de la Tienda</label>
                 <input type="text" id="store-name" v-model="form.name" required class="w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm">
              </div>
              <div>
                  <label for="store-location" class="block text-sm font-medium text-gray-700">Ubicación</label>
                  <input type="text" id="store-location" v-model="form.location" required class="w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm">
              </div>
              <div>
                  <label for="store-initial-balance" class="block text-sm font-medium text-gray-700">Monto Asignado de Caja Chica (L)</label>
                  <input type="number" step="0.01" id="store-initial-balance" v-model.number="form.initialPettyCashBalance" required class="w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm">
              </div>
            </div>

            <div class="mt-6 flex justify-end space-x-3">
              <button type="button" @click="isOpen = false" class="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300">Cancelar</button>
              <button type="submit" :disabled="isLoading" class="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-indigo-300">
                {{ isLoading ? 'Guardando...' : 'Guardar' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-enter-active, .modal-leave-active { transition: opacity 0.3s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
</style>