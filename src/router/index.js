import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/authStore'

import LoginView from '@/views/LoginView.vue'
import AdminLayout from '@/views/admin/AdminLayout.vue'
import AdminUploadDeposits from '@/views/admin/AdminUploadDeposits.vue'
import AdminUploadShopify from '@/views/admin/AdminUploadShopify.vue'
import AdminViewDeposits from '@/views/admin/AdminViewDeposits.vue'
import AdminManageUsers from '@/views/admin/AdminManageUsers.vue'
import AdminManageRoles from '@/views/admin/AdminManageRoles.vue'
import AdminGiftCards from '@/views/admin/AdminGiftCards.vue'
import AdminPettyCash from '@/views/admin/AdminPettyCash.vue'
import AdminManageStores from '@/views/admin/AdminManageStores.vue'
import AdminManageProviders from '@/views/admin/AdminManageProviders.vue'
import AdminExpenses from '@/views/admin/AdminExpenses.vue'
import VendorDashboard from '@/views/vendor/VendorDashboard.vue'

/* Restaurante (se queda igual, ya SIN daily-report) */
import RestaurantLayout from '@/views/restaurant/RestaurantLayout.vue'
import RestaurantGastos from '@/views/restaurant/RestaurantGastos.vue'
import RestaurantPettyCash from '@/views/restaurant/RestaurantPettyCash.vue'
import RestaurantGiftCards from '@/views/restaurant/RestaurantGiftCards.vue'

/* === STORE (nuevo módulo para TIENDAS) === */
import StoreLayout from '@/views/store/StoreLayout.vue'
import StoreDailyReport from '@/views/store/StoreDailyReport.vue'

/* Admin extra */
import AdminReconciliationQueue from '@/views/admin/AdminReconciliationQueue.vue'
import AdminReports from '@/views/admin/reports/AdminDailyReports.vue'

export const adminRoutes = [
  { path: 'upload-deposits', name: 'admin-upload-deposits', component: AdminUploadDeposits, meta: { permission: 'canUploadDeposits' } },
  { path: 'upload-shopify',  name: 'admin-upload-shopify',  component: AdminUploadShopify,  meta: { permission: 'canUploadDeposits' } },
  { path: 'view-deposits',   name: 'admin-view-deposits',   component: AdminViewDeposits,  meta: { permissions: ['canViewAllDeposits', 'canViewScopedDeposits'] } },
  { path: 'manage-users',    name: 'admin-manage-users',    component: AdminManageUsers,   meta: { permission: 'canManageUsers' } },
  { path: 'manage-roles',    name: 'admin-manage-roles',    component: AdminManageRoles,   meta: { permission: 'canManageRoles' } },
  { path: 'gift-cards',      name: 'admin-gift-cards',      component: AdminGiftCards,     meta: { permission: 'canManageGiftCards' } },
  { path: 'petty-cash',      name: 'admin-petty-cash',      component: AdminPettyCash,     meta: { permissions: ['canManageAllPettyCash', 'canManageOwnPettyCash'] } },
  { path: 'manage-stores',   name: 'admin-manage-stores',   component: AdminManageStores,  meta: { permission: 'canManageStores' } },
  { path: 'manage-providers',name: 'admin-manage-providers',component: AdminManageProviders,meta: { permission: 'canManageProviders' } },
  { path: 'expenses',        name: 'admin-expenses',        component: AdminExpenses,      meta: { permission: 'canReconcileExpenses' } },
  { path: 'reconciliation',  name: 'admin-reconciliation',  component: AdminReconciliationQueue, meta: { permission: 'canUploadDeposits' } },
  { path: 'reports',         name: 'admin-reports',         component: AdminReports,       meta: { permission: 'canViewReports' } },
]

const routes = [
  { path: '/login', name: 'login', component: LoginView },
  { path: '/vendor', name: 'vendor', component: VendorDashboard, meta: { requiresAuth: true } },

  /* Restaurante (sin daily-report aquí) */
  {
    path: '/restaurant',
    component: RestaurantLayout,
    meta: { requiresAuth: true },
    children: [
      { path: '', redirect: { name: 'restaurant-gastos' } },
      { path: 'gastos',       name: 'restaurant-gastos',       component: RestaurantGastos },
      { path: 'petty-cash',   name: 'restaurant-petty-cash',   component: RestaurantPettyCash },
      { path: 'gift-cards',   name: 'restaurant-gift-cards',   component: RestaurantGiftCards },
    ]
  },

  /* TIENDAS */
  {
    path: '/store',
    component: StoreLayout,
    meta: { requiresAuth: true },
    children: [
      { path: '', redirect: { name: 'store-daily-report' } },
      { path: 'daily-report', name: 'store-daily-report', component: StoreDailyReport },
    ]
  },

  /* Admin */
  {
    path: '/admin',
    component: AdminLayout,
    meta: { requiresAuth: true },
    children: [
      { path: '', name: 'admin-dashboard', component: AdminViewDeposits },
      ...adminRoutes
    ]
  },

  { path: '/', redirect: '/login' },
  { path: '/:pathMatch(.*)*', redirect: '/' }
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
})

router.beforeEach(async (to, from, next) => {
  const authStore = useAuthStore()

  if (!authStore.authInitialized) {
    await authStore.waitForAuthInit()
  }

  const isAuthenticated = authStore.isAuthenticated
  const user = authStore.user
  const permissions = user?.permissions || {}
  const roleId = (user?.roleId?.id || '').toLowerCase()

  if (to.meta.requiresAuth && !isAuthenticated) {
    return next({ name: 'login' })
  }

  // Redirección tras login
  if (isAuthenticated && to.name === 'login') {
    const hasManagementPermission = Object.values(permissions).some(v => v === true)

    // TIENDAS
    if (roleId.includes('admindetienda') || roleId.includes('operadortienda')) {
      return next('/store/daily-report')
    }

    // Restaurante (si aplica)
    if (roleId.includes('restaurante')) return next('/restaurant')

    // Admin
    if (hasManagementPermission) return next('/admin')

    await authStore.handleLogout()
    return next({ name: 'login' })
  }

  next()
})

export default router