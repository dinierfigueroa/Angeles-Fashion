<script setup>
import { ref, watch, computed, onMounted } from 'vue';
import { db, storage, auth } from '@/firebase';
import { doc, collection, serverTimestamp, setDoc, getDocs, query, orderBy } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useAuthStore } from '@/stores/authStore';

const props = defineProps({
  modelValue: Boolean,
  storeId: String,
  entryType: String,
});

const emit = defineEmits(['update:modelValue', 'entry-saved']);
const authStore = useAuthStore();

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
});

const form = ref({ description: '', amount: null, invoiceNumber: '', providerName: '' });
const imageFile = ref(null);
const isLoading = ref(false);
const providers = ref([]); // Lista para el nuevo dropdown

// Cargar proveedores cuando el componente se monta
onMounted(async () => {
    const q = query(collection(db, "proveedores"), orderBy("nameProveedor"));
    const snapshot = await getDocs(q);
    providers.value = snapshot.docs.map(doc => doc.data().nameProveedor);
});

watch(isOpen, (newValue) => {
    if (newValue) {
        form.value = { description: '', amount: null, invoiceNumber: '', providerName: '' };
        imageFile.value = null;
        const fileInput = document.getElementById('pc-invoice-image');
        if (fileInput) fileInput.value = '';
    }
});

const handleFileChange = (event) => {
    imageFile.value = event.target.files[0];
};

const handleSubmit = async () => {
    if (!form.value.description || !form.value.amount || form.value.amount <= 0) {
        alert("Por favor, ingresa una descripción y un monto válido.");
        return;
    }
    isLoading.value = true;

    let imageUrl = null;
    if (imageFile.value) {
        try {
            const fileRef = storageRef(storage, `petty_cash_invoices/${Date.now()}_${imageFile.value.name}`);
            const snapshot = await uploadBytes(fileRef, imageFile.value);
            imageUrl = await getDownloadURL(snapshot.ref);
        } catch (error) {
             console.error("Error al subir imagen:", error);
             alert("No se pudo subir la imagen. El movimiento no se guardó.");
             isLoading.value = false;
             return;
        }
    }

    try {
        const newEntryRef = doc(collection(db, "pettyCashEntries"));
        const newEntryData = {
            storeId: props.storeId,
            description: form.value.description,
            amount: Number(form.value.amount),
            type: 'gasto',
            reimbursed: false,
            entryDate: serverTimestamp(),
            createdBy_uid: doc(db, 'users', authStore.user.uid),
            providerName: form.value.providerName || null, // Guardar proveedor
            invoiceNumber: form.value.invoiceNumber || null,
            invoiceImageUrl: imageUrl
        };

        await setDoc(newEntryRef, newEntryData);

        emit('entry-saved', 'Gasto registrado con éxito.');
        isOpen.value = false;
    } catch (error) {
        console.error("Error en transacción:", error);
        alert(`No se pudo registrar el movimiento: ${error.message}`);
    } finally {
        isLoading.value = false;
    }
};
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="isOpen" @click.self="isOpen = false" class="fixed inset-0 bg-gray-900 bg-opacity-50 z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-lg shadow-xl w-full max-w-lg p-6">
          <form @submit.prevent="handleSubmit">
            <h3 class="text-lg font-bold text-gray-900 capitalize">Registrar Gasto</h3>
            <div class="mt-4 space-y-4 max-h-[70vh] overflow-y-auto pr-2">
              <div>
                <label class="block text-sm font-medium text-gray-700">Descripción</label>
                <input type="text" v-model="form.description" required class="w-full input-style">
              </div>
               <div>
                <label class="block text-sm font-medium text-gray-700">Proveedor (Opcional)</label>
                <select v-model="form.providerName" class="w-full input-style">
                    <option value="">-- Sin Proveedor --</option>
                    <option v-for="p in providers" :key="p" :value="p">{{ p }}</option>
                </select>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700">Monto (L)</label>
                <input type="number" step="0.01" v-model.number="form.amount" required class="w-full input-style">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700">Número de Factura (Opcional)</label>
                <input type="text" v-model="form.invoiceNumber" class="w-full input-style">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700">Imagen de Factura (Opcional)</label>
                <input type="file" id="pc-invoice-image" @change="handleFileChange" accept="image/*" class="w-full file-input-style">
              </div>
            </div>
            <div class="mt-6 flex justify-end space-x-3">
              <button type="button" @click="isOpen = false" class="px-4 py-2 bg-gray-200 text-gray-800 rounded-md">Cancelar</button>
              <button type="submit" :disabled="isLoading" class="px-4 py-2 bg-indigo-600 text-white rounded-md disabled:bg-indigo-300">
                {{ isLoading ? 'Guardando...' : 'Guardar Gasto' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.input-style { @apply w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm; }
.file-input-style { @apply text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 mt-1; }
.modal-enter-active, .modal-leave-active { transition: opacity 0.3s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
</style>