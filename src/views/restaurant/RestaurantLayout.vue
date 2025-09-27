<script setup>
import { RouterLink, RouterView } from 'vue-router';
import { useAuthStore } from '@/stores/authStore';

const authStore = useAuthStore();

const navLinks = [
  { name: 'Registrar Gasto', to: '/restaurant/gastos' },
  { name: 'Caja Chica', to: '/restaurant/petty-cash' },
  { name: 'Certificados de Consumo', to: '/restaurant/gift-cards' },
];
</script>

<template>
 <div class="min-h-screen bg-gray-100 flex">
    <aside class="w-64 bg-white shadow-md flex-shrink-0 flex flex-col">
        <div class="p-4 border-b">
            <h1 class="text-2xl font-bold text-gray-800">Panel La Marina</h1>
            <p v-if="authStore.user" class="text-sm text-gray-500">{{ authStore.user.storeName || 'Restaurante' }}</p>
        </div>
        <nav class="mt-4 flex-grow">
            <RouterLink 
                v-for="link in navLinks" 
                :key="link.name" 
                :to="link.to" 
                class="flex items-center px-4 py-3 text-gray-600 hover:bg-gray-100"
                active-class="sidebar-btn-active"
            >
                {{ link.name }}
            </RouterLink>
        </nav>
        <div class="p-2 border-t">
            <button @click="authStore.handleLogout()" class="w-full flex items-center px-4 py-3 text-gray-600 hover:bg-gray-100 rounded-md">
                <svg class="h-6 w-6 mr-3 text-red-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013 3h4a3 3 0 013 3v1" /></svg>
                Cerrar Sesión
            </button>
        </div>
    </aside>

    <div class="flex-1 flex flex-col overflow-hidden">
        <header class="bg-white shadow-sm flex justify-end items-center p-4">
             <div v-if="authStore.user" class="text-right mr-4">
              <p class="text-sm font-medium text-gray-800">{{ authStore.user.display_name }}</p>
              <p class="text-xs text-gray-500 capitalize">{{ authStore.user.role.join(', ') }}</p>
            </div>
        </header>
        <main class="flex-1 overflow-x-hidden overflow-y-auto bg-gray-100 p-4 sm:p-6 lg:p-8">
            <RouterView />
        </main>
    </div>
 </div>
</template>

<style scoped>
.sidebar-btn-active {
  background-color: #eef2ff;
  color: #4338ca;
  font-weight: 600;
}
</style>