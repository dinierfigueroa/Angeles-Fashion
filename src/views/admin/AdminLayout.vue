<template>
  <div class="min-h-screen flex bg-gray-50">
    <!-- Sidebar fijo -->
    <Sidebar />

    <!-- Contenido -->
    <section class="flex-1 flex flex-col">
      <!-- Header (opcional) -->
      <header class="h-14 px-4 border-b bg-white flex items-center justify-between">
        <h2 class="text-lg font-semibold">Panel Administrativo</h2>
        <!-- Slot por si agregas acciones -->
        <div class="flex items-center gap-2">
          <slot name="actions"></slot>
        </div>
      </header>

      <!-- AQUÍ SE RENDERIZAN LAS RUTAS HIJAS -->
      <main class="p-4">
        <!-- clave para forzar re-render si es necesario -->
        <RouterView :key="$route.fullPath" />
      </main>
    </section>
  </div>
</template>

<script setup>
import { RouterView } from 'vue-router'
import Sidebar from '@/components/admin/Sidebar.vue'
</script>

<style scoped>
/* Asegura que el main crezca y sea scrollable si hace falta */
main {
  min-height: calc(100vh - 3.5rem); /* 3.5rem ≈ h-14 */
}
</style>
