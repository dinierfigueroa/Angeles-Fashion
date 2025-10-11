import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/authStore'

/* Auth / layouts */
import LoginView from '@/views/LoginView.vue'
import AdminLayout from '@/views/admin/AdminLayout.vue'

/* Admin vistas existentes */
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
import AdminReconciliationQueue from '@/views/admin/AdminReconciliationQueue.vue'

/* 🆕 Reportes (ubicados en views/admin/reports) */
import AdminReports from '@/views/admin/reports/AdminReports.vue'
import AdminDailyReports from '@/views/admin/reports/AdminDailyReports.vue'

/* 🆕 STORE (módulo para tiendas) */
import StoreLayout from '@/views/store/StoreLayout.vue'
import StoreDailyReport from '@/views/store/StoreDailyReport.vue'

/* Rutas hijas del módulo Admin */
export const adminRoutes = [
  { path: 'upload-deposits',     name: 'admin-upload-deposits',  component: AdminUploadDeposits,   meta: { permission: 'canUploadDeposits' } },
  { path: 'upload-shopify',      name: 'admin-upload-shopify',   component: AdminUploadShopify,    meta: { permission: 'canUploadDeposits' } },
  { path: 'view-deposits',       name: 'admin-view-deposits',    component: AdminViewDeposits,     meta: { permissions: ['canViewAllDeposits', 'canViewScopedDeposits'] } },
  { path: 'manage-users',        name: 'admin-manage-users',     component: AdminManageUsers,      meta: { permission: 'canManageUsers' } },
  { path: 'manage-roles',        name: 'admin-manage-roles',     component: AdminManageRoles,      meta: { permission: 'canManageRoles' } },
  { path: 'gift-cards',          name: 'admin-gift-cards',       component: AdminGiftCards,        meta: { permission: 'canManageGiftCards' } },
  { path: 'petty-cash',          name: 'admin-petty-cash',       component: AdminPettyCash,        meta: { permissions: ['canManageAllPettyCash', 'canManageOwnPettyCash'] } },
  { path: 'manage-stores',       name: 'admin-manage-stores',    component: AdminManageStores,     meta: { permission: 'canManageStores' } },
  { path: 'manage-providers',    name: 'admin-manage-providers', component: AdminManageProviders,  meta: { permission: 'canManageProviders' } },
  { path: 'expenses',            name: 'admin-expenses',         component: AdminExpenses,         meta: { permission: 'canReconcileExpenses' } },
  { path: 'reconciliation',      name: 'admin-reconciliation',   component: AdminReconciliationQueue, meta: { permission: 'canUploadDeposits' } },

  /* 👇 NUEVOS reportes */
  { path: 'reports',             name: 'admin-reports',          component: AdminReports,          meta: { permission: 'canViewReports' } },
  { path: 'daily-reports',       name: 'admin-daily-reports',    component: AdminDailyReports,     meta: { permission: 'canReviewDailyReports' } },
]

const routes = [
  { path: '/login', name: 'login', component: LoginView },

  /* 🆕 Módulo Store (para TIENDAS, no restaurante) */
  {
    path: '/store',
    component: StoreLayout,
    meta: { requiresAuth: true },
    children: [
      { path: '', redirect: { name: 'store-daily-report' } },
      { path: 'daily-report', name: 'store-daily-report', component: StoreDailyReport, meta: { requiresAuth: true } },
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

  { path: '/', name: 'home', redirect: '/login' },
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

  if (isAuthenticated && to.name === 'login') {
    const hasManagementPermission = Object.values(permissions).some(v => v === true)

    // redirecciones por rol
    if (roleId.includes('vendedor'))       return next('/vendor')               // si lo usas
    if (roleId.includes('restaurante'))    return next('/restaurant')           // si lo usas
    if (roleId.includes('tienda'))         return next('/store')                // TIENDAS
    if (hasManagementPermission)           return next('/admin')

    await authStore.handleLogout()
    return next({ name: 'login' })
  }

  if (to.name === 'admin-dashboard') {
    // Primer ruta admin permitida
    const firstAllowed = adminRoutes.find(r => {
      if (r.meta?.permission)  return !!permissions[r.meta.permission]
      if (r.meta?.permissions) return r.meta.permissions.some(p => !!permissions[p])
      return false
    })
    if (firstAllowed) return next({ name: firstAllowed.name })
  }

  // Guards por permisos puntuales
  if (to.meta.permission && !permissions[to.meta.permission]) {
    return next('/admin')
  }
  if (to.meta.permissions && !to.meta.permissions.some(p => permissions[p])) {
    return next('/admin')
  }

  next()
})

export default router