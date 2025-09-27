<script setup>
import { ref, watch, computed } from 'vue';
import { db } from '@/firebase';
import { doc, addDoc, updateDoc, collection } from 'firebase/firestore';

const props = defineProps({
  modelValue: Boolean,
  provider: Object,
});

const emit = defineEmits(['update:modelValue', 'provider-saved']);

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
});

const form = ref({
  nameProveedor: '',
  descripcion: '',
  telefono: '',
});
const isLoading = ref(false);

watch(() => props.provider, (newProvider) => {
  if (newProvider) {
    form.value = { 
      nameProveedor: newProvider.nameProveedor || '',
      descripcion: newProvider.descripcion || '',
      telefono: newProvider.telefono || ''
    };
  } else {
    form.value = { nameProveedor: '', descripcion: '', telefono: '' };
  }
}, { immediate: true });

const handleSubmit = async () => {
  if (!form.value.nameProveedor) {
    alert("El nombre del proveedor es obligatorio."); // Puedes reemplazar esto con un modal de alerta
    return;
  }
  isLoading.value = true;
  try {
    if (props.provider?.id) {
      // Actualizar
      const providerRef = doc(db, "proveedores", props.provider.id);
      await updateDoc(providerRef, form.value);
      emit('provider-saved', 'Proveedor actualizado con éxito.');
    } else {
      // Crear
      await addDoc(collection(db, "proveedores"), form.value);
      emit('provider-saved', 'Proveedor creado con éxito.');
    }
    isOpen.value = false;
  } catch (error) {
    console.error("Error guardando proveedor:", error);
    alert("No se pudo guardar el proveedor.");
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
            <h3 class="text-lg font-bold text-gray-900 mb-4">{{ provider ? 'Editar' : 'Crear' }} Proveedor</h3>
            
            <div class="space-y-4">
              <div>
                 <label for="provider-name" class="block text-sm font-medium text-gray-700">Nombre del Proveedor</label>
                 <input type="text" id="provider-name" v-model="form.nameProveedor" required class="w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm">
              </div>
              <div>
                  <label for="provider-description" class="block text-sm font-medium text-gray-700">Descripción</label>
                  <textarea id="provider-description" v-model="form.descripcion" rows="3" class="w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"></textarea>
              </div>
              <div>
                  <label for="provider-phone" class="block text-sm font-medium text-gray-700">Teléfono</label>
                  <input type="tel" id="provider-phone" v-model="form.telefono" class="w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm">
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