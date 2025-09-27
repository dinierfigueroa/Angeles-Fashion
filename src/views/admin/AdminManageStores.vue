<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '@/firebase';
import StoreFormModal from '@/components/modals/StoreFormModal.vue';
import AlertModal from '@/components/modals/AlertModal.vue';

const stores = ref([]);
const isLoading = ref(true);
const isModalOpen = ref(false);
const selectedStore = ref(null);
let unsubscribe = null;

const isAlertOpen = ref(false);
const alertMessage = ref('');

onMounted(() => {
  const q = query(collection(db, "stores"), orderBy("name"));
  unsubscribe = onSnapshot(q, (snapshot) => {
    stores.value = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    isLoading.value = false;
  }, (error) => {
    console.error("Error al cargar tiendas:", error);
    isLoading.value = false;
    showAlert('No se pudieron cargar las tiendas. Revisa la consola para más detalles.');
  });
});

onUnmounted(() => {
  if (unsubscribe) unsubscribe();
});

const openModal = (store = null) => {
  selectedStore.value = store;
  isModalOpen.value = true;
};

const handleStoreSaved = (message) => {
    alertMessage.value = message;
    isAlertOpen.value = true;
}

const showAlert = (msg) => {
    alertMessage.value = msg;
    isAlertOpen.value = true;
};

const formatCurrency = (value) => {
    return new Intl.NumberFormat('es-HN', { style: 'currency', currency: 'HNL' }).format(value || 0);
};
</script>

<template>
  <div class="bg-white p-6 rounded-lg shadow">
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-2xl font-bold text-gray-800">Gestión de Tiendas</h2>
      <button @click="openModal()" class="px-4 py-2 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700">Crear Tienda</button>
    </div>
    <p class="text-gray-600 mb-6">Aquí podrás crear, ver y editar las tiendas de la empresa.</p>

    <div class="overflow-x-auto">
      <table class="min-w-full divide-y divide-gray-200">
        <thead class="bg-gray-50">
            <tr>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nombre</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ubicación</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Saldo Caja Chica</th>
                <th class="relative px-6 py-3"><span class="sr-only">Acciones</span></th>
            </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200">
            <tr v-if="isLoading">
                <td colspan="4" class="px-6 py-4 text-center text-gray-500">Cargando tiendas...</td>
            </tr>
            <tr v-else-if="stores.length === 0">
                <td colspan="4" class="px-6 py-4 text-center text-gray-500">No hay tiendas creadas.</td>
            </tr>
            <tr v-for="store in stores" :key="store.id">
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{{ store.name }}</td>
                <td class="px-6 py-4 text-sm text-gray-500">{{ store.location }}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-800">{{ formatCurrency(store.currentPettyCashBalance) }}</td>
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-4">
                    <button @click="openModal(store)" class="text-indigo-600 hover:text-indigo-900">Editar</button>
                </td>
            </tr>
        </tbody>
      </table>
    </div>
  </div>

  <StoreFormModal 
    v-model="isModalOpen" 
    :storeToEdit="selectedStore" 
    @store-saved="handleStoreSaved"
  />
  <AlertModal
    v-model="isAlertOpen"
    :message="alertMessage"
  />
</template>