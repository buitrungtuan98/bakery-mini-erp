import { db } from '$lib/firebase';
import {
    collection,
    addDoc,
    updateDoc,
    doc,
    deleteDoc,
    serverTimestamp
} from 'firebase/firestore';
import { generateNextCode } from '$lib/utils';
import { logAction } from '$lib/logger';
import type { User } from 'firebase/auth';

export const catalogService = {
    // --- PARTNERS ---
    async createPartner(user: User, data: any) {
        let prefix = 'KH';
        if (data.type === 'supplier') prefix = 'NCC';
        if (data.type === 'manufacturer') prefix = 'NSX';

        const code = await generateNextCode('partners', prefix);
        const dataToSave = { ...data, code, createdAt: serverTimestamp() };

        await addDoc(collection(db, 'partners'), dataToSave);
        await logAction(user, 'CREATE', 'partners', `Thêm mới đối tác: ${data.name} (${code})`);
        return code;
    },

    async updatePartner(user: User, id: string, data: any) {
        const dataToSave = { ...data, updatedAt: new Date() };
        await updateDoc(doc(db, 'partners', id), dataToSave);
        await logAction(user, 'UPDATE', 'partners', `Cập nhật đối tác: ${data.name}`);
    },

    async deletePartner(user: User, id: string) {
        await deleteDoc(doc(db, 'partners', id));
        // await logAction(user, 'DELETE', 'partners', `Xóa đối tác ID: ${id}`); // Optional log
    },

    // --- INGREDIENTS ---
    async createIngredient(user: User, data: any) {
        let code = data.code;
        if (!code) {
             code = await generateNextCode('ingredients', 'NVL');
        }

        const dataToSave = {
            ...data,
            code,
            currentStock: 0,
            avgCost: 0,
            createdAt: serverTimestamp()
        };

        await addDoc(collection(db, 'ingredients'), dataToSave);
        await logAction(user, 'CREATE', 'ingredients', `Thêm mới NVL: ${data.name} (${code})`);
        return code;
    },

    async updateIngredient(user: User, id: string, data: any) {
        await updateDoc(doc(db, 'ingredients', id), data);
        await logAction(user, 'UPDATE', 'ingredients', `Cập nhật NVL: ${data.name}`);
    },

    async deleteIngredient(user: User, id: string) {
        await deleteDoc(doc(db, 'ingredients', id));
        await logAction(user, 'DELETE', 'ingredients', `Xóa NVL ID: ${id}`);
    },

    // --- PRODUCTS ---
    async createProduct(user: User, data: any) {
        const code = await generateNextCode('products', 'SP');
        const dataToSave = { ...data, code, createdAt: serverTimestamp() };

        await addDoc(collection(db, 'products'), dataToSave);
        await logAction(user, 'CREATE', 'products', `Thêm mới SP: ${data.name} (${code})`);
        return code;
    },

    async updateProduct(user: User, id: string, data: any) {
        const dataToSave = { ...data, updatedAt: new Date() };
        await updateDoc(doc(db, 'products', id), dataToSave);
        await logAction(user, 'UPDATE', 'products', `Cập nhật SP: ${data.name}`);
    },

    async deleteProduct(user: User, id: string) {
        await deleteDoc(doc(db, 'products', id));
        // await logAction(user, 'DELETE', 'products', `Xóa SP ID: ${id}`);
    }
};
