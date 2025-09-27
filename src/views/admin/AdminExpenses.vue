<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { db, auth } from '@/firebase';
import { collection, query, onSnapshot, orderBy, where, Timestamp, getDocs, writeBatch, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import AlertModal from '@/components/modals/AlertModal.vue';
import ManualReconciliationModal from '@/components/modals/ManualReconciliationModal.vue';
import { useAuthStore } from '@/stores/authStore';

const authStore = useAuthStore();
const getInitialDateRange = () => {
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return {
        startDate: firstDay.toISOString().split('T')[0],
        endDate: lastDay.toISOString().split('T')[0]
    };
};
const fileName = ref('Ningún archivo seleccionado');
const excelData = ref([]);
const excelHeaders = ref([]);
const isProcessing = ref(false);
const showMapping = ref(false);
const dbFields = ref([
  { key: 'expenseDate', label: 'Fecha', required: true, mappedColumn: '' },
  { key: 'description', label: 'Descripción', required: true, mappedColumn: '' },
  { key: 'bankReference', label: 'Referencia (Opcional)', required: false, mappedColumn: '' },
  { key: 'amount', label: 'Monto (Débito/Cargo)', required: true, mappedColumn: '' },
  { key: 'numeroTarjeta', label: 'Número Tarjeta (últimos 4)', required: false, mappedColumn: '' },
]);
const allExpenses = ref([]);
const usersCache = ref(new Map());
const providers = ref([]);
const isLoadingTable = ref(true);
let unsubscribeExpenses = null;
const filters = ref({
    status: 'todos',
    provider: 'todos',
    ...getInitialDateRange()
});
const isAlertOpen = ref(false);
const alertMessage = ref('');
const isReconciliationModalOpen = ref(false);
const expenseToReconcile = ref(null);
const parseDate = (dateInput) => {
    if (!dateInput) return null;
    if (typeof dateInput === 'number' && dateInput > 1) {
        const date = new Date(Math.round((dateInput - 25569) * 86400 * 1000));
        return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    }
    if (typeof dateInput === 'string') {
        const parts = dateInput.split('/');
        if (parts.length === 3) {
            const day = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10) - 1;
            let year = parseInt(parts[2], 10);
            if (year < 100) year += 2000;
            if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
                 return new Date(year, month, day);
            }
        }
    }
    const finalAttempt = new Date(dateInput);
    return !isNaN(finalAttempt.getTime()) ? finalAttempt : null;
};
const normalizeString = (str) => {
    if (!str) return '';
    return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/gi, ' ').replace(/\s+/g, ' ').trim();
};
const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    fileName.value = file.name;
    const reader = new FileReader();
    reader.onload = (e) => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const ws = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
        if (jsonData.length > 1) {
            excelHeaders.value = jsonData[0].map(String);
            excelData.value = jsonData;
            showMapping.value = true;
        } else {
            showAlert('El archivo Excel está vacío o no tiene un formato válido.');
        }
    };
    reader.readAsArrayBuffer(file);
};
const handleImportStatement = async () => {
    if (dbFields.value.some(f => f.required && !f.mappedColumn)) {
        showAlert('Por favor, mapea todas las columnas requeridas (*).');
        return;
    }
    isProcessing.value = true;
    try {
        const batch = writeBatch(db);
        let createdCount = 0;
        let invalidDateCount = 0;
        const mapping = dbFields.value.reduce((acc, field) => ({...acc, [field.key]: field.mappedColumn}), {});
        const dataRows = excelData.value.slice(1);
        for (const row of dataRows) {
            const amountStr = String(row[excelHeaders.value.indexOf(mapping.amount)] || '0');
            const excelAmount = Math.abs(parseFloat(amountStr.replace(/[^0-9.-]+/g, "")));
            if (isNaN(excelAmount) || excelAmount === 0) continue;
            const rawDateValue = row[excelHeaders.value.indexOf(mapping.expenseDate)];
            const excelDate = parseDate(rawDateValue);
            if (!excelDate) {
                console.warn("Fecha inválida en fila, se omitirá:", row);
                invalidDateCount++;
                continue;
            };
            let last4Digits = null;
            if (mapping.numeroTarjeta) {
                const rawCardNumber = String(row[excelHeaders.value.indexOf(mapping.numeroTarjeta)] || '');
                if (rawCardNumber.length >= 4) last4Digits = rawCardNumber.slice(-4);
            }
            const newExpenseRef = doc(collection(db, "expenses"));
            const newExpenseData = {
                expenseDate: Timestamp.fromDate(excelDate),
                vendorName: String(row[excelHeaders.value.indexOf(mapping.description)] || 'N/A'),
                description: 'Gasto importado de estado de cuenta',
                amount: excelAmount,
                status: 'importado',
                paymentMethod: 'Tarjeta de Crédito',
                bankReference: String(row[excelHeaders.value.indexOf(mapping.bankReference)] || ''),
                numeroTarjeta: last4Digits || null,
                createdAt: serverTimestamp(),
                enteredBy_uid: null
            };
            batch.set(newExpenseRef, newExpenseData);
            createdCount++;
        }
        await batch.commit();
        let message = `${createdCount} transacciones fueron importadas con éxito.`;
        if (invalidDateCount > 0) {
            message += `\nSe omitieron ${invalidDateCount} filas por tener un formato de fecha inválido.`
        }
        showAlert(message);
    } catch (error) {
        console.error("Error en la importación:", error);
        showAlert(`Ocurrió un error al importar: ${error.message}`);
    } finally {
        isProcessing.value = false;
        showMapping.value = false;
        fileName.value = 'Ningún archivo seleccionado';
        const fileInput = document.getElementById('expense-file-input');
        if (fileInput) fileInput.value = '';
    }
};
const runAutoReconciliation = async () => {
    isProcessing.value = true;
    showAlert("Iniciando conciliación automática... Esto puede tardar unos segundos.");
    try {
        const manualPendingQuery = query(collection(db, "expenses"), where("status", "==", "pendiente"), where("paymentMethod", "==", "Tarjeta de Crédito"));
        const importedQuery = query(collection(db, "expenses"), where("status", "==", "importado"));
        const [manualSnapshot, importedSnapshot] = await Promise.all([getDocs(manualPendingQuery), getDocs(importedQuery)]);
        
        let manualExpenses = manualSnapshot.docs.map(d => ({id: d.id, ...d.data()}));
        const importedExpenses = importedSnapshot.docs.map(d => ({id: d.id, ...d.data()}));
        const batch = writeBatch(db);
        let reconciledCount = 0;
        let manualReviewCount = 0;
        for (const imp of importedExpenses) {
            const impDate = imp.expenseDate.toDate();
            const impAmount = imp.amount;
            const impDescription = normalizeString(imp.vendorName);
            const possibleMatches = manualExpenses.filter(man => {
                const manDate = man.expenseDate.toDate();
                const sameDay = manDate.getFullYear() === impDate.getFullYear() &&
                              manDate.getMonth() === impDate.getMonth() &&
                              manDate.getDate() === impDate.getDate();
                const sameAmount = Math.abs(man.amount - impAmount) < 0.01;
                return sameDay && sameAmount;
            });
            let finalMatch = null;
            if (possibleMatches.length === 1) {
                finalMatch = possibleMatches[0];
            } else if (possibleMatches.length > 1) {
                const perfectMatch = possibleMatches.find(man => impDescription.includes(normalizeString(man.vendorName)));
                if (perfectMatch) {
                    finalMatch = perfectMatch;
                } else {
                    const importedRef = doc(db, "expenses", imp.id);
                    batch.update(importedRef, { status: 'revision-manual' });
                    manualReviewCount++;
                }
            }
            if (finalMatch) {
                const manualRef = doc(db, "expenses", finalMatch.id);
                batch.update(manualRef, {
                    status: "Conciliado",
                    bankReference: imp.bankReference,
                    numeroTarjeta: imp.numeroTarjeta,
                    reconciledWith: doc(db, "expenses", imp.id),
                    reconciliationDate: serverTimestamp(),
                    reconciliationDifference: imp.amount - finalMatch.amount,
                    reconciliationComment: 'Conciliado automáticamente'
                });
                const importedRef = doc(db, "expenses", imp.id);
                batch.delete(importedRef);
                reconciledCount++;
                manualExpenses = manualExpenses.filter(m => m.id !== finalMatch.id);
            }
        }
        await batch.commit();
        let message = `Conciliación completada.\n- Se conciliaron ${reconciledCount} gastos automáticamente.`;
        if(manualReviewCount > 0) {
            message += `\n- ${manualReviewCount} transacciones se marcaron para revisión manual por ser ambiguas.`
        }
        showAlert(message);
    } catch (error) {
         console.error("Error en la conciliación automática:", error);
         showAlert(`Ocurrió un error al conciliar: ${error.message}`);
    } finally {
        isProcessing.value = false;
    }
};
const fetchUsersForCache = async (uids) => {
    const newUids = [...new Set(uids.filter(uid => uid && !usersCache.value.has(uid)))];
    if (newUids.length === 0) return;
    for (let i = 0; i < newUids.length; i += 30) {
        const chunk = newUids.slice(i, i + 30);
        const q = query(collection(db, "users"), where('uid', 'in', chunk));
        const userSnapshot = await getDocs(q);
        userSnapshot.forEach(doc => {
            usersCache.value.set(doc.id, doc.data().display_name || 'Usuario desconocido');
        });
    }
};
const fetchProviders = async () => {
    const q = query(collection(db, "proveedores"), orderBy("nameProveedor"));
    const snapshot = await getDocs(q);
    providers.value = snapshot.docs.map(doc => doc.data().nameProveedor);
};
onMounted(() => {
    fetchProviders();
    const q = query(collection(db, "expenses"), orderBy("expenseDate", "desc"));
    unsubscribeExpenses = onSnapshot(q, 
        async (snapshot) => {
            const uidsToFetch = snapshot.docs.map(d => d.data().enteredBy_uid?.id).filter(Boolean);
            await fetchUsersForCache(uidsToFetch);
            allExpenses.value = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            isLoadingTable.value = false;
        },
        (error) => {
            console.error("Error cargando el historial de gastos:", error);
            showAlert("No se pudo cargar el historial. Es muy probable que necesites crear un índice en Firestore. Revisa la consola (F12).");
            isLoadingTable.value = false;
        }
    );
});
onUnmounted(() => {
    if (unsubscribeExpenses) unsubscribeExpenses();
});
const filteredExpenses = computed(() => {
    return allExpenses.value.filter(exp => {
        const statusMatch = filters.value.status === 'todos' || (exp.status || 'pendiente') === filters.value.status;
        const providerMatch = filters.value.provider === 'todos' || exp.vendorName === filters.value.provider;
        const expDate = exp.expenseDate.toDate();
        const startDateMatch = !filters.value.startDate || expDate >= new Date(filters.value.startDate);
        const endDateMatch = !filters.value.endDate || expDate <= new Date(filters.value.endDate + 'T23:59:59');
        return statusMatch && providerMatch && startDateMatch && endDateMatch;
    });
});
const getEnteredByName = (expense) => {
    if (!expense.enteredBy_uid) return 'Sistema';
    return usersCache.value.get(expense.enteredBy_uid.id) || 'Cargando...';
};
const getStatusBadgeClass = (status) => {
    if (!status) return 'bg-yellow-100 text-yellow-800';
    const s = status.toLowerCase();
    if (s.includes('conciliado (auto)') || s.includes('importado')) return 'bg-blue-100 text-blue-800';
    if (s.includes('conciliado')) return 'bg-green-100 text-green-800';
    if (s.includes('pendiente')) return 'bg-yellow-100 text-yellow-800';
    if (s.includes('revision-manual')) return 'bg-purple-100 text-purple-800';
    return 'bg-gray-100 text-gray-800';
};
const formatStatus = (status) => {
    if (!status) return 'Pendiente';
    return status.replace(/-/g, ' ');
};
const showAlert = (msg) => {
    alertMessage.value = msg;
    isAlertOpen.value = true;
};
const openReconciliationModal = (expense) => {
    expenseToReconcile.value = expense;
    isReconciliationModalOpen.value = true;
};
const formatCurrency = (value) => {
    return new Intl.NumberFormat('es-HN', { style: 'currency', currency: 'HNL' }).format(value || 0);
};
</script>

<template>
  <div class="space-y-8">
    <div class="bg-white p-6 rounded-lg shadow">
      <h2 class="text-2xl font-bold text-gray-800 mb-4">Importar Estado de Cuenta</h2>
      <div class="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
        <input type="file" id="expense-file-input" class="hidden" accept=".xlsx, .xls, .csv" @change="handleFileChange">
        <label for="expense-file-input" class="cursor-pointer px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700">Seleccionar Archivo</label>
        <p class="mt-4 text-sm text-gray-500">{{ fileName }}</p>
      </div>
      <div v-if="showMapping" class="mt-8">
        <h3 class="text-lg font-bold text-gray-800">Mapeo de Columnas</h3>
        <div class="space-y-4 max-w-3xl my-4">
          <div v-for="field in dbFields" :key="field.key" class="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
            <label class="font-medium text-gray-700">{{ field.label }}<span v-if="field.required" class="text-red-500">*</span></label>
            <select v-model="field.mappedColumn" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm">
              <option value="">-- No usar --</option>
              <option v-for="header in excelHeaders" :key="header" :value="header">{{ header }}</option>
            </select>
          </div>
        </div>
        <div class="mt-6 flex justify-end">
          <button @click="handleImportStatement" :disabled="isProcessing" class="px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:bg-blue-300">
            {{ isProcessing ? 'Importando...' : 'Importar Transacciones' }}
          </button>
        </div>
      </div>
    </div>

    <div class="bg-white p-6 rounded-lg shadow">
      <div class="md:flex justify-between items-center mb-4">
        <h2 class="text-2xl font-bold text-gray-800">Historial de Todos los Gastos</h2>
        <button @click="runAutoReconciliation" :disabled="isProcessing" class="mt-4 md:mt-0 px-6 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 disabled:bg-green-300">
            <svg v-if="isProcessing" class="animate-spin -ml-1 mr-3 h-5 w-5 text-white inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
            {{ isProcessing ? 'Conciliando...' : 'Ejecutar Conciliación Automática' }}
        </button>
      </div>
       <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4 p-4 bg-gray-50 rounded-lg">
           <div>
               <label class="block text-sm font-medium text-gray-700">Estado</label>
               <select v-model="filters.status" class="mt-1 block w-full pl-3 pr-10 py-2 border-gray-300 rounded-md">
                   <option value="todos">Todos</option>
                   <option value="pendiente">Pendiente</option>
                   <option value="importado">Importado</option>
                   <option value="revision-manual">Revisión Manual</option>
                   <option value="Conciliado">Conciliado</option>
                   <option value="conciliado-manual">Conciliado (Manual)</option>
               </select>
           </div>
            <div>
               <label class="block text-sm font-medium text-gray-700">Proveedor</label>
               <select v-model="filters.provider" class="mt-1 block w-full pl-3 pr-10 py-2 border-gray-300 rounded-md">
                   <option value="todos">Todos</option>
                   <option v-for="p in providers" :key="p" :value="p">{{ p }}</option>
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
       </div>
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fecha</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Proveedor/Descripción</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Monto</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tarjeta</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Registrado Por</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Acciones</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            <tr v-if="isLoadingTable"><td colspan="7" class="text-center p-4 text-gray-500">Cargando...</td></tr>
            <tr v-else-if="filteredExpenses.length === 0"><td colspan="7" class="text-center p-4 text-gray-500">No hay gastos para mostrar con los filtros actuales.</td></tr>
            <tr v-for="exp in filteredExpenses" :key="exp.id">
              <td class="px-6 py-4 whitespace-nowrap text-sm">{{ exp.expenseDate.toDate().toLocaleDateString('es-HN') }}</td>
              <td class="px-6 py-4 text-sm">
                <div class="font-medium">{{ exp.vendorName }}</div>
                <div class="text-gray-500">{{ exp.description }}</div>
                <div v-if="exp.enteredBy_uid" class="flex items-center text-xs text-gray-400 mt-1 italic">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd" /></svg>
                    <span>{{ getEnteredByName(exp) }}</span>
                </div>
              </td>
              <td class="px-6 py-4 whitespace-nowrap text-sm">
                <div class="font-medium">{{ formatCurrency(exp.amount) }}</div>
                <div v-if="exp.status === 'Conciliado' && typeof exp.reconciliationDifference === 'number' && exp.reconciliationDifference !== 0">
                    <div class="text-xs mt-1" :class="exp.reconciliationDifference > 0 ? 'text-red-600' : 'text-green-600'">
                      Dif: {{ formatCurrency(exp.reconciliationDifference) }}
                    </div>
                    <div v-if="exp.reconciliationComment" class="text-xs text-gray-500 italic truncate" :title="exp.reconciliationComment">
                      "{{ exp.reconciliationComment }}"
                    </div>
                </div>
                </td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{{ exp.numeroTarjeta || '---' }}</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm">{{ getEnteredByName(exp) }}</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm">
                <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full capitalize" :class="getStatusBadgeClass(exp.status)">{{ formatStatus(exp.status) }}</span>
              </td>
              <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  <button v-if="exp.status === 'importado' || exp.status === 'revision-manual' || exp.status === 'pendiente'" @click="openReconciliationModal(exp)" class="px-3 py-1 bg-blue-600 text-white text-xs font-semibold rounded hover:bg-blue-700">Conciliar</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
  <AlertModal v-model="isAlertOpen" :message="alertMessage" />
  <ManualReconciliationModal v-model="isReconciliationModalOpen" :expenseToReconcile="expenseToReconcile" @reconciliation-success="showAlert" />
</template>