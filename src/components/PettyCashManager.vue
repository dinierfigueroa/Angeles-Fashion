<script setup>
import { ref, onUnmounted, watch, computed } from 'vue';
import { db, auth } from '@/firebase';
import { doc, onSnapshot, collection, query, where, orderBy, writeBatch, serverTimestamp, getDoc } from 'firebase/firestore';
import PettyCashEntryModal from '@/components/modals/PettyCashEntryModal.vue';
import AlertModal from '@/components/modals/AlertModal.vue';
import { useAuthStore } from '@/stores/authStore';

const props = defineProps({
  storeId: {
    type: String,
    required: true
  }
});

const storeData = ref(null);
const entries = ref([]);
const isLoading = ref(true);
const isProcessing = ref(false);
const authStore = useAuthStore();
let unsubscribeStore = null;
let unsubscribeEntries = null;

const isModalOpen = ref(false);
const isAlertOpen = ref(false);
const alertMessage = ref('');

const unreimbursedExpensesTotal = computed(() => {
    return entries.value
        .filter(e => e.type === 'gasto' && !e.reimbursed)
        .reduce((total, entry) => total + entry.amount, 0);
});

// --- INICIO DE LA NUEVA LÓGICA DE CÁLCULO ---
const calculatedCurrentBalance = computed(() => {
    if (!storeData.value) return 0;
    const initial = storeData.value.initialPettyCashBalance || 0;
    
    const total = entries.value.reduce((balance, entry) => {
        if (entry.type === 'gasto') {
            return balance - entry.amount;
        }
        if (entry.type === 'reembolso' || entry.type === 'ingreso') {
            return balance + entry.amount;
        }
        return balance;
    }, initial);

    return total;
});
// --- FIN DE LA NUEVA LÓGICA DE CÁLCULO ---


const fetchData = () => {
    if (!props.storeId) return;
    isLoading.value = true;
    if (unsubscribeStore) unsubscribeStore();
    if (unsubscribeEntries) unsubscribeEntries();

    const storeRef = doc(db, "stores", props.storeId);
    unsubscribeStore = onSnapshot(storeRef, (docSnap) => {
        storeData.value = docSnap.exists() ? docSnap.data() : null;
    });

    const entriesQuery = query(collection(db, "pettyCashEntries"), where("storeId", "==", props.storeId), orderBy("entryDate", "desc"));
    unsubscribeEntries = onSnapshot(entriesQuery, (snapshot) => {
        entries.value = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        isLoading.value = false;
    });
};

watch(() => props.storeId, fetchData, { immediate: true });

onUnmounted(() => {
    if (unsubscribeStore) unsubscribeStore();
    if (unsubscribeEntries) unsubscribeEntries();
});

const openModal = () => {
    isModalOpen.value = true;
};

const handleReimbursement = async () => {
    const amountToReimburse = unreimbursedExpensesTotal.value;
    if (amountToReimburse <= 0) {
        showAlert("No hay gastos pendientes para reembolsar.");
        return;
    }
    const unreimbursedEntries = entries.value.filter(e => e.type === 'gasto' && !e.reimbursed);
    const confirmation = confirm(`¿Estás seguro de que quieres registrar un reembolso por ${formatCurrency(amountToReimburse)}? Esto marcará ${unreimbursedEntries.length} gastos como cubiertos.`);
    if (!confirmation) return;
    
    isProcessing.value = true;
    try {
        const batch = writeBatch(db);
        
        unreimbursedEntries.forEach(expense => {
            const expenseRef = doc(db, "pettyCashEntries", expense.id);
            batch.update(expenseRef, { reimbursed: true });
        });

        const reimbursementEntryRef = doc(collection(db, "pettyCashEntries"));
        batch.set(reimbursementEntryRef, {
            storeId: props.storeId,
            description: `Reembolso de ${unreimbursedEntries.length} gastos acumulados.`,
            amount: amountToReimburse,
            type: 'reembolso',
            entryDate: serverTimestamp(),
            createdBy_uid: doc(db, 'users', authStore.user.uid),
            reimbursed: true
        });

        // Ya no actualizamos el saldo en 'stores', porque ahora es un cálculo.
        
        await batch.commit();
        showAlert("Reembolso registrado con éxito.");

    } catch (error) {
        console.error("Error al registrar reembolso:", error);
        showAlert(`Error al procesar el reembolso: ${error.message}`);
    } finally {
        isProcessing.value = false;
    }
};

const handleEntrySaved = (message) => {
    alertMessage.value = message;
    isAlertOpen.value = true;
};

const formatCurrency = (value) => new Intl.NumberFormat('es-HN', { style: 'currency', currency: 'HNL' }).format(value === undefined || value === null ? 0 : value);
const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    return timestamp.toDate().toLocaleString('es-HN', { dateStyle: 'short', timeStyle: 'short' });
};
</script>

<template>
  <div>
    <div v-if="isLoading">Cargando...</div>
    <div v-else-if="!storeData">Error al cargar datos de la tienda.</div>
    <div v-else>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center mb-6">
        <div class="bg-gray-50 p-4 rounded-lg">
          <h4 class="text-sm font-medium text-gray-500 uppercase">CAJA CHICA ASIGNADA</h4>
          <div v-if="storeData.initialPettyCashBalance > 0">
            <p class="mt-1 text-3xl font-semibold text-gray-900">{{ formatCurrency(storeData.initialPettyCashBalance) }}</p>
          </div>
          <div v-else>
            <p class="mt-1 text-lg font-semibold text-orange-500">No Asignado</p>
            <p class="text-xs text-gray-400">Edita la tienda para asignar un monto.</p>
          </div>
        </div>
        <div class="bg-gray-50 p-4 rounded-lg">
          <h4 class="text-sm font-medium text-gray-500 uppercase">Gastos Acumulados</h4>
          <p class="mt-1 text-3xl font-semibold text-red-600">{{ formatCurrency(unreimbursedExpensesTotal) }}</p>
        </div>
        <div class="bg-gray-50 p-4 rounded-lg">
          <h4 class="text-sm font-medium text-gray-500 uppercase">Saldo Actual en Caja</h4>
          <p class="mt-1 text-3xl font-semibold" :class="calculatedCurrentBalance < 0 ? 'text-red-600' : 'text-green-600'">
            {{ formatCurrency(calculatedCurrentBalance) }}
          </p>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4 mb-6">
        <button @click="openModal" class="w-full px-4 py-3 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700">Registrar Gasto</button>
        <button @click="handleReimbursement" :disabled="isProcessing" class="w-full px-4 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 disabled:bg-green-300">
            {{ isProcessing ? 'Procesando...' : 'Registrar Reembolso' }}
        </button>
      </div>

      <div>
        <h3 class="text-lg font-bold text-gray-800 mb-2">Historial de Movimientos</h3>
        <div class="max-h-96 overflow-y-auto border rounded-lg">
          <table class="min-w-full divide-y divide-gray-200">
            <tbody class="bg-white divide-y divide-gray-200">
              <tr v-if="entries.length === 0"><td class="px-4 py-3 text-center text-gray-500">No hay movimientos.</td></tr>
              <tr v-for="entry in entries" :key="entry.id" :class="{'opacity-50': entry.reimbursed && entry.type === 'gasto'}">
                <td class="px-4 py-3">
                  <p class="text-sm font-medium text-gray-900 flex items-center">
                    <span :class="{'font-bold text-green-700': entry.type === 'reembolso'}">{{ entry.description }}</span>
                    <a v-if="entry.invoiceImageUrl" :href="entry.invoiceImageUrl" target="_blank" class="ml-2 text-indigo-500 hover:text-indigo-700" title="Ver Factura"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clip-rule="evenodd" /></svg></a>
                  </p>
                  <p class="text-xs text-gray-500">{{ formatDate(entry.entryDate) }}</p>
                  <p v-if="entry.invoiceNumber" class="text-xs text-gray-500">Factura: {{ entry.invoiceNumber }}</p>
                </td>
                <td class="px-4 py-3 whitespace-nowrap text-sm text-right font-medium" :class="entry.type === 'gasto' ? 'text-red-600' : 'text-green-600'">
                  {{ entry.type === 'gasto' ? '-' : '+' }} {{ formatCurrency(entry.amount) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <PettyCashEntryModal 
        v-model="isModalOpen" 
        :store-id="storeId" 
        entry-type="gasto" 
        @entry-saved="handleEntrySaved" 
    />
    <AlertModal v-model="isAlertOpen" :message="alertMessage" />
  </div>
</template>