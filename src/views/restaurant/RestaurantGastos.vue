<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { db, storage } from '@/firebase';
import { collection, query, where, getDocs, addDoc, doc, serverTimestamp, orderBy, onSnapshot, Timestamp, setDoc } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useAuthStore } from '@/stores/authStore';
import AlertModal from '@/components/modals/AlertModal.vue';

const authStore = useAuthStore();
const providers = ref([]);
const expensesHistory = ref([]);
const isLoadingHistory = ref(true);
let unsubscribe = null;

const form = ref({
    expenseDate: new Date().toISOString().split('T')[0],
    paymentMethod: 'Tarjeta de Crédito',
    vendorName: '',
    description: '',
    amount: null,
    invoiceNumber: '',
});
const imageFile = ref(null);
const imagePreviewUrl = ref('');
const isSaving = ref(false);

const isAlertOpen = ref(false);
const alertMessage = ref('');

const fetchProviders = async () => {
    const q = query(collection(db, "proveedores"), orderBy("nameProveedor"));
    const snapshot = await getDocs(q);
    providers.value = snapshot.docs.map(doc => doc.data().nameProveedor);
    if (providers.value.length > 0 && !form.value.vendorName) {
        form.value.vendorName = providers.value[0];
    }
};

const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
        imageFile.value = file;
        imagePreviewUrl.value = URL.createObjectURL(file);
    } else {
        imageFile.value = null;
        imagePreviewUrl.value = '';
    }
};

const handleSaveExpense = async () => {
    if (!form.value.expenseDate || !form.value.vendorName || !form.value.description || !form.value.amount || form.value.amount <= 0) {
        showAlert("Por favor, completa todos los campos requeridos.");
        return;
    }
    isSaving.value = true;

    if (form.value.paymentMethod === 'Efectivo Caja Chica') {
        if (!authStore.user.storeId) {
            showAlert("Este usuario no tiene una caja chica asignada para registrar este tipo de gasto.");
            isSaving.value = false;
            return;
        }
        await savePettyCashExpense();
    } else {
        await saveCardOrOtherExpense();
    }

    isSaving.value = false;
};

// --- INICIO DE LA CORRECCIÓN: Función para manejar fechas de forma segura ---
const createSafeDate = (dateString) => {
    // El input 'date' devuelve un string 'YYYY-MM-DD'.
    // Al hacer new Date('2025-09-15'), algunos navegadores lo interpretan como UTC.
    // Para evitarlo, lo separamos y creamos la fecha con componentes, forzando la zona horaria local.
    const parts = dateString.split('-');
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1; // Meses en JS son 0-11
    const day = parseInt(parts[2], 10);
    return new Date(year, month, day);
}
// --- FIN DE LA CORRECCIÓN ---


const savePettyCashExpense = async () => {
    let imageUrl = null;
    if (imageFile.value) {
        try {
            const fileRef = storageRef(storage, `petty_cash_invoices/${Date.now()}_${imageFile.value.name}`);
            const snapshot = await uploadBytes(fileRef, imageFile.value);
            imageUrl = await getDownloadURL(snapshot.ref);
        } catch (error) {
             showAlert("No se pudo subir la imagen. El gasto no se guardó.");
             return;
        }
    }

    try {
        const entryRef = doc(collection(db, "pettyCashEntries"));
        const newEntryData = {
            storeId: authStore.user.storeId.id,
            description: form.value.description,
            amount: Number(form.value.amount),
            type: 'gasto',
            reimbursed: false,
            entryDate: Timestamp.fromDate(createSafeDate(form.value.expenseDate)), // Usamos la nueva función
            createdBy_uid: doc(db, 'users', authStore.user.uid),
            providerName: form.value.vendorName || null,
            invoiceNumber: form.value.invoiceNumber || null,
            invoiceImageUrl: imageUrl
        };
        await setDoc(entryRef, newEntryData);
        showAlert("Gasto de caja chica registrado con éxito.");
        resetForm();
    } catch (error) {
        console.error("Error al guardar en caja chica:", error);
        showAlert(`Error al guardar: ${error.message}`);
    }
};

const saveCardOrOtherExpense = async () => {
    let imageUrl = null;
    if (imageFile.value) {
        try {
            const fileRef = storageRef(storage, `expense_invoices/${Date.now()}_${imageFile.value.name}`);
            const snapshot = await uploadBytes(fileRef, imageFile.value);
            imageUrl = await getDownloadURL(snapshot.ref);
        } catch (error) {
            showAlert("No se pudo subir la imagen. El gasto no se guardó.");
            return;
        }
    }
    
    try {
        const expenseData = {
            expenseDate: Timestamp.fromDate(createSafeDate(form.value.expenseDate)), // Usamos la nueva función
            vendorName: form.value.vendorName,
            description: form.value.description,
            amount: Number(form.value.amount),
            invoiceNumber: form.value.invoiceNumber || null,
            invoiceImageUrl: imageUrl,
            paymentMethod: form.value.paymentMethod,
            status: 'pendiente',
            createdAt: serverTimestamp(),
            enteredBy_uid: doc(db, "users", authStore.user.uid)
        };
        
        await addDoc(collection(db, "expenses"), expenseData);
        showAlert("Gasto registrado con éxito.");
        resetForm();
    } catch (error) {
        console.error("Error al registrar gasto:", error);
        showAlert(`Error al guardar: ${error.message}`);
    }
};

const resetForm = () => {
    form.value.description = '';
    form.value.amount = null;
    form.value.invoiceNumber = '';
    imageFile.value = null;
    imagePreviewUrl.value = '';
    const fileInput = document.getElementById('expense-invoice-image');
    if (fileInput) fileInput.value = '';
};

onMounted(() => {
    fetchProviders();
    const q = query(collection(db, "expenses"), where("enteredBy_uid", "==", doc(db, "users", authStore.user.uid)), orderBy("expenseDate", "desc"));
    unsubscribe = onSnapshot(q, (snapshot) => {
        expensesHistory.value = snapshot.docs.map(doc => ({id: doc.id, ...doc.data()}));
        isLoadingHistory.value = false;
    });
});

onUnmounted(() => {
    if (unsubscribe) unsubscribe();
});

const formatCurrency = (value) => new Intl.NumberFormat('es-HN', { style: 'currency', currency: 'HNL' }).format(value || 0);
const showAlert = (msg) => { alertMessage.value = msg; isAlertOpen.value = true; };
</script>


<template>
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
    <div class="lg:col-span-1 bg-white p-6 rounded-lg shadow">
      <h2 class="text-2xl font-bold text-gray-800 mb-4">Registrar Gasto Manual</h2>
      <form @submit.prevent="handleSaveExpense" class="space-y-4">
        <div>
          <label for="expense-date" class="block text-sm font-medium text-gray-700">Fecha del Gasto</label>
          <input type="date" id="expense-date" v-model="form.expenseDate" required class="w-full input-style">
        </div>
        <div>
            <label for="payment-method" class="block text-sm font-medium text-gray-700">Método de Pago</label>
            <select id="payment-method" v-model="form.paymentMethod" required class="w-full input-style">
                <option>Tarjeta de Crédito</option>
                <option>Efectivo Caja Chica</option>
                <option>Efectivo Walter</option>
                <option>Efectivo Deyvin</option>
            </select>
        </div>
        <div>
          <label for="expense-vendor" class="block text-sm font-medium text-gray-700">Proveedor</label>
          <select id="expense-vendor" v-model="form.vendorName" required class="w-full input-style">
            <option v-if="providers.length === 0" disabled>Cargando...</option>
            <option v-for="p in providers" :key="p" :value="p">{{ p }}</option>
          </select>
        </div>
        <div>
          <label for="expense-description" class="block text-sm font-medium text-gray-700">Descripción</label>
          <textarea id="expense-description" v-model="form.description" rows="3" required placeholder="Detalle de la compra" class="w-full input-style"></textarea>
        </div>
        <div>
          <label for="expense-amount" class="block text-sm font-medium text-gray-700">Monto (L)</label>
          <input type="number" id="expense-amount" v-model.number="form.amount" step="0.01" required placeholder="Ej: 1500.50" class="w-full input-style">
        </div>
        <div>
          <label for="expense-invoice" class="block text-sm font-medium text-gray-700">Número de Factura (Opcional)</label>
          <input type="text" id="expense-invoice" v-model="form.invoiceNumber" class="w-full input-style">
        </div>
        <div>
            <label for="expense-invoice-image" class="block text-sm font-medium text-gray-700">Imagen de Factura (Opcional)</label>
            <input type="file" id="expense-invoice-image" @change="handleFileChange" accept="image/*" class="w-full file-input-style">
            <img v-if="imagePreviewUrl" :src="imagePreviewUrl" class="mt-2 rounded-md max-h-40 border" alt="Vista previa"/>
        </div>
        <div class="pt-2">
          <button type="submit" :disabled="isSaving" class="w-full px-4 py-2 font-semibold text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:bg-indigo-300">
            {{ isSaving ? 'Guardando...' : 'Guardar Gasto' }}
          </button>
        </div>
      </form>
    </div>

    <div class="lg:col-span-2 bg-white p-6 rounded-lg shadow">
      <h2 class="text-2xl font-bold text-gray-800 mb-4">Historial de Gastos Registrados</h2>
      <p class="text-sm text-gray-500 mb-4">Muestra los gastos (no de caja chica) que has registrado.</p>
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Fecha</th>
              <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Proveedor</th>
              <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Monto</th>
              <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            <tr v-if="isLoadingHistory"><td colspan="4" class="text-center p-4 text-gray-500">Cargando historial...</td></tr>
            <tr v-else-if="expensesHistory.length === 0"><td colspan="4" class="text-center p-4 text-gray-500">No hay gastos registrados por este usuario.</td></tr>
            <tr v-for="exp in expensesHistory" :key="exp.id">
              <td class="px-4 py-2 whitespace-nowrap text-sm">{{ exp.expenseDate.toDate().toLocaleDateString('es-HN') }}</td>
              <td class="px-4 py-2 text-sm"><div class="font-medium">{{ exp.vendorName }}</div><div class="text-gray-500">{{ exp.description }}</div></td>
              <td class="px-4 py-2 whitespace-nowrap text-sm font-medium">{{ formatCurrency(exp.amount) }}</td>
              <td class="px-4 py-2 whitespace-nowrap text-sm">
                <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full capitalize" :class="exp.status === 'pendiente' ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'">{{ exp.status }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
  <AlertModal v-model="isAlertOpen" :message="alertMessage" />
</template>

<style scoped>
.input-style { @apply w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500; }
.file-input-style { @apply text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 mt-1; }
</style>