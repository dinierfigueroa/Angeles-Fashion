import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/authStore'

import LoginView from '@/views/LoginView.vue'
import AdminLayout from '@/views/admin/AdminLayout.vue'
import AdminUploadDeposits from '@/views/admin/AdminUploadDeposits.vue'
import AdminUploadShopify from '@/views/admin/AdminUploadShopify.vue'
import AdminViewDeposits from '@/views/admin/AdminViewDeposits.vue'
import AdminManageUsers from '@/views/admin/AdminManageUsers.vue'
import AdminManageRoles from '@/views/admin/AdminManageRoles.vue';
import AdminGiftCards from '@/views/admin/AdminGiftCards.vue'
import AdminPettyCash from '@/views/admin/AdminPettyCash.vue'
import AdminManageStores from '@/views/admin/AdminManageStores.vue'
import AdminManageProviders from '@/views/admin/AdminManageProviders.vue'
import AdminExpenses from '@/views/admin/AdminExpenses.vue'
import VendorDashboard from '@/views/vendor/VendorDashboard.vue'
import RestaurantLayout from '@/views/restaurant/RestaurantLayout.vue'
import RestaurantGastos from '@/views/restaurant/RestaurantGastos.vue'
import RestaurantPettyCash from '@/views/restaurant/RestaurantPettyCash.vue'
import RestaurantGiftCards from '@/views/restaurant/RestaurantGiftCards.vue'

export const adminRoutes = [
    { path: 'upload-deposits', name: 'admin-upload-deposits', component: AdminUploadDeposits, meta: { permission: 'canUploadDeposits' } },
    { path: 'upload-shopify', name: 'admin-upload-shopify', component: AdminUploadShopify, meta: { permission: 'canUploadDeposits' } },
    { path: 'view-deposits', name: 'admin-view-deposits', component: AdminViewDeposits, meta: { permissions: ['canViewAllDeposits', 'canViewScopedDeposits'] } },
    { path: 'manage-users', name: 'admin-manage-users', component: AdminManageUsers, meta: { permission: 'canManageUsers' } },
    { path: 'manage-roles', name: 'admin-manage-roles', component: AdminManageRoles, meta: { permission: 'canManageRoles' } },
    { path: 'gift-cards', name: 'admin-gift-cards', component: AdminGiftCards, meta: { permission: 'canManageGiftCards' } },
    { path: 'petty-cash', name: 'admin-petty-cash', component: AdminPettyCash, meta: { permissions: ['canManageAllPettyCash', 'canManageOwnPettyCash'] } },
    { path: 'manage-stores', name: 'admin-manage-stores', component: AdminManageStores, meta: { permission: 'canManageStores' } },
    { path: 'manage-providers', name: 'admin-manage-providers', component: AdminManageProviders, meta: { permission: 'canManageProviders' } },
    { path: 'expenses', name: 'admin-expenses', component: AdminExpenses, meta: { permission: 'canReconcileExpenses' } },
]

const routes = [
    { path: '/login', name: 'login', component: LoginView },
    { path: '/vendor', name: 'vendor', component: VendorDashboard, meta: { requiresAuth: true } },
    {
      path: '/restaurant', component: RestaurantLayout, meta: { requiresAuth: true },
      children: [
        { path: '', redirect: { name: 'restaurant-gastos' } },
        { path: 'gastos', name: 'restaurant-gastos', component: RestaurantGastos },
        { path: 'petty-cash', name: 'restaurant-petty-cash', component: RestaurantPettyCash },
        { path: 'gift-cards', name: 'restaurant-gift-cards', component: RestaurantGiftCards },
      ]
    },
    {
      path: '/admin',
      component: AdminLayout,
      meta: { requiresAuth: true },
      children: [
        { path: '', name: 'admin-dashboard', component: AdminViewDeposits },
        ...adminRoutes
      ]
    },
    { path: '/', name: 'home', redirect: '/login' },
    { path: '/:pathMatch(.*)*', redirect: '/' }
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
})

router.beforeEach(async (to, from, next) => {
  const authStore = useAuthStore();
  
  if (!authStore.authInitialized) {
    await authStore.waitForAuthInit();
  }

  const isAuthenticated = authStore.isAuthenticated;
  const user = authStore.user;
  const permissions = user?.permissions || {};
  const roleId = user?.roleId?.id || '';

  if (to.meta.requiresAuth && !isAuthenticated) {
    return next({ name: 'login' });
  }

  if (isAuthenticated && to.name === 'login') {
     const hasManagementPermission = Object.values(permissions).some(v => v === true);
     
     if (roleId.includes('vendedor')) return next('/vendor');
     if (roleId.includes('restaurante')) return next('/restaurant');
     if (hasManagementPermission) return next('/admin');
     
     await authStore.handleLogout();
     return next({ name: 'login'});
  }
  
  if (to.name === 'admin-dashboard') {
    const firstAllowedRoute = adminRoutes.find(r => {
        if (r.meta.permission) return permissions[r.meta.permission];
        if (r.meta.permissions) return r.meta.permissions.some(p => permissions[p]);
        return false;
    });
    if (firstAllowedRoute) {
        return next({ name: firstAllowedRoute.name });
    }
  }

  const requiredPermission = to.meta.permission;
  if (requiredPermission && !permissions[requiredPermission]) {
      return next('/admin');
_
  }
  
  const requiredPermissions = to.meta.permissions;
  if (requiredPermissions && !requiredPermissions.some(p => permissions[p])) {
      return next('/admin');
  }

  next();
})

export default router