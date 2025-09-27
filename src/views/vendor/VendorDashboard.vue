<script setup>
import { useAuthStore } from '@/stores/authStore';
import DepositsManager from '@/components/DepositsManager.vue';

const authStore = useAuthStore();
</script>

<template>
 <div class="min-h-screen bg-gray-100">
    <nav class="bg-white shadow-md">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex justify-between items-center h-16">
          <h1 class="text-xl font-bold text-gray-800">Panel de Vendedor</h1>
          <div class="flex items-center">
            <div v-if="authStore.user" class="text-right mr-4">
              <p class="text-sm font-medium text-gray-800">{{ authStore.user.display_name }}</p>
              <p class="text-xs text-gray-500">{{ authStore.user.storeName || 'Vendedor' }}</p>
            </div>
            <button @click="authStore.handleLogout()" class="px-3 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700">Salir</button>
          </div>
        </div>
      </div>
    </nav>
    <main class="p-4 sm:p-6 lg:p-8">
        <div v-if="authStore.user">
             <DepositsManager 
                user-role="vendor" 
                :user-id="authStore.user.uid" 
            />
        </div>
    </main>
  </div>
</template>