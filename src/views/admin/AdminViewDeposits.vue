<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { db } from '@/firebase';
import {
  collection, query, onSnapshot, orderBy, where, Timestamp,
  getDocs, limit as fsLimit, deleteDoc, doc as fsDoc
} from 'firebase/firestore';
import { useAuthStore } from '@/stores/authStore';

import AlertModal from '@/components/modals/AlertModal.vue';
import ReserveDepositModal from '@/components/modals/ReserveDepositModal.vue';
import LiquidateDepositModal from '@/components/modals/LiquidateDepositModal.vue';
import RevertDepositModal from '@/components/modals/RevertDepositModal.vue';
import DepositHistoryModal from '@/components/modals/DepositHistoryModal.vue';

const STORAGE_KEY = 'af:deposits:filters:v2';

const authStore = useAuthStore();
const deposits = ref([]);
const isLoading = ref(true);
const finalizedStatuses = ref([]); // e.g. ['auto_liquidado','liquidado','devuelto']
let unsubscribe = null;

/* ===================== RANGO FECHA (mes actual) ===================== */
const getInitialDateRange = () => {
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return {
    startDate: firstDay.toISOString().split('T')[0],
    endDate: lastDay.toISOString().split('T')[0]
  };
};

/* ===================== FILTROS ===================== */
const defaultFilters = {
  status: 'todos', // 'disponible' | 'reservado' | 'liquidado' | 'auto_liquidado' | 'parcial' | 'devuelto' | 'todos'
  bank: 'todos',
  searchTerm: '',
  ...getInitialDateRange()
};

const loadSavedFilters = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaultFilters };
    const saved = JSON.parse(raw);
    return { ...defaultFilters, ...saved };
  } catch {
    return { ...defaultFilters };
  }
};

const filters = ref(loadSavedFilters());
watch(filters, (v) => localStorage.setItem(STORAGE_KEY, JSON.stringify(v)), { deep: true });

/* ===================== PERMISOS ===================== */
const userPermissions = computed(() => authStore.user?.permissions || {});
const userAccessibleStores = computed(() => authStore.user?.accessibleStores || []);

/* ===================== BÚSQUEDA EN CLIENTE ===================== */
const filteredDeposits = computed(() => {
  if (!filters.value.searchTerm) return deposits.value;
  const search = filters.value.searchTerm.toLowerCase();
  return deposits.value.filter(d =>
    (d.description || '').toLowerCase().includes(search) ||
    (d.vendorName || '').toLowerCase().includes(search) ||
    String(d.amount || '').includes(search)
  );
});

/* ===================== ESTADOS FINALIZADOS ===================== */
const fetchFinalizedStatuses = async () => {
  try {
    const q = query(collection(db, 'statuses'), fsLimit(1));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const statusData = snap.docs[0].data();
      if (Array.isArray(statusData.estados)) {
        finalizedStatuses.value = statusData.estados.map(s =>
          String(s).toLowerCase().replace(/ /g, '-')
        );
      }
    }
    if (finalizedStatuses.value.length === 0) {
      finalizedStatuses.value = ['auto_liquidado','liquidado','devuelto'];
    }
  } catch (e) {
    if (finalizedStatuses.value.length === 0) {
      finalizedStatuses.value = ['auto_liquidado','liquidado','devuelto'];
    }
    console.error('Error al cargar estados finalizados:', e);
  }
};

/* ===================== CARGA ===================== */
const fetchDeposits = () => {
  isLoading.value = true;
  if (unsubscribe) unsubscribe();

  const constraints = [];
  const statusValue = filters.value.status;

  if (!userPermissions.value.canViewAllDeposits) {
    if (userAccessibleStores.value.length > 0) {
      constraints.push(where('storeId', 'in', userAccessibleStores.value));
    } else if (statusValue !== 'disponible') {
      deposits.value = [];
      isLoading.value = false;
      return;
    }
  }

  if (statusValue && statusValue !== 'todos') {
    if (statusValue === 'disponible') constraints.push(where('status','in',['disponible','unmatched','partial']));
    else constraints.push(where('status','==',statusValue));
  }

  if (filters.value.bank !== 'todos') {
    constraints.push(where('bankKey','==',filters.value.bank));
  }

  if (filters.value.startDate) {
    constraints.push(where('transactionDate', '>=', Timestamp.fromDate(new Date(filters.value.startDate))));
  }
  if (filters.value.endDate) {
    constraints.push(where('transactionDate', '<=', Timestamp.fromDate(new Date(filters.value.endDate + 'T23:59:59'))));
  }

  constraints.push(orderBy('transactionDate','desc'));
  const qRef = query(collection(db, 'deposits'), ...constraints);

  unsubscribe = onSnapshot(qRef, snap => {
    let list = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // si “disponible”, garantizamos remanente > 0
    if (statusValue === 'disponible') {
      list = list.filter(x => {
        const rem = (x.remainingAmount ?? (Number(x.amount||0) - Number(x.matchedTotal||0)));
        return rem > 0.009;
      });
    }

    deposits.value = list;
    isLoading.value = false;
  }, err => {
    console.error('Error fetching deposits:', err);
    showAlert('Error al cargar depósitos. Tal vez falte un índice en Firestore (revisa consola F12).');
    isLoading.value = false;
  });
};

watch(filters, () => fetchDeposits(), { deep: true });

onMounted(async () => { await fetchFinalizedStatuses(); fetchDeposits(); });
onUnmounted(() => { if (unsubscribe) unsubscribe(); });

/* ===================== MODALES / ACCIONES ===================== */
const isAlertOpen = ref(false);
const alertMessage = ref('');

const isReserveModalOpen = ref(false);
const isLiquidateModalOpen = ref(false);
const isRevertModalOpen = ref(false);
const isHistoryModalOpen = ref(false);

const selectedDeposit = ref(null);

const openReserveModal = (deposit) => { selectedDeposit.value = deposit; isReserveModalOpen.value = true; };
const openLiquidateModal = (deposit) => { selectedDeposit.value = deposit; isLiquidateModalOpen.value = true; };
const openRevertModal = (deposit) => { selectedDeposit.value = deposit; isRevertModalOpen.value = true; };
const openHistoryModal = (deposit) => { selectedDeposit.value = deposit; isHistoryModalOpen.value = true; };
const handleDepositUpdated = (message) => { showAlert(message || 'Operación realizada'); };

const formatCurrency = (v) =>
  new Intl.NumberFormat('es-HN', { style: 'currency', currency: 'HNL' }).format(v || 0);

const getStatusBadgeClass = (status) => {
  if (!status) return 'bg-yellow-100 text-yellow-800';
  const s = String(status).toLowerCase();
  if (finalizedStatuses.value.includes(s)) return 'bg-green-100 text-green-800';
  if (s.includes('reserv')) return 'bg-yellow-100 text-yellow-800';
  if (s.includes('unmatched') || s.includes('partial') || s.includes('disponible')) return 'bg-blue-100 text-blue-800';
  return 'bg-gray-100 text-gray-800';
};

const formatStatus = (s) => !s ? 'Pendiente' : String(s).replace(/-/g,' ');

const showAlert = (msg) => { alertMessage.value = msg; isAlertOpen.value = true; };

/* Eliminar */
const isFinalized = (d) => d?.status && finalizedStatuses.value.includes(String(d.status).toLowerCase());
async function deleteDeposit(d) {
  try {
    const isSuper = (authStore.user?.roleId?.id || '').toLowerCase().includes('super');
    if (!isSuper && !userPermissions.value?.canDeleteDeposits) {
      return showAlert('No tienes permiso para eliminar depósitos.');
    }
    if (isFinalized(d)) {
      return showAlert('Este depósito ya está finalizado. Reviértelo primero para poder eliminarlo.');
    }
    const yes = confirm(`¿Eliminar el depósito por L ${Number(d.amount).toFixed(2)}?`);
    if (!yes) return;
    await deleteDoc(fsDoc(db, 'deposits', d.id));
    showAlert('Depósito eliminado.');
  } catch (e) {
    console.error(e);
    showAlert('No se pudo eliminar el depósito.');
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Filtros -->
    <div class="bg-white p-6 rounded-lg shadow">
      <h2 class="text-2xl font-bold text-gray-800 mb-4">Filtros de Depósitos</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700">Estado</label>
          <select v-model="filters.status" class="mt-1 block w-full pl-3 pr-10 py-2 border-gray-300 rounded-md">
            <option value="todos">Todos</option>
            <option value="disponible">Disponible</option>
            <option value="reservado">Reservado</option>
            <option value="parcial">Parcial</option>
            <option value="liquidado">Liquidado</option>
            <option value="auto_liquidado">Auto Liquidado</option>
            <option value="devuelto">Devuelto</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700">Banco</label>
          <select v-model="filters.bank" class="mt-1 block w-full pl-3 pr-10 py-2 border-gray-300 rounded-md">
            <option value="todos">Todos los Bancos</option>
            <option value="BAC">BAC</option>
            <option value="ATLANTIDA">ATLÁNTIDA</option>
            <option value="FICOHSA">FICOHSA</option>
            <option value="BANRURAL">BANRURAL</option>
            <option value="OCCIDENTE">OCCIDENTE</option>
            <option value="BANPAIS">BANPAIS</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700">Desde</label>
          <input type="date" v-model="filters.startDate" class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700">Hasta</label>
          <input type="date" v-model="filters.endDate" class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md">
        </div>
        <div class="md:col-span-2 lg:col-span-4">
          <label class="block text-sm font-medium text-gray-700">Buscar</label>
          <input
            type="text"
            v-model="filters.searchTerm"
            placeholder="Descripción, vendedor, monto..."
            class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
          >
        </div>
      </div>
    </div>

    <!-- Tabla -->
    <div class="bg-white p-6 rounded-lg shadow">
      <h2 class="text-2xl font-bold text-gray-800 mb-4">Resultados</h2>
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fecha</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Descripción</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Monto</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Vendedor</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tienda</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Acciones</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            <tr v-if="isLoading">
              <td colspan="7" class="text-center py-4 text-gray-500">Cargando depósitos...</td>
            </tr>
            <tr v-else-if="filteredDeposits.length === 0">
              <td colspan="7" class="text-center py-4 text-gray-500">No se encontraron depósitos con los filtros actuales.</td>
            </tr>

            <tr v-for="d in filteredDeposits" :key="d.id">
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                <div class="font-medium text-gray-800">
                  Dep: {{ d.transactionDate?.toDate ? d.transactionDate.toDate().toLocaleDateString('es-HN') : '' }}
                </div>
                <div v-if="(String(d.status||'').toLowerCase()==='reservado') && d.reservationDate" class="text-xs text-gray-500 mt-1">
                  Res: {{ d.reservationDate.toDate().toLocaleString('es-HN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) }}
                </div>
                <div v-if="d.status && ['liquidado','auto_liquidado','devuelto'].includes(String(d.status).toLowerCase()) && d.liquidationDate" class="text-xs text-green-600 mt-1">
                  Liq: {{ d.liquidationDate.toDate().toLocaleString('es-HN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) }}
                </div>
              </td>

              <td class="px-6 py-4 text-sm text-gray-900">{{ d.description || '—' }}</td>

              <td class="px-6 py-4 whitespace-nowrap text-sm">
                <div class="font-medium text-gray-900">{{ formatCurrency(d.amount) }}</div>
                <div v-if="['liquidado','auto_liquidado','devuelto'].includes(String(d.status||'').toLowerCase())" class="text-xs mt-1 space-y-1">
                  <div class="text-gray-500">Pedido: {{ formatCurrency(d.orderTotal || 0) }}</div>
                  <div :class="(d.diferencia ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'">
                    Dif: {{ formatCurrency(d.diferencia || 0) }}
                  </div>
                </div>
              </td>

              <td class="px-6 py-4 whitespace-nowrap text-sm">
                <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full capitalize"
                      :class="getStatusBadgeClass(d.status)">
                  {{ formatStatus(d.status) }}
                </span>
              </td>

              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{{ d.vendorName || '---' }}</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{{ d.storeName || '---' }}</td>

              <td class="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-3">
                <!-- Reservar -->
                <button
                  v-if="['disponible','unmatched','partial'].includes(String(d.status||'').toLowerCase())"
                  @click="openReserveModal(d)"
                  class="text-indigo-600 hover:text-indigo-900"
                >Reservar</button>

                <!-- Conciliar / Devolver -->
                <button
                  v-if="['disponible','unmatched','partial','reservado'].includes(String(d.status||'').toLowerCase())"
                  @click="openLiquidateModal(d)"
                  class="text-green-600 hover:text-green-900"
                >Conciliar / Devolver</button>

                <!-- Revertir -->
                <button
                  v-if="['liquidado','auto_liquidado','devuelto','parcial'].includes(String(d.status||'').toLowerCase())"
                  @click="openRevertModal(d)"
                  class="text-red-600 hover:text-red-900"
                >Revertir</button>

                <!-- Historial -->
                <button @click="openHistoryModal(d)" class="text-gray-500 hover:text-gray-800 inline-block align-middle" title="Ver Historial">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.414-1.415L11 9.586V6z" clip-rule="evenodd" />
                  </svg>
                </button>

                <!-- Eliminar -->
                <button
                  v-if="(authStore.user?.roleId?.id || '').toLowerCase().includes('super') || userPermissions.canDeleteDeposits"
                  @click="deleteDeposit(d)"
                  class="text-gray-400 hover:text-gray-700"
                  title="Eliminar depósito"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 7h12l-1 14H7L6 7zm3-3h6l1 2H8l1-2z"/>
                  </svg>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Modales -->
    <AlertModal v-model="isAlertOpen" :message="alertMessage" />
    <ReserveDepositModal
      v-model="isReserveModalOpen"
      :deposit="selectedDeposit"
      :store-id-filter="!userPermissions.canViewAllDeposits ? userAccessibleStores.map(ref => ref.id) : null"
      @deposit-updated="handleDepositUpdated"
    />
    <LiquidateDepositModal
      v-model="isLiquidateModalOpen"
      :deposit="selectedDeposit"
      @done="handleDepositUpdated('Conciliación realizada')"
    />
    <RevertDepositModal
      v-model="isRevertModalOpen"
      :deposit="selectedDeposit"
      @done="handleDepositUpdated('Depósito revertido')"
    />
    <DepositHistoryModal v-model="isHistoryModalOpen" :deposit="selectedDeposit" />
  </div>
</template>
