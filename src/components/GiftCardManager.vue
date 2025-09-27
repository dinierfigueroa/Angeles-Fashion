<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { db } from '@/firebase';
import { collection, query, where, getDocs, addDoc, doc, runTransaction, arrayUnion, Timestamp, onSnapshot, orderBy, limit, serverTimestamp } from 'firebase/firestore';
import { useAuthStore } from '@/stores/authStore';
import AlertModal from '@/components/modals/AlertModal.vue';
import GiftCardHistoryModal from '@/components/modals/GiftCardHistoryModal.vue';

const authStore = useAuthStore();

const createForm = ref({ folio: '', initialValue: null, buyerName: '', buyerPhone: '', nombreDeQuienReclama: '' });
const redeemForm = ref({ folioToSearch: '', amountToRedeem: null });
const claimantType = ref('beneficiary');
const customClaimantName = ref('');
const foundGiftCard = ref(null);

const allGiftCards = ref([]);
const isLoadingTable = ref(true);
const isProcessing = ref(false);
const filters = ref({ startDate: '', endDate: '', searchTerm: '' });
let unsubscribe = null;

const isAlertOpen = ref(false);
const alertMessage = ref('');
const isHistoryModalOpen = ref(false);
const selectedCardForHistory = ref(null);

const filteredGiftCards = computed(() => {
    if (!filters.value.searchTerm) {
        return allGiftCards.value;
    }
    const search = filters.value.searchTerm.toLowerCase();
    return allGiftCards.value.filter(gc => 
        gc.folio?.toLowerCase().includes(search) ||
        gc.buyerName?.toLowerCase().includes(search) ||
        gc.nombreDeQuienReclama?.toLowerCase().includes(search)
    );
});

const fetchGiftCards = () => {
    if (!authStore.user) return;
    isLoadingTable.value = true;
    if (unsubscribe) unsubscribe();

    let constraints = [orderBy("createdAt", "desc")];
    
    if (authStore.user.permissions?.canViewAllGiftCards) {
        if (filters.value.startDate) {
            const startOfDay = new Date(filters.value.startDate);
            constraints.push(where("createdAt", ">=", Timestamp.fromDate(startOfDay)));
        }
        if (filters.value.endDate) {
            const endOfDay = new Date(filters.value.endDate + 'T23:59:59');
            constraints.push(where("createdAt", "<=", Timestamp.fromDate(endOfDay)));
        }
    } else {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        constraints.push(where("createdAt", ">=", Timestamp.fromDate(today)));
    }

    const q = query(collection(db, "giftCards"), ...constraints);
    
    unsubscribe = onSnapshot(q, (snapshot) => {
        allGiftCards.value = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        isLoadingTable.value = false;
    }, (error) => {
        console.error("Error fetching gift cards:", error);
        showAlert("Error al cargar los Certificados. Es posible que necesites un índice en Firestore.");
        isLoadingTable.value = false;
    });
};

const handleCreateGiftCard = async () => {
    if (!createForm.value.folio || !createForm.value.initialValue || !createForm.value.buyerName || !createForm.value.nombreDeQuienReclama) {
        showAlert("Por favor, completa todos los campos requeridos.");
        return;
    }
    isProcessing.value = true;
    try {
        const q = query(collection(db, "giftCards"), where("folio", "==", createForm.value.folio));
        const existing = await getDocs(q);
        if (!existing.empty) {
            showAlert("El folio ingresado ya existe. Por favor, utiliza uno diferente.");
            isProcessing.value = false;
            return;
        }
        await addDoc(collection(db, "giftCards"), {
            ...createForm.value,
            currentBalance: createForm.value.initialValue,
            status: 'activa',
            activationDate: serverTimestamp(),
            createdAt: serverTimestamp(),
            redemptionHistory: []
        });
        showAlert("Certificado creado exitosamente.");
        createForm.value = { folio: '', initialValue: null, buyerName: '', buyerPhone: '', nombreDeQuienReclama: '' };
    } catch (error) {
        console.error("Error al crear Certificado:", error);
        showAlert("Ocurrió un error al crear el Certificado.");
    } finally {
        isProcessing.value = false;
    }
};

const handleSearchGiftCard = async () => {
    if (!redeemForm.value.folioToSearch) return;
    isProcessing.value = true;
    foundGiftCard.value = null;
    try {
        const q = query(collection(db, "giftCards"), where("folio", "==", redeemForm.value.folioToSearch), limit(1));
        const snapshot = await getDocs(q);
        if (snapshot.empty) {
            foundGiftCard.value = 'not_found';
        } else {
            foundGiftCard.value = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
            claimantType.value = 'beneficiary';
            customClaimantName.value = '';
        }
    } catch (error) {
        console.error("Error buscando Certificado:", error);
        showAlert("Ocurrió un error al buscar el certificado.");
    } finally {
        isProcessing.value = false;
    }
};

const handleRedeemGiftCard = async () => {
    const amount = redeemForm.value.amountToRedeem;
    let claimantName = claimantType.value === 'beneficiary' ? foundGiftCard.value.nombreDeQuienReclama : customClaimantName.value.trim();
    
    if (!amount || amount <= 0) {
        showAlert("Por favor, ingresa un monto válido para redimir.");
        return;
    }
    if (amount > foundGiftCard.value.currentBalance) {
        showAlert("El monto a redimir es mayor que el saldo actual del certificado.");
        return;
    }
    if (claimantType.value === 'other' && !claimantName) {
        showAlert("Por favor, especifica el nombre de la persona que reclama.");
        return;
    }
    isProcessing.value = true;
    const giftCardRef = doc(db, "giftCards", foundGiftCard.value.id);
    try {
        const newBalance = foundGiftCard.value.currentBalance - amount;
        await runTransaction(db, async (transaction) => {
            const sfDoc = await transaction.get(giftCardRef);
            if (!sfDoc.exists()) throw new Error("El Certificado no existe.");
            const newStatus = newBalance > 0 ? 'activa' : 'agotada';
            
            transaction.update(giftCardRef, {
                currentBalance: newBalance,
                status: newStatus,
                redemptionHistory: arrayUnion({
                    amount: amount,
                    date: Timestamp.now(),
                    processedBy_uid: doc(db, "users", authStore.user.uid),
                    processedBy_name: authStore.user.display_name,
                    claimedBy_name: claimantName
                })
            });
        });
        showAlert(`Redención exitosa. Nuevo saldo: ${formatCurrency(newBalance)}`);
        redeemForm.value = { folioToSearch: '', amountToRedeem: null };
        foundGiftCard.value = null;
    } catch (error) {
        console.error("Error en la transacción de redención:", error);
        showAlert("No se pudo completar la redención. Intenta de nuevo.");
    } finally {
        isProcessing.value = false;
    }
};

const openHistoryModal = (gc) => {
    selectedCardForHistory.value = gc;
    isHistoryModalOpen.value = true;
};

const formatCurrency = (value) => new Intl.NumberFormat('es-HN', { style: 'currency', currency: 'HNL' }).format(value || 0);
const getStatusBadgeClass = (status) => status === 'activa' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';
const showAlert = (msg) => { alertMessage.value = msg; isAlertOpen.value = true; };

onMounted(() => {
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    filters.value.startDate = firstDay.toISOString().split('T')[0];
    filters.value.endDate = today.toISOString().split('T')[0];
    fetchGiftCards();
});

onUnmounted(() => {
    if (unsubscribe) unsubscribe();
});
</script>


<template>
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div class="lg:col-span-1 space-y-8">
            <div v-if="authStore.user?.permissions?.canCreateGiftCards" class="bg-white p-6 rounded-lg shadow">
                <h3 class="text-xl font-bold text-gray-800 mb-4">Crear Certificado de Consumo</h3>
                <form @submit.prevent="handleCreateGiftCard" class="space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700">Folio</label>
                        <input type="text" v-model="createForm.folio" required class="w-full px-3 py-2 mt-1 border border-gray-300 rounded-md">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700">Valor Inicial (L)</label>
                        <input type="number" step="0.01" v-model.number="createForm.initialValue" required class="w-full px-3 py-2 mt-1 border border-gray-300 rounded-md">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700">Nombre del Comprador</label>
                        <input type="text" v-model="createForm.buyerName" required class="w-full px-3 py-2 mt-1 border border-gray-300 rounded-md">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700">Teléfono (Opcional)</label>
                        <input type="tel" v-model="createForm.buyerPhone" class="w-full px-3 py-2 mt-1 border border-gray-300 rounded-md">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700">Nombre de Quien Reclama</label>
                        <input type="text" v-model="createForm.nombreDeQuienReclama" required class="w-full px-3 py-2 mt-1 border border-gray-300 rounded-md">
                    </div>
                    <div class="pt-2">
                        <button type="submit" :disabled="isProcessing" class="w-full px-4 py-2 font-semibold text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:bg-indigo-300">
                           {{ isProcessing ? 'Guardando...' : 'Guardar Certificado' }}
                        </button>
                    </div>
                </form>
            </div>

            <div v-if="authStore.user?.permissions?.canRedeemGiftCards" class="bg-white p-6 rounded-lg shadow">
                <h3 class="text-xl font-bold text-gray-800 mb-4">Redimir Certificado</h3>
                <form @submit.prevent="handleSearchGiftCard" class="space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700">Buscar por Folio</label>
                        <div class="flex">
                            <input type="text" v-model="redeemForm.folioToSearch" required class="flex-grow w-full px-3 py-2 mt-1 border border-gray-300 rounded-l-md">
                            <button type="submit" :disabled="isProcessing" class="mt-1 px-4 py-2 bg-gray-600 text-white font-semibold rounded-r-md hover:bg-gray-700 disabled:bg-gray-400">Buscar</button>
                        </div>
                    </div>
                </form>

                <div v-if="foundGiftCard" class="mt-4 pt-4 border-t">
                    <div v-if="foundGiftCard === 'not_found'"><p class="text-red-600 font-medium">No se encontró ningún certificado con ese folio.</p></div>
                    <div v-else>
                        <div class="text-sm p-3 bg-gray-50 rounded-md space-y-1">
                            <p><span class="font-semibold">Beneficiario:</span> {{ foundGiftCard.nombreDeQuienReclama }}</p>
                            <p><span class="font-semibold">Saldo Actual:</span> <span class="text-green-700 font-bold">{{ formatCurrency(foundGiftCard.currentBalance) }}</span></p>
                             <p v-if="foundGiftCard.status === 'agotada'" class="font-bold text-red-600">Este certificado ya ha sido agotado.</p>
                        </div>
                        <form v-if="foundGiftCard.status === 'activa'" @submit.prevent="handleRedeemGiftCard" class="mt-4 space-y-4">
                            <div><label class="block text-sm font-medium text-gray-700">Monto a Redimir (L)</label><input type="number" step="0.01" v-model.number="redeemForm.amountToRedeem" required class="w-full px-3 py-2 mt-1 border border-gray-300 rounded-md"></div>
                            <div class="space-y-2">
                                <label class="block text-sm font-medium text-gray-700">Reclamado por:</label>
                                <div class="flex items-center"><input type="radio" id="claimant-beneficiary" value="beneficiary" v-model="claimantType" class="h-4 w-4 text-indigo-600 border-gray-300 focus:ring-indigo-500"><label for="claimant-beneficiary" class="ml-2 text-sm">{{ foundGiftCard.nombreDeQuienReclama }} (Beneficiario)</label></div>
                                <div class="flex items-center"><input type="radio" id="claimant-other" value="other" v-model="claimantType" class="h-4 w-4 text-indigo-600 border-gray-300 focus:ring-indigo-500"><label for="claimant-other" class="ml-2 text-sm">Otra Persona</label></div>
                                <input v-if="claimantType === 'other'" type="text" v-model="customClaimantName" placeholder="Nombre de la otra persona" required class="w-full px-3 py-2 mt-1 border border-gray-300 rounded-md">
                            </div>
                            <div class="pt-2"><button type="submit" :disabled="isProcessing" class="w-full px-4 py-2 font-semibold text-white bg-green-600 rounded-md hover:bg-green-700 disabled:bg-green-300">{{ isProcessing ? 'Procesando...' : 'Confirmar Redención' }}</button></div>
                        </form>
                    </div>
                </div>
            </div>
        </div>

        <div class="lg:col-span-2 bg-white p-6 rounded-lg shadow">
            <h3 class="text-xl font-bold text-gray-800 mb-4">Certificados Emitidos</h3>
            
            <div v-if="authStore.user?.permissions?.canViewAllGiftCards" class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 p-4 bg-gray-50 rounded-lg">
                <div>
                    <label class="block text-sm font-medium text-gray-700">Desde</label>
                    <input type="date" v-model="filters.startDate" @change="fetchGiftCards" class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md">
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700">Hasta</label>
                    <input type="date" v-model="filters.endDate" @change="fetchGiftCards" class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md">
                </div>
                <div class="md:col-span-3">
                    <label class="block text-sm font-medium text-gray-700">Buscar por Folio, Comprador o Beneficiario</label>
                    <input type="text" v-model="filters.searchTerm" placeholder="Escribe para buscar..." class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md">
                </div>
            </div>
             <div v-else class="mb-4 p-4 bg-blue-50 text-blue-700 rounded-lg">
                <p class="text-sm">Mostrando solo certificados creados hoy por seguridad.</p>
            </div>

            <div class="overflow-x-auto">
                 <table class="min-w-full divide-y divide-gray-200">
                    <thead class="bg-gray-50">
                        <tr>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Folio</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Saldo Actual</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Comprador</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Acciones</th>
                        </tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-200">
                        <tr v-if="isLoadingTable"><td colspan="5" class="text-center p-4 text-gray-500">Cargando...</td></tr>
                        <tr v-else-if="filteredGiftCards.length === 0"><td colspan="5" class="text-center p-4 text-gray-500">No se encontraron certificados con los filtros actuales.</td></tr>
                        <tr v-for="gc in filteredGiftCards" :key="gc.id">
                            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{{ gc.folio }}</td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-800">{{ formatCurrency(gc.currentBalance) }}</td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{{ gc.buyerName }}</td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm"><span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full capitalize" :class="getStatusBadgeClass(gc.status)">{{ gc.status }}</span></td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                <button @click="openHistoryModal(gc)" class="text-indigo-600 hover:text-indigo-900">Historial</button>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>
    <AlertModal v-model="isAlertOpen" :message="alertMessage" />
    <GiftCardHistoryModal v-model="isHistoryModalOpen" :giftCard="selectedCardForHistory" />
</template>