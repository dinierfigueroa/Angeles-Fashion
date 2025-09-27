<script setup>
import PettyCashManager from '@/components/PettyCashManager.vue';
import { useAuthStore } from '@/stores/authStore';
const authStore = useAuthStore();
</script>
<template>
    <div v-if="authStore.user && authStore.user.storeId" class="bg-white p-6 rounded-lg shadow">
        <h2 class="text-2xl font-bold text-gray-800 mb-4">Gestión de Caja Chica</h2>
        <PettyCashManager :store-id="authStore.user.storeId.id" />
    </div>
    <div v-else class="bg-white p-6 rounded-lg shadow">
        <h2 class="text-2xl font-bold text-gray-800 mb-4">Aviso</h2>
        <p class="text-red-500">Este usuario no tiene una caja chica asignada (falta asignarle una 'Tienda' en el panel de admin).</p>
    </div>
</template>