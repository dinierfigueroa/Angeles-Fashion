<script setup>
import { ref, computed, watch } from 'vue';
import { db } from '@/firebase';
import { collection, query, where, getDocs, doc, updateDoc, writeBatch, serverTimestamp, Timestamp } from 'firebase/firestore';

const props = defineProps({
  modelValue: Boolean,
  expenseToReconcile: Object,
});

const emit = defineEmits(['update:modelValue', 'reconciliation-success']);

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
});

const isLoading = ref(false);
const potentialMatches = ref([]);
const selectedMatch = ref(null);
const differenceComment = ref('');

const sourceStatus = computed(() => props.expenseToReconcile?.status);

const differenceAmount = computed(() => {
    if (!selectedMatch.value || !props.expenseToReconcile) return 0;
    const manualExpense = sourceStatus.value === 'pendiente' ? props.expenseToReconcile : selectedMatch.value;
    const importedExpense = sourceStatus.value === 'importado' || sourceStatus.value === 'revision-manual' ? props.expenseToReconcile : selectedMatch.value;
    return importedExpense.amount - manualExpense.amount;
});

watch(() => props.expenseToReconcile, async (sourceExpense) => {
    if (sourceExpense && isOpen.value) {
        isLoading.value = true;
        potentialMatches.value = [];
        selectedMatch.value = null;
        differenceComment.value = '';

        const isSourceManual = sourceExpense.status === 'pendiente';
        const statusToSearch = isSourceManual ? ['importado', 'revision-manual'] : ['pendiente'];
        
        const targetDate = sourceExpense.expenseDate.toDate();
        const startDate = new Date(targetDate.getTime() - 5 * 24 * 60 * 60 * 1000);
        const endDate = new Date(targetDate.getTime() + 5 * 24 * 60 * 60 * 1000);

        try {
            const q = query(collection(db, "expenses"),
                where("status", "in", statusToSearch),
                where("expenseDate", ">=", Timestamp.fromDate(startDate)),
                where("expenseDate", "<=", Timestamp.fromDate(endDate))
            );
            const querySnapshot = await getDocs(q);
            const matches = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            matches.sort((a, b) => {
                const diffA = Math.abs(a.amount - sourceExpense.amount);
                const diffB = Math.abs(b.amount - sourceExpense.amount);
                return diffA - diffB;
            });

            potentialMatches.value = matches;
        } catch (error) {
            console.error("Error al buscar coincidencias:", error);
            alert("Error al buscar coincidencias. Es posible que falte un índice en Firestore. Revisa la consola (F12).");
        } finally {
            isLoading.value = false;
        }
    }
});

const selectForConfirmation = (match) => {
    selectedMatch.value = match;
};

const confirmReconciliation = async () => {
    if (!selectedMatch.value) return;

    if (differenceAmount.value !== 0 && !differenceComment.value.trim()) {
        alert("Hay una diferencia en los montos. Por favor, añade un comentario de justificación.");
        return;
    }
    isLoading.value = true;
    try {
        const batch = writeBatch(db);
        const manualExpense = sourceStatus.value === 'pendiente' ? props.expenseToReconcile : selectedMatch.value;
        const importedExpense = sourceStatus.value !== 'pendiente' ? props.expenseToReconcile : selectedMatch.value;

        const manualExpenseRef = doc(db, "expenses", manualExpense.id);
        const importedExpenseRef = doc(db, "expenses", importedExpense.id);

        batch.update(manualExpenseRef, {
            status: "Conciliado",
            bankReference: importedExpense.bankReference,
            numeroTarjeta: importedExpense.numeroTarjeta,
            reconciledWith: importedExpenseRef,
            reconciliationDate: serverTimestamp(),
            reconciliationDifference: differenceAmount.value,
            reconciliationComment: differenceComment.value.trim() || null
        });
        batch.delete(importedExpenseRef);
        
        await batch.commit();
        emit('reconciliation-success', `Gasto de ${formatCurrency(manualExpense.amount)} conciliado con éxito.`);
        isOpen.value = false;
    } catch (error) {
        console.error("Error al conciliar:", error);
        alert("Hubo un error al procesar la conciliación.");
    } finally {
        isLoading.value = false;
    }
};

const handleManualConciliation = async () => {
     isLoading.value = true;
     try {
        const expenseRef = doc(db, "expenses", props.expenseToReconcile.id);
        await updateDoc(expenseRef, {
            status: "conciliado-manual",
            reconciliationDate: serverTimestamp()
        });
        emit('reconciliation-success', `Gasto marcado como 'Conciliado Manualmente'.`);
        isOpen.value = false;
     } catch(error) {
        console.error("Error en conciliación manual:", error);
        alert("Hubo un error al marcar el gasto.");
     } finally {
        isLoading.value = false;
     }
};

const formatCurrency = (value) => new Intl.NumberFormat('es-HN', { style: 'currency', currency: 'HNL' }).format(value || 0);
const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    return timestamp.toDate().toLocaleDateString('es-HN');
};
</script>


<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="isOpen" @click.self="isOpen = false" class="fixed inset-0 bg-gray-900 bg-opacity-50 z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-lg shadow-xl w-full max-w-2xl p-6">
          <h3 class="text-xl font-bold text-gray-900 mb-4">Asistente de Conciliación</h3>
          
          <div v-if="expenseToReconcile" class="p-4 bg-blue-50 rounded-lg border border-blue-200 mb-4">
            <h4 class="font-semibold text-gray-800">Conciliando este gasto {{ sourceStatus === 'pendiente' ? 'registrado manualmente' : 'del banco' }}:</h4>
            <div class="mt-2 text-sm grid grid-cols-3 gap-2">
              <span><span class="font-medium">Fecha:</span> {{ formatDate(expenseToReconcile.expenseDate) }}</span>
              <span><span class="font-medium">Descripción:</span> {{ expenseToReconcile.vendorName }}</span>
              <span class="font-bold text-lg">{{ formatCurrency(expenseToReconcile.amount) }}</span>
            </div>
          </div>

          <div v-if="!selectedMatch">
            <h4 class="font-semibold text-gray-800 mb-2">Paso 1: Selecciona la transacción {{ sourceStatus === 'pendiente' ? 'del banco' : 'manual' }} correspondiente</h4>
            <div class="max-h-64 overflow-y-auto border rounded-lg">
              <div v-if="isLoading" class="text-center p-8">Buscando coincidencias...</div>
              <div v-else-if="potentialMatches.length === 0" class="text-center p-8 text-gray-500">No se encontraron coincidencias.</div>
              <table v-else class="min-w-full">
                <tbody class="divide-y">
                  <tr v-for="match in potentialMatches" :key="match.id">
                    <td class="px-4 py-2 text-sm">{{ formatDate(match.expenseDate) }}</td>
                    <td class="px-4 py-2 text-sm"><span class="font-medium">{{ match.vendorName }}</span><br><span class="text-gray-500">{{ match.description }}</span></td>
                    <td class="px-4 py-2 text-sm font-medium">{{ formatCurrency(match.amount) }}</td>
                    <td class="px-4 py-2 text-right"><button @click="selectForConfirmation(match)" class="px-3 py-1 bg-indigo-600 text-white text-sm font-semibold rounded hover:bg-indigo-700">Seleccionar</button></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div v-if="selectedMatch" class="mt-4 pt-4 border-t">
              <h4 class="font-semibold text-gray-800 mb-2">Paso 2: Confirma y justifica la diferencia (si la hay)</h4>
              <div class="p-3 bg-gray-100 rounded-md">
                 <div v-if="differenceAmount !== 0">
                    <p class="font-medium">Se ha detectado una diferencia:</p>
                    <p class="text-2xl font-bold" :class="differenceAmount > 0 ? 'text-red-600' : 'text-green-600'">
                       {{ formatCurrency(differenceAmount) }}
                       <span class="text-sm font-medium">{{ differenceAmount > 0 ? '(Faltante en registro manual)' : '(Sobrante en registro manual)' }}</span>
                    </p>
                    <p class="text-xs text-gray-500">(Monto del banco: {{ formatCurrency(sourceStatus !== 'pendiente' ? expenseToReconcile.amount : selectedMatch.amount) }}, Monto manual: {{ formatCurrency(sourceStatus === 'pendiente' ? expenseToReconcile.amount : selectedMatch.amount) }})</p>
                    <div class="mt-2">
                        <label class="block text-sm font-medium text-gray-700">Justificación de la diferencia (Obligatorio)</label>
                        <textarea v-model="differenceComment" rows="2" class="w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" placeholder="Ej: Cobro de ISV no registrado"></textarea>
                    </div>
                 </div>
                 <div v-else>
                    <p class="text-green-700 font-medium">Los montos coinciden perfectamente. Puedes confirmar la conciliación.</p>
                 </div>
              </div>
          </div>

          <div class="mt-6 flex justify-between items-center">
             <button v-if="!selectedMatch && sourceStatus !== 'pendiente'" @click="handleManualConciliation" class="text-sm text-indigo-600 hover:underline">
                Marcar como Conciliado (sin Gasto Manual)
             </button>
             <div v-else></div>
             <div>
                <button type="button" @click="isOpen = false" class="px-4 py-2 bg-gray-200 text-gray-800 rounded-md mr-2">Cerrar</button>
                <button v-if="selectedMatch" @click="confirmReconciliation" :disabled="isLoading" class="px-4 py-2 bg-green-600 text-white font-semibold rounded-md hover:bg-green-700">Confirmar Conciliación</button>
             </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>