<script setup>
import { ref, onMounted, computed } from 'vue';
import { collection, query, orderBy, getDocs, getDoc } from 'firebase/firestore';
import { db } from '@/firebase';
import { useAuthStore } from '@/stores/authStore';
import PettyCashManager from '@/components/PettyCashManager.vue';

const authStore = useAuthStore();
const allStores = ref([]);
const selectedStoreId = ref('');
const isLoading = ref(true);

const canManageAll = computed(() => authStore.user?.permissions?.canManageAllPettyCash);
const singleAssignedStoreId = computed(() => {
    // Para un usuario con una sola tienda asignada en su perfil principal
    if (!canManageAll.value && authStore.user?.storeId) {
        return authStore.user.storeId.id;
    }
    return null;
});

onMounted(async () => {
    // El Superadmin carga todas las tiendas para el selector.
    // Un gerente de tienda no necesita cargar esta lista si solo ve la suya.
    if (canManageAll.value) {
        try {
            const q = query(collection(db, "stores"), orderBy("name"));
            const snapshot = await getDocs(q);
            allStores.value = snapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name }));
        } catch (error) {
            console.error("Error al cargar las tiendas:", error);
        }
    }
    isLoading.value = false;
});
</script>

<template>
  <div class="bg-white p-6 rounded-lg shadow">
    <h2 class="text-2xl font-bold text-gray-800 mb-4">Gestión de Caja Chica</h2>
    
    <div v-if="isLoading" class="text-gray-500">Cargando...</div>

    <div v-else-if="canManageAll">
      <label for="petty-cash-store-select" class="block text-sm font-medium text-gray-700">Selecciona una tienda para gestionar su caja chica:</label>
      <select id="petty-cash-store-select" v-model="selectedStoreId" class="mt-1 block w-full max-w-md pl-3 pr-10 py-2 text-base border-gray-300 rounded-md">
          <option value="" disabled>-- Elige una tienda --</option>
          <option v-for="store in allStores" :key="store.id" :value="store.id">{{ store.name }}</option>
      </select>
      <hr class="my-6" v-if="selectedStoreId">
      <PettyCashManager v-if="selectedStoreId" :store-id="selectedStoreId" />
    </div>

    <div v-else-if="singleAssignedStoreId">
        <PettyCashManager :store-id="singleAssignedStoreId" />
    </div>

    <div v-else>
        <p class="text-red-500">No tienes permisos para ver esta sección o no tienes una tienda asignada.</p>
    </div>
  </div>
</template>