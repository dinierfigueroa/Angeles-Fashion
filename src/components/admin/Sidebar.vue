<script setup>
import { RouterLink } from 'vue-router';
import { useAuthStore } from '@/stores/authStore';

const authStore = useAuthStore();

const navLinks = [
  { name: 'Subir Depósitos', route: 'admin-upload-deposits', permission: 'canUploadDeposits', icon: 'M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12' },
  { name: 'Subir Ventas Shopify', route: 'admin-upload-shopify', permission: 'canUploadDeposits', icon: 'M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z' },
  { name: 'Ver Depósitos', route: 'admin-view-deposits', permissions: ['canViewAllDeposits', 'canViewScopedDeposits'], icon: 'M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z' },
  { name: 'Gestionar Usuarios', route: 'admin-manage-users', permission: 'canManageUsers', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M15 21a6 6 0 00-9-5.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-3-5.197M15 21a6 6 0 00-9-5.197' },
  { name: 'Gestionar Roles', route: 'admin-manage-roles', permission: 'canManageRoles', icon: 'M10 20l4-16m4 4l-4 16M6 9l-4 4m0 0l4 4m-4-4h16' },
  { name: 'Certificados de Consumo', route: 'admin-gift-cards', permission: 'canManageGiftCards', icon: 'M15 5H9a2 2 0 00-2 2v2a2 2 0 002 2h6a2 2 0 002-2V7a2 2 0 00-2-2z M9 15h6a2 2 0 002-2v-2a2 2 0 00-2-2H9a2 2 0 00-2 2v2a2 2 0 002 2z' },
  { name: 'Caja Chica', route: 'admin-petty-cash', permissions: ['canManageAllPettyCash', 'canManageOwnPettyCash'], icon: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z' },
  { name: 'Gestionar Tiendas', route: 'admin-manage-stores', permission: 'canManageStores', icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
  { name: 'Gestionar Proveedores', route: 'admin-manage-providers', permission: 'canManageProviders', icon: 'M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10m0-2.657A8 8 0 0120.657 15.343S20 14 18 13m-5-5a3 3 0 11-6 0 3 3 0 016 0zm12 12a3 3 0 11-6 0 3 3 0 016 0z' },
  { name: 'Gastos Tarjeta', route: 'admin-expenses', permission: 'canReconcileExpenses', icon: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z' },
];

const hasPermission = (link) => {
  const userPermissions = authStore.user?.permissions;
  if (!userPermissions) return false;
  if (link.permission) return !!userPermissions[link.permission];
  if (link.permissions) return link.permissions.some(p => !!userPermissions[p]);
  return false;
};
</script>

<template>
  <aside class="w-64 bg-white shadow-md flex-shrink-0 flex flex-col">
    <div class="p-4 border-b">
      <h1 class="text-2xl font-bold text-gray-800">Admin Panel</h1>
    </div>
    <nav class="mt-4 flex-grow">
      <template v-for="link in navLinks" :key="link.name">
        <RouterLink
          v-if="hasPermission(link)"
          :to="{ name: link.route }"
          class="flex items-center px-4 py-3 text-gray-600 hover:bg-gray-100"
          active-class="sidebar-btn-active"
        >
          <svg class="h-6 w-6 mr-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="link.icon" />
          </svg>
          {{ link.name }}
        </RouterLink>
      </template>
    </nav>
    <div class="p-2 border-t">
      <button @click="authStore.handleLogout()" class="w-full flex items-center px-4 py-3 text-gray-600 hover:bg-gray-100 rounded-md">
        <svg class="h-6 w-6 mr-3 text-red-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
        Cerrar Sesión
      </button>
    </div>
  </aside>
</template>

<style scoped>
.sidebar-btn-active {
  background-color: #eef2ff;
  color: #4338ca;
  font-weight: 600;
}
</style>