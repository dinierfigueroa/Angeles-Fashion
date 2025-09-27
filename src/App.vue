<template>
  <RouterView />
</template>

<script setup>
import { RouterView } from 'vue-router'
import { useAuthStore } from '@/stores/authStore';

const authStore = useAuthStore();
authStore.init(); // Inicia el listener de autenticación
</script>