<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { collection, query, orderBy, onSnapshot, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/firebase';
import ProviderFormModal from '@/components/modals/ProviderFormModal.vue';
import ConfirmModal from '@/components/modals/ConfirmModal.vue';
import AlertModal from '@/components/modals/AlertModal.vue';

const providers = ref([]);
const isModalOpen = ref(false);
const selectedProvider = ref(null);
let unsubscribe = null;

// Para el modal de confirmación de borrado
const isConfirmOpen = ref(false);
const providerToDelete = ref(null);
const confirmMessage = ref('');

// Para el modal de alerta de éxito/error
const isAlertOpen = ref(false);
const alertMessage = ref('');

onMounted(() => {
  const q = query(collection(db, "proveedores"), orderBy("nameProveedor"));
  unsubscribe = onSnapshot(q, (snapshot) => {
    providers.value = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  });
});

onUnmounted(() => {
  if (unsubscribe) unsubscribe();
});

const openModal = (provider = null) => {
  selectedProvider.value = provider;
  isModalOpen.value = true;
};

const closeModal = () => {
  isModalOpen.value = false;
  selectedProvider.value = null;
};

const handleProviderSaved = (message) => {
    alertMessage.value = message;
    isAlertOpen.value = true;
}

const confirmDelete = (provider) => {
    providerToDelete.value = provider;
    confirmMessage.value = `¿Estás seguro de que quieres eliminar al proveedor "${provider.nameProveedor}"? Esta acción no se puede deshacer.`;
    isConfirmOpen.value = true;
}

const handleDelete = async () => {
    if (!providerToDelete.value) return;
    try {
        await deleteDoc(doc(db, "proveedores", providerToDelete.value.id));
        alertMessage.value = 'Proveedor eliminado con éxito.';
        isAlertOpen.value = true;
    } catch (error) {
        console.error("Error al eliminar proveedor:", error);
        alertMessage.value = 'No se pudo eliminar el proveedor.';
        isAlertOpen.value = true;
    }
    providerToDelete.value = null;
}
</script>

<template>
  <div class="bg-white p-6 rounded-lg shadow">
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-2xl font-bold text-gray-800">Gestión de Proveedores</h2>
      <button @click="openModal()" class="px-4 py-2 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700">Crear Proveedor</button>
    </div>

    <div class="overflow-x-auto">
      <table class="min-w-full divide-y divide-gray-200">
        <thead class="bg-gray-50">
            <tr>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nombre</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Descripción</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Teléfono</th>
                <th class="relative px-6 py-3"><span class="sr-only">Acciones</span></th>
            </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200">
            <tr v-if="providers.length === 0">
                <td colspan="4" class="px-6 py-4 text-center text-gray-500">No hay proveedores creados.</td>
            </tr>
            <tr v-for="p in providers" :key="p.id">
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{{ p.nameProveedor }}</td>
                <td class="px-6 py-4 text-sm text-gray-500">{{ p.descripcion || '---' }}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{{ p.telefono || '---' }}</td>
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-4">
                    <button @click="openModal(p)" class="text-indigo-600 hover:text-indigo-900">Editar</button>
                    <button @click="confirmDelete(p)" class="text-red-600 hover:text-red-900">Eliminar</button>
                </td>
            </tr>
        </tbody>
      </table>
    </div>
  </div>

  <ProviderFormModal 
    v-model="isModalOpen" 
    :provider="selectedProvider" 
    @close="closeModal" 
    @provider-saved="handleProviderSaved"
  />
  <ConfirmModal
    v-model="isConfirmOpen"
    title="Confirmar Eliminación"
    :message="confirmMessage"
    @confirm="handleDelete"
  />
  <AlertModal
    v-model="isAlertOpen"
    :message="alertMessage"
  />
</template>