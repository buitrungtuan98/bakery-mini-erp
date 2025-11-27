import { db } from '$lib/firebase';
import {
    collection,
    addDoc,
    updateDoc,
    doc,
    deleteDoc,
    serverTimestamp,
    setDoc
} from 'firebase/firestore';
import { generateNextCode } from '$lib/utils';
import { logAction } from '$lib/logger';
import type { User } from 'firebase/auth';
import type { MasterPartner, MasterIngredient, MasterProduct } from '$lib/types/erp';

export const catalogService = {
    // --- PARTNERS (master_partners) ---
    async createPartner(user: User, data: any) {
        let prefix = 'KH';
        if (data.type === 'supplier') prefix = 'NCC';
        if (data.type === 'manufacturer') prefix = 'NSX';

        const code = await generateNextCode('master_partners', prefix); // Use new collection for Code Gen

        // Use setDoc with a custom ID if we wanted, but addDoc is fine for generic IDs.
        // Standardizing on addDoc for now as per original code pattern.
        const ref = await addDoc(collection(db, 'master_partners'), {
            ...data,
            code,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        await logAction(user, 'CREATE', 'master_partners', `Thêm mới đối tác: ${data.name} (${code})`);
        return code;
    },

    async updatePartner(user: User, id: string, data: any) {
        const dataToSave = { ...data, updatedAt: serverTimestamp() };
        await updateDoc(doc(db, 'master_partners', id), dataToSave);
        await logAction(user, 'UPDATE', 'master_partners', `Cập nhật đối tác: ${data.name}`);
    },

    async deletePartner(user: User, id: string) {
        await deleteDoc(doc(db, 'master_partners', id));
        // await logAction(user, 'DELETE', 'master_partners', `Xóa đối tác ID: ${id}`);
    },

    // --- INGREDIENTS (master_ingredients) ---
    async createIngredient(user: User, data: any) {
        let code = data.code;
        if (!code) {
             code = await generateNextCode('master_ingredients', 'NVL');
        }

        const dataToSave = {
            ...data,
            code,
            currentStock: 0,
            avgCost: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };

        await addDoc(collection(db, 'master_ingredients'), dataToSave);
        await logAction(user, 'CREATE', 'master_ingredients', `Thêm mới NVL: ${data.name} (${code})`);
        return code;
    },

    async updateIngredient(user: User, id: string, data: any) {
        const dataToSave = { ...data, updatedAt: serverTimestamp() };
        await updateDoc(doc(db, 'master_ingredients', id), dataToSave);
        await logAction(user, 'UPDATE', 'master_ingredients', `Cập nhật NVL: ${data.name}`);
    },

    async deleteIngredient(user: User, id: string) {
        await deleteDoc(doc(db, 'master_ingredients', id));
        await logAction(user, 'DELETE', 'master_ingredients', `Xóa NVL ID: ${id}`);
    },

    // --- PRODUCTS (master_products) ---
    async createProduct(user: User, data: any) {
        const code = await generateNextCode('master_products', 'SP');
        const dataToSave = {
            ...data,
            code,
            currentStock: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };

        await addDoc(collection(db, 'master_products'), dataToSave);
        await logAction(user, 'CREATE', 'master_products', `Thêm mới SP: ${data.name} (${code})`);
        return code;
    },

    async updateProduct(user: User, id: string, data: any) {
        const dataToSave = { ...data, updatedAt: serverTimestamp() };
        await updateDoc(doc(db, 'master_products', id), dataToSave);
        await logAction(user, 'UPDATE', 'master_products', `Cập nhật SP: ${data.name}`);
    },

    async deleteProduct(user: User, id: string) {
        await deleteDoc(doc(db, 'master_products', id));
        // await logAction(user, 'DELETE', 'master_products', `Xóa SP ID: ${id}`);
    }
};
