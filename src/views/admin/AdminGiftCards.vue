<script setup>
import GiftCardManager from '@/components/GiftCardManager.vue';
import { useAuthStore } from '@/stores/authStore';

const authStore = useAuthStore();
</script>

<template>
  <div>
    <GiftCardManager v-if="authStore.user" :userRoles="authStore.user.role" />
    <div v-else class="text-center p-8 bg-white rounded-lg shadow">Cargando datos de usuario...</div>
  </div>
</template>