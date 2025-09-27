<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { db } from '@/firebase';
import { collection, query, where, getDocs, doc, updateDoc, serverTimestamp, arrayUnion, Timestamp, orderBy, getDoc } from 'firebase/firestore';
import { useAuthStore } from '@/stores/authStore';

const props = defineProps({
  modelValue: Boolean,
  deposit: Object,
  storeIdFilter: { 
    type: Array,
    default: null
  }
});

const emit = defineEmits(['update:modelValue', 'deposit-updated']);
const authStore = useAuthStore();

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
});

const vendors = ref([]);
const selectedVendor = ref('');
const isLoading = ref(false);

const fetchVendors = async () => {
    let constraints = [];
    if (props.storeIdFilter && props.storeIdFilter.length > 0) {
        const storeRefs = props.storeIdFilter.map(id => doc(db, 'stores', id));
        constraints.push(where("storeId", "in", storeRefs));
    }
    constraints.push(orderBy("display_name"));

    const q = query(collection(db, "users"), ...constraints);
    try {
        const querySnapshot = await getDocs(q);
        const allUsersInScope = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Filtro final para asegurar que solo sean vendedores
        vendors.value = allUsersInScope.filter(user => user.roleId && user.roleId.id.includes('vendedor'));
    } catch(error) {
        console.error("Error al cargar vendedores:", error);
        alert("Error al cargar vendedores. Es posible que falte un índice en Firestore. Revisa la consola (F12) para más detalles.");
    }
};

onMounted(() => {
    // Solo se llama al montar si es un admin (sin filtro)
    if (!props.storeIdFilter) {
        fetchVendors();
    }
});

watch(() => props.modelValue, (isOpen) => {
    if (isOpen) {
        selectedVendor.value = '';
        // Siempre recargar la lista de vendedores al abrir el modal para asegurar que esté filtrada
        fetchVendors();
    }
});

const handleReserve = async () => {
    if (!selectedVendor.value) {
        alert('Por favor, selecciona un vendedor.');
        return;
    }
    isLoading.value = true;
    try {
        const vendorData = vendors.value.find(v => v.id === selectedVendor.value);
        const depositRef = doc(db, "deposits", props.deposit.id);

        let finalStoreName = vendorData.storeName || '';
        if (vendorData.storeId && !finalStoreName) {
            const storeDoc = await getDoc(vendorData.storeId);
            if (storeDoc.exists()) finalStoreName = storeDoc.data().name;
        }

        const historyEntry = {
            action: 'Reservado',
            user: doc(db, 'users', authStore.user.uid),
            userName: authStore.user.display_name,
            timestamp: Timestamp.now(),
            details: `Reservado para ${vendorData.display_name}`
        };

        await updateDoc(depositRef, {
            status: "reservado",
            vendorId: doc(db, "users", vendorData.id),
            vendorName: vendorData.display_name,
            storeId: vendorData.storeId,
            storeName: finalStoreName,
            reservationDate: serverTimestamp(),
            history: arrayUnion(historyEntry)
        });
        
        emit('deposit-updated', 'Depósito reservado con éxito.');
        isOpen.value = false;
    } catch (error) {
        console.error("Error al reservar el depósito:", error);
        alert(`Hubo un error al reservar el depósito: ${error.message}`);
    } finally {
        isLoading.value = false;
    }
};
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="isOpen" @click.self="isOpen = false" class="fixed inset-0 bg-gray-900 bg-opacity-50 z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
          <form @submit.prevent="handleReserve">
            <h3 class="text-lg font-bold text-gray-900 mb-4">Reservar Depósito</h3>
            <div v-if="deposit">
              <p class="text-sm text-gray-600">Monto: <span class="font-medium">{{ new Intl.NumberFormat('es-HN', { style: 'currency', currency: 'HNL' }).format(deposit.amount) }}</span></p>
              <p class="text-sm text-gray-600">Descripción: <span class="font-medium">{{ deposit.description }}</span></p>
            </div>
            <div class="mt-4">
              <label for="vendor-select" class="block text-sm font-medium text-gray-700">Asignar a Vendedor(a)</label>
              <select id="vendor-select" v-model="selectedVendor" required class="w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm">
                <option disabled value="">-- Selecciona un vendedor --</option>
                <option v-for="vendor in vendors" :key="vendor.id" :value="vendor.id">{{ vendor.display_name }}</option>
              </select>
            </div>
            <div class="mt-6 flex justify-end space-x-3">
              <button type="button" @click="isOpen = false" class="px-4 py-2 bg-gray-200 text-gray-800 rounded-md">Cancelar</button>
              <button type="submit" :disabled="isLoading" class="px-4 py-2 bg-indigo-600 text-white rounded-md disabled:bg-indigo-300">
                {{ isLoading ? 'Reservando...' : 'Confirmar Reserva' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>