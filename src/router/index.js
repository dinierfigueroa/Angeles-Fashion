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

/* Reportes (ubicados en views/admin/reports) */
import AdminReports from '@/views/admin/reports/AdminReports.vue'
import AdminDailyReports from '@/views/admin/reports/AdminDailyReports.vue'

/* STORE (módulo para tiendas) */
import StoreLayout from '@/views/store/StoreLayout.vue'
import StoreDailyReport from '@/views/store/StoreDailyReport.vue'

/* ----------------- Helpers permisos ----------------- */
function normalizeBool(v) {
  if (v === true || v === false) return v
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (s === 'true') return true
    if (s === 'false') return false
  }
  return !!v
}
function mergePermissions(user) {
  const pUser = user?.permissions || {}
  const pRoleLegacy = user?.rolePermissions || {}              // por si guardaste permisos “aplanados” del rol
  const pRoleObj = user?.role?.permissions || {}               // por si embebiste el rol en el user
  // Si usas roleId para leer un doc de rol aparte, ya dependería de tu store; aquí solo unimos lo que venga en user.
  const merged = { ...pRoleObj, ...pRoleLegacy, ...pUser }
  const normalized = {}
  for (const [k, v] of Object.entries(merged)) normalized[k] = normalizeBool(v)
  return normalized
}
function isSuper(user) {
  return (user?.roleId?.id || '').toLowerCase().includes('super')
}

/* ----------------- Rutas hijas del módulo Admin ----------------- */
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

  /* Reportes */
  { path: 'reports',             name: 'admin-reports',          component: AdminReports,          meta: { permission: 'canViewReports' } },
  { path: 'daily-reports',       name: 'admin-daily-reports',    component: AdminDailyReports,     meta: { permission: 'canReviewDailyReports' } },
]

const routes = [
  { path: '/login', name: 'login', component: LoginView },

  /* Módulo Store (TIENDAS) */
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
  const roleId = (user?.roleId?.id || '').toLowerCase()
  const permissions = mergePermissions(user)

  // --------- Bloqueo por auth ---------
  const requiresAuth =
    to.meta?.requiresAuth === true ||
    to.matched.some(r => r.meta?.requiresAuth === true)

  if (requiresAuth && !isAuthenticated) {
    if (import.meta.env.DEV) console.warn('[ROUTER] Bloqueado por auth')
    return next({ name: 'login' })
  }

  // --------- Login -> redirecciones por rol ---------
  if (isAuthenticated && to.name === 'login') {
    const hasManagementPermission = Object.values(permissions).some(v => v === true)

    if (roleId.includes('vendedor'))    return next('/vendor')     // si lo usas
    if (roleId.includes('restaurante')) return next('/restaurant') // si lo usas
    if (roleId.includes('tienda'))      return next('/store')      // TIENDAS
    if (hasManagementPermission)        return next('/admin')

    await authStore.handleLogout()
    return next({ name: 'login' })
  }

  // --------- Redirección del dashboard admin a la primera ruta permitida ---------
  if (to.name === 'admin-dashboard') {
    const firstAllowed = adminRoutes.find(r => {
      if (r.meta?.permission)  return !!permissions[r.meta.permission]
      if (r.meta?.permissions) return r.meta.permissions.some(p => !!permissions[p])
      return false
    })
    if (firstAllowed) return next({ name: firstAllowed.name })
  }

  // --------- Guards por permisos puntuales ---------
  // Fallback especial para "admin-reports" (igual que en tu Sidebar)
  if (to.name === 'admin-reports') {
    if (
      permissions.canViewReports ||
      permissions.canViewAllDeposits ||
      permissions.canUploadDeposits
    ) {
      return next()
    } else {
      if (import.meta.env.DEV) console.warn('[ROUTER] Bloqueado admin-reports por permisos')
      return next('/admin')
    }
  }

  // Regla general
  if (to.meta.permission && !permissions[to.meta.permission] && !isSuper(user)) {
    if (import.meta.env.DEV) console.warn('[ROUTER] Bloqueado por permission:', to.meta.permission, permissions)
    return next('/admin')
  }
  if (to.meta.permissions && !to.meta.permissions.some(p => permissions[p]) && !isSuper(user)) {
    if (import.meta.env.DEV) console.warn('[ROUTER] Bloqueado por alguno de:', to.meta.permissions, permissions)
    return next('/admin')
  }

  next()
})

export default router
