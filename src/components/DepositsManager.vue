<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import { db, auth } from '@/firebase';
import { collection, query, onSnapshot, orderBy, where, Timestamp, doc, getDocs, limit, updateDoc, arrayUnion, serverTimestamp, deleteField } from 'firebase/firestore';
import { useAuthStore } from '@/stores/authStore';
import AlertModal from '@/components/modals/AlertModal.vue';
import ReserveDepositModal from '@/components/modals/ReserveDepositModal.vue';
import LiquidateDepositModal from '@/components/modals/LiquidateDepositModal.vue';
import DepositHistoryModal from '@/components/modals/DepositHistoryModal.vue';

const props = defineProps({
  userRole: { type: String, required: true },
  userId: { type: String, default: null },
  storeId: { type: String, default: null },
});

const authStore = useAuthStore();
const deposits = ref([]);
const isLoading = ref(true);
const finalizedStatuses = ref([]);
let unsubscribe = null;

const getInitialDateRange = () => {
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return {
        startDate: firstDay.toISOString().split('T')[0],
        endDate: lastDay.toISOString().split('T')[0]
    };
};

const filters = ref({
    status: 'disponible',
    bank: 'todos',
    searchTerm: '',
    ...getInitialDateRange()
});

const isAlertOpen = ref(false);
const alertMessage = ref('');
const isReserveModalOpen = ref(false);
const isLiquidateModalOpen = ref(false);
const isHistoryModalOpen = ref(false);
const selectedDeposit = ref(null);
const modalAction = ref('liquidate');
const isDirectLiquidation = ref(false);

const filteredDeposits = computed(() => {
    if (!filters.value.searchTerm) return deposits.value;
    const search = filters.value.searchTerm.toLowerCase();
    return deposits.value.filter(d => 
        d.description?.toLowerCase().includes(search) ||
        d.vendorName?.toLowerCase().includes(search) ||
        String(d.amount).includes(search)
    );
});

watch(filters, () => {
    fetchDeposits();
}, { deep: true });

const fetchFinalizedStatuses = async () => {
    try {
        const q = query(collection(db, "statuses"), limit(1));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
            const statusData = querySnapshot.docs[0].data();
            if (statusData.estados && Array.isArray(statusData.estados)) {
                finalizedStatuses.value = statusData.estados.map(s => s.toLowerCase().replace(/ /g, '-'));
            }
        }
    } catch (error) { console.error("Error al cargar estados finalizados:", error); }
};

const fetchDeposits = () => {
    isLoading.value = true;
    if (unsubscribe) unsubscribe();

    let constraints = [];
    const statusValue = filters.value.status;
    const userRole = props.userRole;

    if (userRole === 'vendor' && (statusValue === 'reservado' || statusValue === 'liquidado')) {
        constraints.push(where('vendorId', '==', doc(db, 'users', props.userId)));
    }
    if (userRole === 'store' && (statusValue === 'reservado' || statusValue === 'liquidado')) {
        constraints.push(where('storeId', '==', doc(db, 'stores', props.storeId)));
    }

    if (statusValue !== 'todos') {
        if (statusValue === 'liquidado') {
            const statusesToQuery = finalizedStatuses.value.length > 0 ? finalizedStatuses.value : ["liquidado"];
            constraints.push(where('status', 'in', statusesToQuery));
        } else {
            constraints.push(where('status', '==', statusValue));
        }
    }

    if (filters.value.bank !== 'todos') constraints.push(where('bank', '==', filters.value.bank));
    if (filters.value.startDate) constraints.push(where('transactionDate', '>=', Timestamp.fromDate(new Date(filters.value.startDate))));
    if (filters.value.endDate) constraints.push(where('transactionDate', '<=', Timestamp.fromDate(new Date(filters.value.endDate + 'T23:59:59'))));

    constraints.push(orderBy('transactionDate', 'desc'));
    if (statusValue === 'liquidado') {
        constraints.unshift(orderBy('status'));
    }

    const q = query(collection(db, "deposits"), ...constraints);
    unsubscribe = onSnapshot(q, snapshot => {
        deposits.value = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        isLoading.value = false;
    }, error => {
        console.error("Error fetching deposits:", error);
        showAlert(`Error al cargar depósitos. Es posible que necesites crear un índice en Firestore (revisa la consola F12).`);
        isLoading.value = false;
    });
};

onMounted(async () => {
    await fetchFinalizedStatuses();
    fetchDeposits();
});

onUnmounted(() => { if (unsubscribe) unsubscribe(); });

const openReserveModal = (deposit) => { selectedDeposit.value = deposit; isReserveModalOpen.value = true; };
const openLiquidateModal = (deposit, isDirect = false) => { selectedDeposit.value = deposit; modalAction.value = 'liquidate'; isDirectLiquidation.value = isDirect; isLiquidateModalOpen.value = true; };
const openRevertModal = (deposit) => { selectedDeposit.value = deposit; modalAction.value = 'revert'; isLiquidateModalOpen.value = true; };
const openHistoryModal = (deposit) => { selectedDeposit.value = deposit; isHistoryModalOpen.value = true; };
const handleVendorReserve = async (deposit) => {
    const confirmation = confirm("¿Estás seguro de que quieres reservar este depósito para ti?");
    if (!confirmation) return;
    try {
        const depositRef = doc(db, "deposits", deposit.id);
        const user = authStore.user;
        const historyEntry = {
            action: 'Reservado', user: doc(db, 'users', user.uid), userName: user.display_name,
            timestamp: Timestamp.now(), details: `Reservado por el mismo vendedor`
        };
        await updateDoc(depositRef, {
            status: "reservado", vendorId: doc(db, "users", user.uid), vendorName: user.display_name,
            storeId: user.storeId, storeName: user.storeName || '',
            reservationDate: serverTimestamp(), history: arrayUnion(historyEntry)
        });
        showAlert("Depósito reservado con éxito.");
    } catch(error) {
        console.error("Error al auto-reservar:", error);
        showAlert("No se pudo reservar el depósito.");
    }
};

const handleDepositUpdated = (message) => { showAlert(message); };
const formatCurrency = (value) => new Intl.NumberFormat('es-HN', { style: 'currency', currency: 'HNL' }).format(value || 0);
const getStatusBadgeClass = (status) => {
    if (!status) return 'bg-yellow-100 text-yellow-800';
    const s = status.toLowerCase();
    if (finalizedStatuses.value.includes(s)) return 'bg-green-100 text-green-800';
    if (s.includes('reservado')) return 'bg-yellow-100 text-yellow-800';
    if (s.includes('disponible')) return 'bg-blue-100 text-blue-800';
    return 'bg-gray-100 text-gray-800';
};
const formatStatus = (status) => {
    if (!status) return 'Pendiente';
    return status.replace(/-/g, ' ');
};
const showAlert = (msg) => { alertMessage.value = msg; isAlertOpen.value = true; };
</script>


<template>
  <div class="space-y-6">
    <div class="bg-white p-6 rounded-lg shadow">
      <h2 class="text-2xl font-bold text-gray-800 mb-4">Filtros de Depósitos</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700">Estado</label>
          <select v-model="filters.status" class="mt-1 block w-full pl-3 pr-10 py-2 border-gray-300 rounded-md">
            <option value="disponible">Disponible</option>
            <option value="reservado">{{ userRole === 'vendor' ? 'Mis Reservas' : 'Reservados' }}</option>
            <option value="liquidado">{{ userRole === 'vendor' ? 'Mis Liquidados' : 'Finalizados' }}</option>
            <option v-if="userRole !== 'vendor'" value="todos">Todos</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700">Banco</label>
          <select v-model="filters.bank" class="mt-1 block w-full pl-3 pr-10 py-2 border-gray-300 rounded-md">
            <option value="todos">Todos los Bancos</option>
            <option value="BAC Credomatic">BAC Credomatic</option>
            <option value="ATLANTIDA">ATLANTIDA</option>
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
            <input type="text" v-model="filters.searchTerm" placeholder="Buscar por descripción, vendedor, monto..." class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md">
        </div>
      </div>
    </div>

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
            <tr v-if="isLoading"><td colspan="7" class="text-center py-4 text-gray-500">Cargando depósitos...</td></tr>
            <tr v-else-if="filteredDeposits.length === 0"><td colspan="7" class="text-center py-4 text-gray-500">No se encontraron depósitos.</td></tr>
            <tr v-for="d in filteredDeposits" :key="d.id">
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                <div class="font-medium text-gray-800">Dep: {{ d.transactionDate.toDate().toLocaleDateString('es-HN') }}</div>
                <div v-if="d.status === 'reservado' && d.reservationDate" class="text-xs text-gray-500 mt-1">Res: {{ d.reservationDate.toDate().toLocaleString('es-HN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }}</div>
                <div v-if="d.status && finalizedStatuses.includes(d.status) && d.liquidationDate" class="text-xs text-green-600 mt-1">Liq: {{ d.liquidationDate.toDate().toLocaleString('es-HN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }}</div>
              </td>
              <td class="px-6 py-4 text-sm text-gray-900">{{ d.description }}</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm">
                <div class="font-medium text-gray-900">{{ formatCurrency(d.amount) }}</div>
                <div v-if="d.status && finalizedStatuses.includes(d.status)" class="text-xs mt-1 space-y-1">
                    <div class="text-gray-500">Pedido: {{ formatCurrency(d.orderTotal) }}</div>
                    <div :class="d.diferencia >= 0 ? 'text-green-600' : 'text-red-600'">Dif: {{ formatCurrency(d.diferencia) }}</div>
                </div>
              </td>
              <td class="px-6 py-4 whitespace-nowrap text-sm"><span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full capitalize" :class="getStatusBadgeClass(d.status)">{{ formatStatus(d.status) }}</span></td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{{ d.vendorName || '---' }}</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{{ d.storeName || '---' }}</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                <button v-if="d.status === 'disponible' && (userRole === 'admin' || userRole === 'store')" @click="openReserveModal(d)" class="text-indigo-600 hover:text-indigo-900">Reservar</button>
                <button v-if="d.status === 'disponible' && userRole === 'vendor'" @click="handleVendorReserve(d)" class="text-indigo-600 hover:text-indigo-900">Reservar</button>
                
                <button v-if="d.status === 'disponible'" @click="openLiquidateModal(d, true)" class="text-green-600 hover:text-green-900">Liquidar</button>
                <button v-if="d.status === 'reservado'" @click="openLiquidateModal(d, false)" class="text-green-600 hover:text-green-900">Liquidar</button>
                
                <button v-if="userRole === 'admin' && d.status && finalizedStatuses.includes(d.status)" @click="openRevertModal(d)" class="text-red-600 hover:text-red-900">Revertir</button>
                <button @click="openHistoryModal(d)" class="text-gray-500 hover:text-gray-800 inline-block align-middle" title="Ver Historial">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.414-1.415L11 9.586V6z" clip-rule="evenodd" /></svg>
                </button>
                </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    
    <AlertModal v-model="isAlertOpen" :message="alertMessage" />
    <ReserveDepositModal v-model="isReserveModalOpen" :deposit="selectedDeposit" @deposit-updated="handleDepositUpdated" />
    <LiquidateDepositModal v-model="isLiquidateModalOpen" :deposit="selectedDeposit" :action="modalAction" :direct-liquidation="isDirectLiquidation" @deposit-updated="handleDepositUpdated" />
    <DepositHistoryModal v-model="isHistoryModalOpen" :deposit="selectedDeposit" />
  </div>
</template>