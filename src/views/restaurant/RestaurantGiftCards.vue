<script setup>
import GiftCardManager from '@/components/GiftCardManager.vue';
import { useAuthStore } from '@/stores/authStore';
const authStore = useAuthStore();
</script>
<template>
    <div>
        <GiftCardManager v-if="authStore.user" :userRoles="authStore.user.role" />
    </div>
</template>