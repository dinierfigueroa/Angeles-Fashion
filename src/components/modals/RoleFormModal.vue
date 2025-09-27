<script setup>
import { ref, watch, computed } from 'vue';
import { db } from '@/firebase';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import AlertModal from '@/components/modals/AlertModal.vue';

const props = defineProps({
  modelValue: Boolean,
  roleToEdit: Object,
});

const emit = defineEmits(['update:modelValue', 'role-saved']);

const allPermissions = [
    { key: 'isAdmin', label: 'Es Administrador (Acceso total)' },
    { key: 'canManageUsers', label: 'Gestionar Usuarios' },
    { key: 'canManageRoles', label: 'Gestionar Roles y Permisos' },
    { key: 'canManageStores', label: 'Gestionar Tiendas' },
    { key: 'canManageProviders', label: 'Gestionar Proveedores' },
    { key: 'canUploadDeposits', label: 'Subir Extractos de Depósitos' },
    { key: 'canViewAllDeposits', label: 'Ver Depósitos (Todas las Tiendas)' },
    { key: 'canViewScopedDeposits', label: 'Ver Depósitos (Tiendas Asignadas)' },
    { key: 'canRevertDeposits', label: 'Revertir Liquidaciones' },
    { key: 'canCreateGiftCards', label: 'Crear Certificados de Consumo' },
    { key: 'canRedeemGiftCards', label: 'Redimir Certificados de Consumo' },
    { key: 'canViewAllGiftCards', label: 'Ver Todos los Certificados (Vista Admin)' },
    { key: 'canManageAllPettyCash', label: 'Gestionar Caja Chica (Todas las Tiendas)' },
    { key: 'canManageOwnPettyCash', label: 'Gestionar Caja Chica (Tiendas Asignadas)' },
    { key: 'canReconcileExpenses', label: 'Conciliar Gastos de Tarjeta' },
    { key: 'canRegisterExpenses', label: 'Registrar Gastos (Restaurante)' },
];

const form = ref({
  displayName: '',
  permissions: {}
});
const newRoleId = ref('');
const isLoading = ref(false);
const isAlertOpen = ref(false);
const alertMessage = ref('');

const isEditing = computed(() => !!props.roleToEdit);

watch(() => props.modelValue, (isOpen) => {
  if (isOpen) {
    if (isEditing.value) {
      form.value.displayName = props.roleToEdit.displayName;
      form.value.permissions = { ...props.roleToEdit.permissions };
      newRoleId.value = props.roleToEdit.id;
    } else {
      form.value.displayName = '';
      form.value.permissions = {};
      newRoleId.value = '';
    }
  }
});


const handleSubmit = async () => {
    if(!form.value.displayName || (!isEditing.value && !newRoleId.value)){
        showAlert("El Nombre y el ID del Rol son obligatorios.");
        return;
    }
    isLoading.value = true;
    try {
        const roleId = isEditing.value ? props.roleToEdit.id : newRoleId.value.toLowerCase().replace(/ /g, '-');
        const roleRef = doc(db, "roles", roleId);
        const dataToSave = {
            displayName: form.value.displayName,
            permissions: form.value.permissions || {}
        };

        if (isEditing.value) {
            await updateDoc(roleRef, dataToSave);
            emit('role-saved', 'Rol actualizado con éxito.');
        } else {
            await setDoc(roleRef, dataToSave);
            emit('role-saved', 'Rol creado con éxito.');
        }
        emit('update:modelValue', false);
    } catch (error) {
        console.error("Error al guardar el rol:", error);
        showAlert(`Error al guardar el rol: ${error.message}`);
    } finally {
        isLoading.value = false;
    }
};

const showAlert = (msg) => {
    alertMessage.value = msg;
    isAlertOpen.value = true;
};
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="modelValue" @click.self="emit('update:modelValue', false)" class="fixed inset-0 bg-gray-900 bg-opacity-50 z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-lg shadow-xl w-full max-w-2xl p-6">
          <form @submit.prevent="handleSubmit">
            <h3 class="text-xl font-bold text-gray-900 mb-4">{{ isEditing ? 'Editar' : 'Crear Nuevo' }} Rol</h3>
            <div class="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
              <div>
                <label class="block text-sm font-medium text-gray-700">Nombre del Rol (Visible)</label>
                <input type="text" v-model="form.displayName" required class="w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" placeholder="Ej: Gerente de Tienda">
              </div>
               <div v-if="!isEditing">
                <label class="block text-sm font-medium text-gray-700">ID del Rol (Interno, sin espacios/acentos)</label>
                <input type="text" v-model="newRoleId" required class="w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm" placeholder="Ej: gerente-tienda">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Permisos</label>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 border p-4 rounded-md">
                    <div v-for="perm in allPermissions" :key="perm.key" class="flex items-center">
                        <input :id="perm.key" type="checkbox" v-model="form.permissions[perm.key]" class="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500">
                        <label :for="perm.key" class="ml-3 text-sm text-gray-600">{{ perm.label }}</label>
                    </div>
                </div>
              </div>
            </div>
            <div class="mt-6 flex justify-end space-x-3">
              <button type="button" @click="emit('update:modelValue', false)" class="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300">Cancelar</button>
              <button type="submit" :disabled="isLoading" class="px-4 py-2 bg-indigo-600 text-white font-semibold rounded-md hover:bg-indigo-700 disabled:bg-indigo-300">
                {{ isLoading ? 'Guardando...' : 'Guardar Rol' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Transition>
    <AlertModal v-model="isAlertOpen" :message="alertMessage" />
  </Teleport>
</template>