<script setup>
import { RouterView } from 'vue-router';
import Sidebar from '@/components/admin/Sidebar.vue';
import { useAuthStore } from '@/stores/authStore';

const authStore = useAuthStore();
</script>

<template>
  <div class="flex h-screen bg-gray-100" v-if="authStore.user">
    <Sidebar />
    <div class="flex-1 flex flex-col overflow-hidden">
      <header class="bg-white shadow-sm flex justify-end items-center p-4">
        <div class="text-right">
          <p class="text-sm font-medium text-gray-800">{{ authStore.user.display_name }}</p>
          <p class="text-xs text-gray-500">{{ authStore.user.roleName || 'Rol' }}</p>
        </div>
      </header>
      <main class="flex-1 overflow-x-hidden overflow-y-auto p-4 sm:p-6 lg:p-8">
        <RouterView />
      </main>
    </div>
  </div>
  <div v-else class="flex h-screen items-center justify-center">
    Cargando datos de usuario...
  </div>
</template>