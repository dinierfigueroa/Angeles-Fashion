<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { db } from '@/firebase';
import { collection, query, getDocs, doc, updateDoc, serverTimestamp, arrayUnion, orderBy, where, limit, Timestamp, deleteField, getDoc } from 'firebase/firestore';
import { useAuthStore } from '@/stores/authStore';

const props = defineProps({
  modelValue: Boolean,
  deposit: Object,
  action: { type: String, default: 'liquidate' },
  directLiquidation: { type: Boolean, default: false },
  storeIdFilter: { type: Array, default: null }
});

const emit = defineEmits(['update:modelValue', 'deposit-updated']);
const authStore = useAuthStore();

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
});

const vendors = ref([]);
const statuses = ref([]);
const form = ref({ shopifyOrderId: '', orderTotal: 0, selectedVendor: '', status: '', comment: '' });
const isLoading = ref(false);
const isLoadingVendors = ref(false);

const title = computed(() => {
    if (props.action === 'revert') return 'Revertir Liquidación';
    if (props.directLiquidation) return 'Liquidar Depósito Directamente';
    return 'Liquidar Depósito Reservado';
});

const showVendorSelector = computed(() => {
    const userRoleId = authStore.user?.roleId?.id || '';
    return props.directLiquidation && userRoleId !== 'vendedor';
});

const fetchVendors = async () => {
    isLoadingVendors.value = true;
    try {
        let constraints = [];
        if (props.storeIdFilter && props.storeIdFilter.length > 0) {
            const storeRefs = props.storeIdFilter.map(id => doc(db, 'stores', id));
            constraints.push(where("storeId", "in", storeRefs));
        }
        constraints.push(orderBy("display_name"));

        const q = query(collection(db, "users"), ...constraints);
        const querySnapshot = await getDocs(q);
        const allUsersInScope = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        vendors.value = allUsersInScope.filter(user => user.roleId && user.roleId.id.includes('vendedor'));
    } catch (error) {
        console.error("Error al cargar vendedores:", error);
        alert("Error al cargar vendedores. Es posible que falte un índice en Firestore. Revisa la consola (F12) para más detalles.");
    } finally {
        isLoadingVendors.value = false;
    }
};

const fetchStatuses = async () => {
    try {
        const q = query(collection(db, "statuses"), limit(1));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
            const statusData = querySnapshot.docs[0].data();
            if (statusData.estados && Array.isArray(statusData.estados)) {
                statuses.value = statusData.estados;
            } else { statuses.value = ['Liquidado']; }
        } else { statuses.value = ['Liquidado']; }
    } catch (error) {
        console.error("Error al cargar los estados:", error);
        statuses.value = ['Error: Carga fallida'];
    }
};

onMounted(() => {
    fetchStatuses();
});

watch(() => props.modelValue, (newValue) => {
    if (newValue) {
        form.value = {
            shopifyOrderId: props.deposit?.shopifyOrderId || '',
            orderTotal: props.deposit?.orderTotal || props.deposit?.amount || 0,
            status: statuses.value[0] || 'Liquidado',
            comment: '',
            selectedVendor: '',
        };
        if (props.action === 'liquidate' && showVendorSelector.value) {
            fetchVendors();
        } else if (props.action === 'liquidate' && !props.directLiquidation && props.deposit?.vendorId) {
            vendors.value = [{ 
                id: props.deposit.vendorId.id, 
                display_name: props.deposit.vendorName,
                storeId: props.deposit.storeId,
                storeName: props.deposit.storeName
            }];
        }
    }
});

const handleSubmit = async () => {
    isLoading.value = true;
    try {
        if (props.action === 'liquidate') {
            await handleLiquidation();
        } else if (props.action === 'revert') {
            await handleReversion();
        }
    } catch (error) {
        console.error("Error en la operación:", error);
        alert(`Ocurrió un error: ${error.message}`);
    } finally {
        isLoading.value = false;
    }
};

const handleLiquidation = async () => {
    if (showVendorSelector.value && !form.value.selectedVendor) {
        alert('Debe seleccionar un vendedor.');
        isLoading.value = false; return;
    }
     if (!form.value.comment) {
        alert('El comentario es obligatorio para liquidar.');
        isLoading.value = false; return;
    }
    const depositRef = doc(db, "deposits", props.deposit.id);
    const difference = props.deposit.amount - form.value.orderTotal;
    
    let vendorData;
    if (showVendorSelector.value) {
        vendorData = vendors.value.find(v => v.id === form.value.selectedVendor);
    } else if (props.directLiquidation) {
        vendorData = {
            id: authStore.user.uid,
            display_name: authStore.user.display_name,
            storeId: authStore.user.storeId,
            storeName: authStore.user.storeName,
        };
    } else {
        vendorData = {
            id: props.deposit.vendorId.id,
            display_name: props.deposit.vendorName,
            storeId: props.deposit.storeId,
            storeName: props.deposit.storeName
        };
    }

    if (!vendorData) {
        alert("No se pudo encontrar la información del vendedor. Intente de nuevo.");
        isLoading.value = false; return;
    }
    let finalStoreName = vendorData.storeName || '';
    if (vendorData.storeId && !finalStoreName) {
        const storeDoc = await getDoc(vendorData.storeId);
        if (storeDoc.exists()) finalStoreName = storeDoc.data().name;
    }
    const historyEntry = {
        action: 'Liquidado', user: doc(db, 'users', authStore.user.uid), userName: authStore.user.display_name,
        timestamp: Timestamp.now(), details: `Estado: ${form.value.status}. Pedido: ${form.value.shopifyOrderId}. Total: ${form.value.orderTotal}. Diferencia: ${difference}. Comentario: ${form.value.comment}`
    };
    const updateData = {
        status: form.value.status.toLowerCase().replace(/ /g, '-'),
        shopifyOrderId: form.value.shopifyOrderId, orderTotal: parseFloat(form.value.orderTotal), diferencia: difference,
        liquidationDate: serverTimestamp(), history: arrayUnion(historyEntry),
        vendorId: doc(db, "users", vendorData.id), vendorName: vendorData.display_name,
        storeId: vendorData.storeId, storeName: finalStoreName
    };
    await updateDoc(depositRef, updateData);
    emit('deposit-updated', 'Depósito liquidado con éxito.');
    isOpen.value = false;
};

const handleReversion = async () => {
    if (!form.value.comment) {
        alert('El comentario es obligatorio para revertir la liquidación.');
        isLoading.value = false; return;
    }
    const depositRef = doc(db, "deposits", props.deposit.id);
    const historyEntry = {
        action: 'Revertido', user: doc(db, 'users', authStore.user.uid), userName: authStore.user.display_name,
        timestamp: Timestamp.now(), details: `Revertido a estado 'disponible'. Comentario: ${form.value.comment}`
    };
    await updateDoc(depositRef, {
        status: "disponible", vendorId: deleteField(), vendorName: deleteField(), storeId: deleteField(),
        storeName: deleteField(), reservationDate: deleteField(), shopifyOrderId: deleteField(),
        orderTotal: deleteField(), diferencia: deleteField(), liquidationDate: deleteField(),
        history: arrayUnion(historyEntry)
    });
    emit('deposit-updated', 'La liquidación ha sido revertida.');
    isOpen.value = false;
};
</script>


<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="isOpen" @click.self="isOpen = false" class="fixed inset-0 bg-gray-900 bg-opacity-50 z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-lg shadow-xl w-full max-w-lg p-6">
          <form @submit.prevent="handleSubmit">
            <h3 class="text-lg font-bold text-gray-900 mb-4">{{ title }}</h3>
            
            <div v-if="action === 'liquidate'" class="space-y-4">
               <div v-if="showVendorSelector">
                  <label for="vendor-select-liq" class="block text-sm font-medium text-gray-700">Asignar a Vendedor(a)</label>
                  <select id="vendor-select-liq" v-model="form.selectedVendor" required class="w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm">
                    <option v-if="isLoadingVendors" disabled value="">Cargando vendedores...</option>
                    <template v-else>
                      <option disabled value="">-- Selecciona un vendedor --</option>
                      <option v-for="vendor in vendors" :key="vendor.id" :value="vendor.id">{{ vendor.display_name }}</option>
                    </template>
                  </select>
               </div>
               <div>
                  <label for="shopifyOrderId" class="block text-sm font-medium text-gray-700">ID de Pedido Shopify</label>
                  <input type="text" id="shopifyOrderId" v-model="form.shopifyOrderId" required class="w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm">
               </div>
               <div>
                  <label for="orderTotal" class="block text-sm font-medium text-gray-700">Total del Pedido (L)</label>
                  <input type="number" id="orderTotal" v-model.number="form.orderTotal" step="0.01" required class="w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm">
               </div>
               <div>
                  <label for="status" class="block text-sm font-medium text-gray-700">Estado Final</label>
                  <select id="status" v-model="form.status" required class="w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm">
                      <option v-for="s in statuses" :key="s" :value="s">{{ s }}</option>
                  </select>
               </div>
               <div>
                  <label for="comment-liq" class="block text-sm font-medium text-gray-700">Comentario (Obligatorio)</label>
                  <textarea id="comment-liq" v-model="form.comment" rows="3" required class="w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"></textarea>
               </div>
               <div v-if="deposit" class="p-2 bg-yellow-50 border-l-4 border-yellow-400 text-yellow-700">
                  <p class="text-sm">Diferencia: <span class="font-bold">{{ new Intl.NumberFormat('es-HN', { style: 'currency', currency: 'HNL' }).format(deposit.amount - form.orderTotal) }}</span></p>
               </div>
            </div>

            <div v-if="action === 'revert'" class="space-y-4">
                <p class="text-sm text-gray-600">
                    Esta acción devolverá el depósito al estado <span class="font-bold text-blue-600">"disponible"</span> y borrará la información de la liquidación.
                </p>
               <div>
                  <label for="comment-rev" class="block text-sm font-medium text-gray-700">Motivo de la Reversión (Obligatorio)</label>
                  <textarea id="comment-rev" v-model="form.comment" rows="3" required class="w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm"></textarea>
               </div>
            </div>

            <div class="mt-6 flex justify-end space-x-3">
              <button type="button" @click="isOpen = false" class="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300">Cancelar</button>
              <button type="submit" :disabled="isLoading" class="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-indigo-300">
                {{ isLoading ? 'Procesando...' : 'Confirmar' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-enter-active, .modal-leave-active { transition: opacity 0.3s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
</style>